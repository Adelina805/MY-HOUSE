import {
  MOCK_GUESTBOOK_ENTRIES,
  MOCK_GUESTBOOK_NOW,
  MOCK_GUESTBOOK_STATS,
} from './guestbookMock'
import type { GuestbookEntry, GuestbookStats } from './guestbookTypes'

/**
 * Data-access boundary for guestbook content.
 * Swap these implementations for API calls in a later milestone —
 * UI code should only import from this module.
 */
export function getGuestbookStats(): GuestbookStats {
  return MOCK_GUESTBOOK_STATS
}

export function getRecentGuestbookEntries(): GuestbookEntry[] {
  return MOCK_GUESTBOOK_ENTRIES
}

/** Reference “now” for relative timestamps (mock-stable). */
export function getGuestbookReferenceNow(): Date {
  return new Date(MOCK_GUESTBOOK_NOW)
}
