import {
  articleForAdjective,
  stripLeadingArticle,
} from '../config/prizeCatalog'
import type { GuestbookEntry } from '../data/guestbookRepository'

export interface GuestbookEntryPrizeParts {
  action: 'received' | 'got'
  /** Leading article before the bold prize phrase; empty when the adjective already includes one. */
  article: 'a' | 'an' | 'some' | ''
  /** Adjective + object (or object alone); set via textContent so markup stays escaped. */
  boldText: string
  location: string
}

/** "an apple", "a USB flash drive", "some tacos". */
export function articleForObject(name: string): 'a' | 'an' | 'some' {
  const trimmed = name.trim()
  if (/[^s]s$/i.test(trimmed) && !/\bof\b/i.test(trimmed)) return 'some'
  // Initialisms are read letter by letter: "an MRI", "a USB".
  if (/^[A-Z]{2,}\b/.test(trimmed)) return /^[AEFHILMNORSX]/.test(trimmed) ? 'an' : 'a'
  return /^[aeiou]/i.test(trimmed) ? 'an' : 'a'
}

/** Varies the wording between entries while keeping each gift's sentence stable across loads. */
export function entryAction(awardId: string): 'received' | 'got' {
  return Number.parseInt(awardId.slice(-1), 16) % 2 === 0 ? 'received' : 'got'
}

/**
 * Pure copy for one guestbook prize line. Uses the award's stored adjective — never invents one.
 */
export function guestbookEntryPrizeParts(entry: GuestbookEntry): GuestbookEntryPrizeParts {
  const action = entryAction(entry.awardId)
  const location = entry.location
  const objectName = entry.objectName
  const adjective = stripLeadingArticle(entry.adjective)

  if (!adjective) {
    return {
      action,
      article: articleForObject(objectName),
      boldText: objectName,
      location,
    }
  }

  const objectArticle = articleForObject(objectName)
  // Article from the stored adjective (before strip) so a built-in "a/an" yields ''.
  const article =
    objectArticle === 'some' ? 'some' : articleForAdjective(entry.adjective)
  return {
    action,
    article,
    boldText: `${adjective} ${objectName}`,
    location,
  }
}
