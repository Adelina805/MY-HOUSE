/** Guestbook stats shown on the expanded notebook header. */
export interface GuestbookStats {
  visitorCount: number
  uniqueObjectsFound: number
  totalObjects: number
  totalKnocks: number
}

/** One recent-visitor row on the guestbook. */
export interface GuestbookEntry {
  id: string
  alias: string
  prizeId: string
  adjective: string
  objectName: string
  location: string
  /** ISO-8601 timestamp; display formatting happens in the UI. */
  createdAt: string
  action: 'received' | 'got'
}
