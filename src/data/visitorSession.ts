import type {
  PublicVisitor,
  RecordAwardResponse,
  RecordKnocksResponse,
  StartSessionResponse,
} from './apiContract'
import type { ApiClient, ApiFailure, ApiResult } from './apiClient'
import { PRIZES } from './prizes'

/** The catalog fields of a revealed prize. `SelectedPrize` satisfies this. */
export interface AwardedPrize {
  id: string
  adjective: string
  location: string
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface Scheduler {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface VisitorSessionDeps {
  api: ApiClient
  /** sessionStorage, or null when the browser refuses it (state then lasts one page load). */
  storage: KeyValueStorage | null
  scheduler: Scheduler
  /** Cryptographically secure random bytes. */
  randomBytes(length: number): Uint8Array
  /** Jitter source; defaults to Math.random. */
  random?(): number
  warn?(message: string): void
}

export interface VisitorSession {
  /** Registers or resumes the visit, and retries anything unsent. Safe to call repeatedly. */
  start(): void
  /** The confirmed visitor, or the one saved earlier in this tab while confirmation is pending. */
  getVisitor(): PublicVisitor | null
  /** Calls `listener` now and whenever the visitor changes. Returns an unsubscribe function. */
  subscribeVisitor(listener: (visitor: PublicVisitor | null) => void): () => void
  /** Calls `listener` each time the server confirms a gift. Returns an unsubscribe function. */
  onAwardRecorded(listener: () => void): () => void
  /** One accepted knock from the interactive door-knocking phase. */
  recordKnock(): void
  /** Queues the gift for this prize reveal; repeat calls with the same prize object are ignored. */
  recordAward(prize: AwardedPrize): void
  /** Sends unsent work now. With `keepalive`, copies are sent that can outlive the page. */
  flush(options?: { keepalive?: boolean }): void
}

interface PendingAward {
  awardId: string
  prizeId: string
  adjective: string
  location: string
}

interface VisitState {
  /** Saved before the first registration request and resent until a response arrives. */
  registrationKey: string | null
  sessionToken: string | null
  visitor: PublicVisitor | null
  /** Counted knocks for this session, reported or not. */
  knocks: number
  /** The highest total the server has confirmed for this session. */
  reportedKnocks: number
  /** Gifts the server has not confirmed yet, oldest first. */
  awards: PendingAward[]
}

type Operation = 'session' | 'awards' | 'knocks'

const STORAGE_KEY = 'my-house:visit'
const STORAGE_VERSION = 1
/** Mirrors private.max_session_knocks(); the API rejects larger totals. */
const MAX_SESSION_KNOCKS = 5000
/** A knock batch is sent this long after the latest knock… */
const KNOCK_BATCH_DELAY_MS = 2000
/** …but no later than this after the first unsent one. */
const KNOCK_BATCH_MAX_DELAY_MS = 8000
const RETRY_BASE_MS = 1000
const RETRY_MAX_MS = 30_000
/** Consecutive failures after which an operation waits for new activity (about 90 s). */
const MAX_ATTEMPTS = 8
/** New visits one page load may start after the server rejects the session. */
const MAX_REREGISTRATIONS = 2
const MAX_PENDING_AWARDS = 50

const SECRET = /^[A-Za-z0-9_-]{43}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Responses that mean the deployment, not this request, is wrong. Nothing will succeed. */
const CONFIGURATION_FAILURES = new Set<ApiFailure['code']>([
  'not_configured',
  'invalid_api_key',
  'origin_not_allowed',
  'method_not_allowed',
  'payload_too_large',
  'unsupported_media_type',
])

const CATALOG: ReadonlyMap<string, { adjectives: Set<string>; locations: Set<string> }> =
  new Map(
    PRIZES.map((prize) => [
      prize.id,
      { adjectives: new Set(prize.adjectives), locations: new Set(prize.locations) },
    ]),
  )

function isInCatalog(prize: AwardedPrize): boolean {
  const entry = CATALOG.get(prize.id)
  return !!entry && entry.adjectives.has(prize.adjective) && entry.locations.has(prize.location)
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** RFC 4122 version 4. Built from random bytes because crypto.randomUUID needs HTTPS. */
function uuidFromBytes(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SESSION_KNOCKS
}

function isPublicVisitor(value: unknown): value is PublicVisitor {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.visitorNumber) &&
    (value.visitorNumber as number) > 0 &&
    typeof value.alias === 'string' &&
    isCount(value.knockCount) &&
    typeof value.startedAt === 'string'
  )
}

function isPendingAward(value: unknown): value is PendingAward {
  return (
    isRecord(value) &&
    typeof value.awardId === 'string' &&
    UUID.test(value.awardId) &&
    typeof value.prizeId === 'string' &&
    typeof value.adjective === 'string' &&
    typeof value.location === 'string'
  )
}

function emptyState(): VisitState {
  return {
    registrationKey: null,
    sessionToken: null,
    visitor: null,
    knocks: 0,
    reportedKnocks: 0,
    awards: [],
  }
}

function parseStoredState(raw: string | null): VisitState {
  if (!raw) return emptyState()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return emptyState()
  }
  if (!isRecord(data) || data.v !== STORAGE_VERSION) return emptyState()

  const sessionToken =
    typeof data.sessionToken === 'string' && SECRET.test(data.sessionToken)
      ? data.sessionToken
      : null
  const registrationKey =
    !sessionToken &&
    typeof data.registrationKey === 'string' &&
    SECRET.test(data.registrationKey)
      ? data.registrationKey
      : null
  const reportedKnocks = isCount(data.reportedKnocks) ? data.reportedKnocks : 0
  const knocks = Math.max(isCount(data.knocks) ? data.knocks : 0, reportedKnocks)
  return {
    registrationKey,
    sessionToken,
    visitor: sessionToken && isPublicVisitor(data.visitor) ? data.visitor : null,
    knocks,
    reportedKnocks,
    awards: Array.isArray(data.awards)
      ? data.awards.filter(isPendingAward).slice(-MAX_PENDING_AWARDS)
      : [],
  }
}

export function createVisitorSession(deps: VisitorSessionDeps): VisitorSession {
  const { api, storage, scheduler } = deps
  const random = deps.random ?? Math.random
  const warn = deps.warn ?? (() => {})

  const state = loadState()
  const retry: Record<Operation, { failures: number; notBefore: number }> = {
    session: { failures: 0, notBefore: 0 },
    awards: { failures: 0, notBefore: 0 },
    knocks: { failures: 0, notBefore: 0 },
  }
  const visitorListeners = new Set<(visitor: PublicVisitor | null) => void>()
  const awardListeners = new Set<() => void>()
  const recordedPrizes = new WeakSet<AwardedPrize>()

  /** True once this page load has resumed or registered the session. */
  let sessionConfirmed = false
  /** A configuration failure stops all syncing until the page reloads. */
  let halted = false
  let running = false
  let wakeHandle: unknown = null
  let reregistrations = 0
  /** Knocks restored from storage are sent as soon as the session is confirmed. */
  let knockDueAt = state.knocks > state.reportedKnocks ? 0 : Infinity
  let knockBatchStartedAt: number | null = null

  function loadState(): VisitState {
    try {
      return parseStoredState(storage?.getItem(STORAGE_KEY) ?? null)
    } catch {
      return emptyState()
    }
  }

  function save(): void {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, ...state }))
    } catch {
      // Storage full or blocked: keep going with the in-memory state.
    }
  }

  function notifyVisitor(): void {
    for (const listener of visitorListeners) listener(state.visitor)
  }

  function rearm(operations: readonly Operation[]): void {
    for (const operation of operations) {
      if (retry[operation].notBefore === Infinity) {
        retry[operation] = { failures: 0, notBefore: 0 }
      }
    }
  }

  function succeeded(operation: Operation): void {
    retry[operation] = { failures: 0, notBefore: 0 }
  }

  function failed(operation: Operation, result: ApiResult<unknown>): void {
    const failure: ApiFailure = result.ok
      ? { status: result.status, code: 'bad_response', retryAfterSeconds: null, retryable: true }
      : result.failure

    if (CONFIGURATION_FAILURES.has(failure.code)) {
      halted = true
      warn(`${operation}: stopped syncing (${failure.status} ${failure.code})`)
      return
    }
    const entry = retry[operation]
    if (!failure.retryable) {
      entry.notBefore = Infinity
      warn(`${operation}: not retried (${failure.status} ${failure.code})`)
      return
    }
    entry.failures += 1
    if (entry.failures >= MAX_ATTEMPTS) {
      entry.notBefore = Infinity
      warn(`${operation}: paused after ${entry.failures} failed attempts (${failure.code})`)
      return
    }
    const backoff =
      Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (entry.failures - 1)) * (0.8 + random() * 0.4)
    // Retry-After is a floor: a busy server answering "1 s" every time still gets backed off.
    const delay =
      failure.retryAfterSeconds !== null
        ? Math.max(failure.retryAfterSeconds * 1000 + random() * 250, backoff)
        : backoff
    entry.notBefore = scheduler.now() + delay
  }

  /**
   * The server no longer accepts this session (expired or unknown). Start a new visit and carry
   * over only what the old one never confirmed, so nothing is counted twice.
   */
  function abandonSession(): void {
    if (reregistrations >= MAX_REREGISTRATIONS) {
      halted = true
      warn('session: rejected again after re-registering; stopped syncing')
      return
    }
    reregistrations += 1
    state.knocks = Math.max(0, state.knocks - state.reportedKnocks)
    state.reportedKnocks = 0
    state.sessionToken = null
    state.registrationKey = null
    state.visitor = null
    sessionConfirmed = false
    save()
    notifyVisitor()
  }

  function adoptVisitor(visitor: PublicVisitor): void {
    state.visitor = visitor
    state.reportedKnocks = Math.max(state.reportedKnocks, visitor.knockCount)
    state.knocks = Math.max(state.knocks, state.reportedKnocks)
    sessionConfirmed = true
    save()
    notifyVisitor()
  }

  async function establishSession(): Promise<void> {
    if (state.sessionToken) {
      const result = await api.post<StartSessionResponse>('start-session', {
        sessionToken: state.sessionToken,
      })
      if (
        result.ok &&
        isRecord(result.data) &&
        result.data.status === 'resumed' &&
        isPublicVisitor(result.data.visitor)
      ) {
        succeeded('session')
        adoptVisitor(result.data.visitor)
        return
      }
      if (
        !result.ok &&
        (result.failure.code === 'invalid_session' || result.failure.code === 'invalid_request')
      ) {
        abandonSession()
        return
      }
      failed('session', result)
      return
    }

    if (!state.registrationKey) {
      state.registrationKey = encodeBase64Url(deps.randomBytes(32))
      save()
    }
    const result = await api.post<StartSessionResponse>('start-session', {
      registrationKey: state.registrationKey,
    })
    if (
      result.ok &&
      isRecord(result.data) &&
      result.data.status === 'registered' &&
      typeof result.data.sessionToken === 'string' &&
      SECRET.test(result.data.sessionToken) &&
      isPublicVisitor(result.data.visitor)
    ) {
      state.sessionToken = result.data.sessionToken
      state.registrationKey = null
      succeeded('session')
      adoptVisitor(result.data.visitor)
      return
    }
    if (!result.ok && result.failure.code === 'invalid_request') {
      state.registrationKey = null
      save()
    }
    failed('session', result)
  }

  async function sendNextAward(sessionToken: string): Promise<void> {
    const award = state.awards[0]
    const result = await api.post<RecordAwardResponse>('record-award', {
      sessionToken,
      ...award,
    })
    if (
      result.ok &&
      isRecord(result.data) &&
      isRecord(result.data.award) &&
      result.data.award.awardId === award.awardId
    ) {
      succeeded('awards')
      removeAward(award.awardId)
      for (const listener of awardListeners) listener()
      return
    }
    if (!result.ok) {
      const { code, status } = result.failure
      if (code === 'invalid_session') {
        abandonSession()
        return
      }
      if (code === 'award_id_conflict' || code === 'invalid_prize' || code === 'invalid_request') {
        // Resending the same award can never succeed; a fresh id would be a different gift.
        removeAward(award.awardId)
        warn(`awards: dropped a gift the server refused (${status} ${code})`)
        return
      }
    }
    failed('awards', result)
  }

  function removeAward(awardId: string): void {
    const index = state.awards.findIndex((award) => award.awardId === awardId)
    if (index !== -1) state.awards.splice(index, 1)
    save()
  }

  async function sendKnocks(sessionToken: string): Promise<void> {
    knockDueAt = Infinity
    knockBatchStartedAt = null
    const result = await api.post<RecordKnocksResponse>('record-knocks', {
      sessionToken,
      totalKnocks: state.knocks,
    })
    if (result.ok && isRecord(result.data) && isCount(result.data.knockCount)) {
      succeeded('knocks')
      state.reportedKnocks = Math.max(state.reportedKnocks, result.data.knockCount)
      state.knocks = Math.max(state.knocks, state.reportedKnocks)
      const visitor = state.visitor
      const visitorChanged = visitor !== null && visitor.knockCount < state.reportedKnocks
      if (visitorChanged) state.visitor = { ...visitor, knockCount: state.reportedKnocks }
      save()
      if (visitorChanged) notifyVisitor()
      return
    }
    knockDueAt = Math.min(knockDueAt, scheduler.now())
    if (!result.ok && result.failure.code === 'invalid_session') {
      abandonSession()
      return
    }
    failed('knocks', result)
  }

  function nextStep(): (() => Promise<void>) | null {
    if (halted) return null
    const now = scheduler.now()
    if (!sessionConfirmed || !state.sessionToken) {
      return retry.session.notBefore <= now ? establishSession : null
    }
    const token = state.sessionToken
    if (state.awards.length > 0 && retry.awards.notBefore <= now) {
      return () => sendNextAward(token)
    }
    if (
      state.knocks > state.reportedKnocks &&
      knockDueAt <= now &&
      retry.knocks.notBefore <= now
    ) {
      return () => sendKnocks(token)
    }
    return null
  }

  /** The earliest time something becomes due, or Infinity when nothing is waiting. */
  function nextWakeAt(): number {
    if (halted) return Infinity
    if (!sessionConfirmed || !state.sessionToken) return retry.session.notBefore
    let at = Infinity
    if (state.awards.length > 0) at = Math.min(at, retry.awards.notBefore)
    if (state.knocks > state.reportedKnocks) {
      at = Math.min(at, Math.max(knockDueAt, retry.knocks.notBefore))
    }
    return at
  }

  function scheduleWake(): void {
    if (wakeHandle !== null) {
      scheduler.clearTimeout(wakeHandle)
      wakeHandle = null
    }
    const at = nextWakeAt()
    if (at === Infinity) return
    wakeHandle = scheduler.setTimeout(() => {
      wakeHandle = null
      kick()
    }, Math.max(0, at - scheduler.now()))
  }

  /** One request at a time, so a session change can never race a write. */
  async function run(): Promise<void> {
    running = true
    try {
      for (let step = nextStep(); step; step = nextStep()) {
        await step()
      }
    } catch {
      // A bug, not an outage: retrying the same step would spin.
      halted = true
      warn('sync: unexpected error; stopped syncing')
    } finally {
      running = false
    }
    scheduleWake()
  }

  function kick(): void {
    if (running || halted || !api.configured) return
    void run()
  }

  function flushWithKeepalive(): void {
    const sessionToken = state.sessionToken
    if (!sessionToken || halted || !api.configured) return
    // Fire-and-forget copies; the normal path re-sends them later, and both requests are idempotent.
    if (state.knocks > state.reportedKnocks) {
      void api.post(
        'record-knocks',
        { sessionToken, totalKnocks: state.knocks },
        { keepalive: true },
      )
    }
    for (const award of state.awards.slice(0, 3)) {
      void api.post('record-award', { sessionToken, ...award }, { keepalive: true })
    }
  }

  return {
    start() {
      rearm(['session', 'awards', 'knocks'])
      kick()
    },

    getVisitor() {
      return state.visitor
    },

    subscribeVisitor(listener) {
      visitorListeners.add(listener)
      listener(state.visitor)
      return () => {
        visitorListeners.delete(listener)
      }
    },

    onAwardRecorded(listener) {
      awardListeners.add(listener)
      return () => {
        awardListeners.delete(listener)
      }
    },

    recordKnock() {
      if (state.knocks >= MAX_SESSION_KNOCKS) return
      state.knocks += 1
      save()
      const now = scheduler.now()
      knockBatchStartedAt ??= now
      knockDueAt = Math.min(
        now + KNOCK_BATCH_DELAY_MS,
        knockBatchStartedAt + KNOCK_BATCH_MAX_DELAY_MS,
      )
      rearm(['session', 'knocks'])
      kick()
    },

    recordAward(prize) {
      if (recordedPrizes.has(prize)) return
      recordedPrizes.add(prize)
      if (!isInCatalog(prize)) {
        warn(`awards: "${prize.id}" is not a catalog prize; not recorded`)
        return
      }
      state.awards.push({
        awardId: uuidFromBytes(deps.randomBytes(16)),
        prizeId: prize.id,
        adjective: prize.adjective,
        location: prize.location,
      })
      if (state.awards.length > MAX_PENDING_AWARDS) {
        state.awards.splice(0, state.awards.length - MAX_PENDING_AWARDS)
        warn('awards: too many unsent gifts; dropped the oldest')
      }
      save()
      rearm(['session', 'awards'])
      kick()
    },

    flush(options) {
      if (options?.keepalive) {
        flushWithKeepalive()
        return
      }
      knockDueAt = Math.min(knockDueAt, scheduler.now())
      kick()
    },
  }
}
