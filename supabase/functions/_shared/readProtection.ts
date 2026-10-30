/**
 * Per-isolate protection for the public guestbook read. Nothing here writes to the database, and
 * nothing depends on client IP headers unless the per-network layer is configured:
 *
 * - a response cache keyed by (limit, cursor): 5 s for the first page, 60 s for cursor pages;
 * - single flight: concurrent misses on one key share one database call;
 * - a database read budget (20 cache misses per second). Over budget, or when the database is
 *   unavailable, a stale copy is served if one exists; otherwise the caller gets 503 busy.
 */
import type { ApiResponse } from './http.ts'

export interface ReadProtectionOptions {
  now: () => number
  firstPageTtlMs?: number
  cursorPageTtlMs?: number
  /** How old a cached page may be and still be served while over budget or unavailable. */
  maxStaleMs?: number
  readsPerSecond?: number
  maxEntries?: number
  networkRequestsPerMinute?: number
  maxTrackedNetworks?: number
}

export type PageLoad =
  | { ok: true; json: string }
  | { ok: false; response: ApiResponse; retryable: boolean }

export type PageOutcome =
  | { kind: 'fresh' | 'cached' | 'stale'; json: string; maxAgeSeconds: number }
  | { kind: 'busy' }
  | { kind: 'failed'; response: ApiResponse }

interface CacheEntry {
  json: string
  storedAt: number
  freshUntil: number
}

interface NetworkWindow {
  startedAt: number
  used: number
}

const NETWORK_WINDOW_MS = 60_000
const STALE_MAX_AGE_SECONDS = 1

export class ReadProtection {
  readonly #now: () => number
  readonly #firstPageTtlMs: number
  readonly #cursorPageTtlMs: number
  readonly #maxStaleMs: number
  readonly #readsPerSecond: number
  readonly #maxEntries: number
  readonly #networkLimit: number
  readonly #maxTrackedNetworks: number

  readonly #cache = new Map<string, CacheEntry>()
  readonly #inFlight = new Map<string, Promise<PageLoad>>()
  readonly #networks = new Map<string, NetworkWindow>()
  #readTokens: number
  #refilledAt: number

  constructor(options: ReadProtectionOptions) {
    this.#now = options.now
    this.#firstPageTtlMs = options.firstPageTtlMs ?? 5_000
    this.#cursorPageTtlMs = options.cursorPageTtlMs ?? 60_000
    this.#maxStaleMs = options.maxStaleMs ?? 300_000
    this.#readsPerSecond = options.readsPerSecond ?? 20
    this.#maxEntries = options.maxEntries ?? 500
    this.#networkLimit = options.networkRequestsPerMinute ?? 120
    this.#maxTrackedNetworks = options.maxTrackedNetworks ?? 10_000
    this.#readTokens = this.#readsPerSecond
    this.#refilledAt = this.#now()
  }

  async getPage(limit: number, cursor: string | null, load: () => Promise<PageLoad>): Promise<PageOutcome> {
    const key = `${limit}:${cursor ?? ''}`
    const ttlMs = cursor === null ? this.#firstPageTtlMs : this.#cursorPageTtlMs
    const maxAgeSeconds = Math.round(ttlMs / 1000)
    const now = this.#now()

    const cached = this.#cache.get(key)
    if (cached && now < cached.freshUntil) return { kind: 'cached', json: cached.json, maxAgeSeconds }
    const stale = cached && now - cached.storedAt <= this.#maxStaleMs ? cached : undefined

    let pending = this.#inFlight.get(key)
    if (!pending) {
      if (!this.#takeReadToken(now)) {
        return stale ? { kind: 'stale', json: stale.json, maxAgeSeconds: STALE_MAX_AGE_SECONDS } : { kind: 'busy' }
      }
      pending = load()
        .then((result) => {
          if (result.ok) this.#store(key, result.json, ttlMs)
          return result
        })
        .finally(() => this.#inFlight.delete(key))
      this.#inFlight.set(key, pending)
    }

    const result = await pending
    if (result.ok) return { kind: 'fresh', json: result.json, maxAgeSeconds }
    if (result.retryable && stale) {
      return { kind: 'stale', json: stale.json, maxAgeSeconds: STALE_MAX_AGE_SECONDS }
    }
    return { kind: 'failed', response: result.response }
  }

  /** 0 when the network may read now; otherwise the seconds until its window resets. */
  takeNetworkRequest(networkKey: string): number {
    const now = this.#now()
    let window = this.#networks.get(networkKey)
    if (!window || now - window.startedAt >= NETWORK_WINDOW_MS) {
      this.#networks.delete(networkKey)
      window = { startedAt: now, used: 0 }
      this.#networks.set(networkKey, window)
      this.#evictOldest(this.#networks, this.#maxTrackedNetworks)
    }
    if (window.used >= this.#networkLimit) {
      return Math.max(1, Math.ceil((window.startedAt + NETWORK_WINDOW_MS - now) / 1000))
    }
    window.used += 1
    return 0
  }

  #takeReadToken(now: number): boolean {
    const elapsedMs = Math.max(0, now - this.#refilledAt)
    this.#readTokens = Math.min(
      this.#readsPerSecond,
      this.#readTokens + (elapsedMs * this.#readsPerSecond) / 1000,
    )
    this.#refilledAt = now
    if (this.#readTokens < 1) return false
    this.#readTokens -= 1
    return true
  }

  #store(key: string, json: string, ttlMs: number): void {
    const now = this.#now()
    this.#cache.delete(key)
    this.#cache.set(key, { json, storedAt: now, freshUntil: now + ttlMs })
    this.#evictOldest(this.#cache, this.#maxEntries)
  }

  #evictOldest<V>(map: Map<string, V>, maxSize: number): void {
    for (const key of map.keys()) {
      if (map.size <= maxSize) return
      map.delete(key)
    }
  }
}
