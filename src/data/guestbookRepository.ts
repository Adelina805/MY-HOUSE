import type { ApiClient } from './apiClient'
import type { GuestbookEntry, GuestbookPageResponse, GuestbookStats } from './apiContract'

export type { GuestbookEntry, GuestbookStats }

export type GuestbookPageResult =
  | { ok: true; page: GuestbookPageResponse }
  /** `invalid_cursor`: start again from the first page. */
  | { ok: false; reason: 'invalid_cursor' | 'unavailable' }

/**
 * Data-access boundary for guestbook content. UI code should only import from this module.
 */
export interface GuestbookRepository {
  /** Newest first. Pass the previous page's `nextCursor` for older entries. */
  loadPage(cursor?: string | null): Promise<GuestbookPageResult>
}

export interface GuestbookRepositoryOptions {
  pageSize?: number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_PAGE_SIZE = 20
/** Reads are retried briefly; anything slower is shown as an error the visitor can retry. */
const MAX_ATTEMPTS = 3
const MAX_WAIT_MS = 5000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isStats(value: unknown): value is GuestbookStats {
  return (
    isRecord(value) &&
    isCount(value.visitorCount) &&
    isCount(value.giftsGiven) &&
    isCount(value.doorKnocks)
  )
}

function isEntry(value: unknown): value is GuestbookEntry {
  return (
    isRecord(value) &&
    typeof value.awardId === 'string' &&
    isCount(value.visitorNumber) &&
    typeof value.alias === 'string' &&
    typeof value.prizeId === 'string' &&
    typeof value.objectName === 'string' &&
    typeof value.adjective === 'string' &&
    typeof value.location === 'string' &&
    typeof value.awardedAt === 'string' &&
    Number.isFinite(Date.parse(value.awardedAt))
  )
}

function toPage(data: unknown): GuestbookPageResponse | null {
  if (!isRecord(data) || !isStats(data.stats) || !Array.isArray(data.entries)) return null
  if (data.nextCursor !== null && typeof data.nextCursor !== 'string') return null
  return {
    stats: data.stats,
    entries: data.entries.filter(isEntry),
    nextCursor: data.nextCursor,
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function createGuestbookRepository(
  api: ApiClient,
  options: GuestbookRepositoryOptions = {},
): GuestbookRepository {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const sleep = options.sleep ?? defaultSleep

  return {
    async loadPage(cursor) {
      const query: Record<string, string> = { limit: String(pageSize) }
      if (cursor) query.cursor = cursor

      for (let attempt = 1; ; attempt += 1) {
        const result = await api.get<GuestbookPageResponse>('get-guestbook', query)
        if (result.ok) {
          const page = toPage(result.data)
          if (page) return { ok: true, page }
        } else if (result.failure.code === 'invalid_cursor') {
          return { ok: false, reason: 'invalid_cursor' }
        } else if (!result.failure.retryable) {
          return { ok: false, reason: 'unavailable' }
        }

        const retryAfterSeconds = result.ok ? null : result.failure.retryAfterSeconds
        const waitMs =
          retryAfterSeconds !== null ? retryAfterSeconds * 1000 : 500 * 2 ** (attempt - 1)
        if (attempt >= MAX_ATTEMPTS || waitMs > MAX_WAIT_MS) {
          return { ok: false, reason: 'unavailable' }
        }
        await sleep(waitMs)
      }
    },
  }
}
