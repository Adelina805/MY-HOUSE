import { assertEquals } from '@std/assert'
import type { GuestbookEntry } from '../../../src/data/apiContract.ts'
import { guestbookEntryPrizeParts } from '../../../src/core/guestbookEntryCopy.ts'

function entry(overrides: Partial<GuestbookEntry> = {}): GuestbookEntry {
  return {
    awardId: '0b6f8f63-3f43-4c8e-9a51-2f1c5e0d7a10',
    visitorNumber: 12,
    alias: 'friendly neighbor',
    prizeId: 'apple',
    objectName: 'apple',
    adjective: 'crisp',
    location: 'North Park',
    awardedAt: '2026-10-29T18:58:00.000Z',
    ...overrides,
  }
}

Deno.test('includes the stored adjective in the bold prize phrase', () => {
  const parts = guestbookEntryPrizeParts(entry())
  assertEquals(parts.article, 'a')
  assertEquals(parts.boldText, 'crisp apple')
  assertEquals(parts.location, 'North Park')
  assertEquals(parts.action, 'received')
})

Deno.test('preserves multi-word adjectives', () => {
  const parts = guestbookEntryPrizeParts(
    entry({ adjective: 'suspiciously shiny', objectName: 'san diego zoo magnet' }),
  )
  assertEquals(parts.boldText, 'suspiciously shiny san diego zoo magnet')
  assertEquals(parts.article, 'a')
})

Deno.test('chooses a or an from the adjective', () => {
  assertEquals(
    guestbookEntryPrizeParts(entry({ adjective: 'suspicious' })).article,
    'a',
  )
  assertEquals(
    guestbookEntryPrizeParts(entry({ adjective: 'optimistic' })).article,
    'an',
  )
})

Deno.test('keeps some for plural objects with an adjective', () => {
  const parts = guestbookEntryPrizeParts(
    entry({ objectName: 'tacos', adjective: 'legendary' }),
  )
  assertEquals(parts.article, 'some')
  assertEquals(parts.boldText, 'legendary tacos')
})

Deno.test('omits a fabricated adjective when the award has none', () => {
  const parts = guestbookEntryPrizeParts(entry({ adjective: '   ' }))
  assertEquals(parts.article, 'an')
  assertEquals(parts.boldText, 'apple')
})

Deno.test('strips a leading article already on the adjective', () => {
  const parts = guestbookEntryPrizeParts(entry({ adjective: 'a shiny' }))
  assertEquals(parts.article, '')
  assertEquals(parts.boldText, 'shiny apple')
})

Deno.test('treats HTML-looking prize text as plain strings', () => {
  const parts = guestbookEntryPrizeParts(
    entry({
      adjective: '<b>crisp</b>',
      objectName: '<img src=x onerror=alert(1)>',
      location: '<script>alert(1)</script>',
    }),
  )
  assertEquals(parts.boldText, '<b>crisp</b> <img src=x onerror=alert(1)>')
  assertEquals(parts.location, '<script>alert(1)</script>')
})

Deno.test('varies got vs received from the award id', () => {
  assertEquals(
    guestbookEntryPrizeParts(entry({ awardId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' })).action,
    'got',
  )
  assertEquals(
    guestbookEntryPrizeParts(entry({ awardId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0' })).action,
    'received',
  )
})
