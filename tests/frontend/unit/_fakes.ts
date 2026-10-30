/** Test doubles for the frontend data layer: storage, timers, and an in-memory API server. */
import type { ApiClient, ApiFailure, ApiResult, FailureCode, FunctionName } from '../../../src/data/apiClient.ts'
import type { GuestbookEntry, PublicVisitor } from '../../../src/data/apiContract.ts'
import { PRIZES } from '../../../src/data/prizes.ts'
import {
  type AwardedPrize,
  createVisitorSession,
  type KeyValueStorage,
  type Scheduler,
  type VisitorSession,
} from '../../../src/data/visitorSession.ts'

export const STORAGE_KEY = 'my-house:visit'
export const SECRET = /^[A-Za-z0-9_-]{43}$/
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>()
  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
  removeItem(key: string): void {
    this.items.delete(key)
  }
  // deno-lint-ignore no-explicit-any
  visit(): any {
    const raw = this.items.get(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  }
}

/** Lets settled promise chains (fake requests, the sync loop) run to completion. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export class FakeClock implements Scheduler {
  time = Date.parse('2026-10-29T19:00:00Z')
  #timers = new Map<number, { at: number; callback: () => void }>()
  #nextId = 1

  now(): number {
    return this.time
  }
  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.#nextId++
    this.#timers.set(id, { at: this.time + ms, callback })
    return id
  }
  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number)
  }

  /** Moves time forward, firing due timers in order and letting their work settle. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms
    await settle()
    for (;;) {
      let next: [number, { at: number; callback: () => void }] | null = null
      for (const entry of this.#timers) {
        if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry
      }
      if (!next) break
      this.#timers.delete(next[0])
      this.time = Math.max(this.time, next[1].at)
      next[1].callback()
      await settle()
    }
    this.time = end
    await settle()
  }
}

export function failure(status: number, code: FailureCode, retryAfterSeconds: number | null = null): ApiFailure {
  return {
    status,
    code,
    retryAfterSeconds,
    retryable: status === 0 ? code !== 'not_configured' : status === 408 || status === 429 || status >= 500,
  }
}

interface ServerSession {
  token: string
  visitor: PublicVisitor
  used: boolean
  expired: boolean
}

interface ServerAward {
  token: string
  prizeId: string
  adjective: string
  location: string
}

export interface RecordedRequest {
  name: FunctionName
  // deno-lint-ignore no-explicit-any
  body: any
  keepalive: boolean
}

/**
 * Follows the Stage A contract closely enough for client tests: registration keys replay until
 * the token is first used, knock totals are merged with max(), and award ids are idempotent.
 */
export class FakeServer {
  readonly sessions = new Map<string, ServerSession>()
  readonly registrations = new Map<string, string>()
  readonly awards = new Map<string, ServerAward>()
  readonly requests: RecordedRequest[] = []
  /** Failures returned, in order, instead of handling the next requests to a function. */
  readonly failNext = new Map<FunctionName, ApiFailure[]>()
  /** Requests to these functions are handled, but the response is lost (counted down). */
  readonly loseResponses = new Map<FunctionName, number>()
  /** While true, requests never reach the server. */
  offline = false
  #nextVisitorNumber = 1

  readonly api: ApiClient = new FakeApi(this)

  requestsTo(name: FunctionName): RecordedRequest[] {
    return this.requests.filter((request) => request.name === name)
  }

  expireAllSessions(): void {
    for (const session of this.sessions.values()) session.expired = true
  }

  handle(name: FunctionName, body: Record<string, unknown>, keepalive: boolean): ApiResult<unknown> {
    this.requests.push({ name, body: structuredClone(body), keepalive })
    if (this.offline) return { ok: false, failure: failure(0, 'network') }
    const queued = this.failNext.get(name)
    if (queued && queued.length > 0) return { ok: false, failure: queued.shift()! }

    const result = this.#route(name, body)
    const lose = this.loseResponses.get(name) ?? 0
    if (lose > 0) {
      this.loseResponses.set(name, lose - 1)
      return { ok: false, failure: failure(0, 'network') }
    }
    return result
  }

  #route(name: FunctionName, body: Record<string, unknown>): ApiResult<unknown> {
    switch (name) {
      case 'start-session':
        return typeof body.sessionToken === 'string'
          ? this.#resume(body.sessionToken)
          : this.#register(String(body.registrationKey))
      case 'record-knocks':
        return this.#recordKnocks(body)
      case 'record-award':
        return this.#recordAward(body)
      default:
        return { ok: false, failure: failure(405, 'method_not_allowed') }
    }
  }

  #register(registrationKey: string): ApiResult<unknown> {
    const existing = this.sessions.get(this.registrations.get(registrationKey) ?? '')
    if (existing && !existing.used && !existing.expired) {
      return ok(200, {
        status: 'registered',
        replayed: true,
        sessionToken: existing.token,
        visitor: { ...existing.visitor },
      })
    }
    const token = randomSecret()
    const visitorNumber = this.#nextVisitorNumber++
    const session: ServerSession = {
      token,
      used: false,
      expired: false,
      visitor: { visitorNumber, alias: `visitor ${visitorNumber}`, knockCount: 0, startedAt: new Date().toISOString() },
    }
    this.sessions.set(token, session)
    this.registrations.set(registrationKey, token)
    return ok(201, { status: 'registered', replayed: false, sessionToken: token, visitor: { ...session.visitor } })
  }

  #use(token: unknown): ServerSession | null {
    const session = this.sessions.get(String(token))
    if (!session || session.expired) return null
    session.used = true
    return session
  }

  #resume(token: string): ApiResult<unknown> {
    const session = this.#use(token)
    if (!session) return { ok: false, failure: failure(401, 'invalid_session') }
    return ok(200, { status: 'resumed', visitor: { ...session.visitor } })
  }

  #recordKnocks(body: Record<string, unknown>): ApiResult<unknown> {
    const session = this.#use(body.sessionToken)
    if (!session) return { ok: false, failure: failure(401, 'invalid_session') }
    const total = body.totalKnocks
    if (!Number.isInteger(total) || (total as number) < 0 || (total as number) > 5000) {
      return { ok: false, failure: failure(400, 'invalid_request') }
    }
    const previous = session.visitor.knockCount
    session.visitor.knockCount = Math.max(previous, total as number)
    return ok(200, { knockCount: session.visitor.knockCount, accepted: session.visitor.knockCount - previous })
  }

  #recordAward(body: Record<string, unknown>): ApiResult<unknown> {
    const session = this.#use(body.sessionToken)
    if (!session) return { ok: false, failure: failure(401, 'invalid_session') }
    const award: ServerAward = {
      token: session.token,
      prizeId: String(body.prizeId),
      adjective: String(body.adjective),
      location: String(body.location),
    }
    const awardId = String(body.awardId)
    const existing = this.awards.get(awardId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(award)) {
      return { ok: false, failure: failure(409, 'award_id_conflict') }
    }
    if (!existing) this.awards.set(awardId, award)
    const entry: GuestbookEntry = {
      awardId,
      visitorNumber: session.visitor.visitorNumber,
      alias: session.visitor.alias,
      prizeId: award.prizeId,
      objectName: award.prizeId,
      adjective: award.adjective,
      location: award.location,
      awardedAt: new Date().toISOString(),
    }
    return ok(existing ? 200 : 201, { award: entry, duplicate: !!existing })
  }
}

class FakeApi implements ApiClient {
  readonly configured = true
  readonly #server: FakeServer
  constructor(server: FakeServer) {
    this.#server = server
  }
  post<T>(name: FunctionName, body: unknown, options?: { keepalive?: boolean }): Promise<ApiResult<T>> {
    const result = this.#server.handle(name, body as Record<string, unknown>, options?.keepalive ?? false)
    return Promise.resolve(result as ApiResult<T>)
  }
  get<T>(): Promise<ApiResult<T>> {
    return Promise.reject(new Error('The visitor session never reads the guestbook'))
  }
}

function ok(status: number, data: unknown): ApiResult<unknown> {
  return { ok: true, status, data }
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** A valid catalog prize, as a fresh object like each round's SelectedPrize. */
export function catalogPrize(index = 0): AwardedPrize {
  const prize = PRIZES[index]
  return { id: prize.id, adjective: prize.adjectives[0], location: prize.locations[0] }
}

export interface TestSession {
  session: VisitorSession
  warnings: string[]
  recorded: () => number
}

export function createTestSession(
  server: FakeServer,
  clock: FakeClock,
  storage: MemoryStorage | null = new MemoryStorage(),
  api: ApiClient = server.api,
): TestSession {
  const warnings: string[] = []
  let recorded = 0
  const session = createVisitorSession({
    api,
    storage,
    scheduler: clock,
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    // Midpoint jitter: backoff waits are exactly 1 s, 2 s, 4 s…; Retry-After waits gain 125 ms.
    random: () => 0.5,
    warn: (message) => warnings.push(message),
  })
  session.onAwardRecorded(() => {
    recorded += 1
  })
  return { session, warnings, recorded: () => recorded }
}
