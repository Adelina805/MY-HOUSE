// The public guestbook read through the full chain. The function caches pages per (limit, cursor),
// so each test uses its own limit.
import { assert, assertEquals, assertFalse } from '@std/assert'
import { award, callFunction, guestbook, register } from './_api.ts'
import { integrationTest, resetData, sql } from './_db.ts'

const PUBLIC_ENTRY_FIELDS = [
  'adjective',
  'alias',
  'awardId',
  'awardedAt',
  'location',
  'objectName',
  'prizeId',
  'visitorNumber',
]

integrationTest('an empty guestbook returns zero stats and no entries', async () => {
  await resetData()
  const page = await guestbook('?limit=37')
  assertEquals(page.status, 200)
  assertEquals(page.json, {
    stats: { visitorCount: 0, giftsGiven: 0, doorKnocks: 0 },
    entries: [],
    nextCursor: null,
  })
})

integrationTest('pagination visits every award exactly once, newest first', async () => {
  await resetData()
  const { json } = await register()
  for (let i = 0; i < 7; i += 1) assertEquals((await award(json.sessionToken)).status, 201)

  const seen: string[] = []
  let query = '?limit=3'
  let pages = 0
  for (;;) {
    const page = await guestbook(query)
    assertEquals(page.status, 200)
    assertEquals(page.headers.get('cache-control'), pages === 0 ? 'public, max-age=5' : 'public, max-age=60')
    for (const entry of page.json.entries) {
      assertEquals(Object.keys(entry).sort(), PUBLIC_ENTRY_FIELDS)
      seen.push(entry.awardId)
    }
    pages += 1
    if (page.json.nextCursor === null) break
    query = `?limit=3&cursor=${page.json.nextCursor}`
  }
  assertEquals(pages, 3)
  const expected = await sql`select id::text from public.prize_awards order by awarded_at desc, id desc`
  assertEquals(seen, expected.map((row) => row.id))
})

integrationTest('invalid queries are rejected before reaching the database', async () => {
  for (const query of ['?limit=0', '?limit=51', '?limit=abc', '?cursor=abc', '?page=2', '?limit=5&limit=6']) {
    const result = await guestbook(query)
    assertEquals(result.status, 400, query)
    assertEquals(result.json.error.code, 'invalid_request')
  }
  const unknownCursor = await guestbook(`?cursor=${crypto.randomUUID()}`)
  assertEquals(unknownCursor.status, 400)
  assertEquals(unknownCursor.json.error.code, 'invalid_cursor')
  assertEquals((await callFunction('get-guestbook', { method: 'POST', body: {} })).status, 405)
})

integrationTest('a new award appears on the first page within the 5-second cache lifetime', async () => {
  await resetData()
  const { json } = await register()
  const before = await guestbook('?limit=41')
  assertEquals(before.json.entries, [])

  const awarded = await award(json.sessionToken)
  const started = Date.now()
  let visible = false
  while (!visible && Date.now() - started < 8_000) {
    const page = await guestbook('?limit=41')
    visible = page.json.entries.some((entry: { awardId: string }) => entry.awardId === awarded.json.award.awardId)
    if (!visible) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(visible, 'the award never appeared')
  assert(Date.now() - started <= 6_500, `took ${Date.now() - started} ms`)
})

integrationTest('guestbook responses expose only public fields', async () => {
  await resetData()
  const { json } = await register()
  await award(json.sessionToken)
  const page = await guestbook('?limit=43')
  assertEquals(Object.keys(page.json).sort(), ['entries', 'nextCursor', 'stats'])
  assertEquals(Object.keys(page.json.stats).sort(), ['doorKnocks', 'giftsGiven', 'visitorCount'])
  for (const internal of ['session', 'token', 'hash', 'salt', 'registration', 'last_active', 'lastActive']) {
    assertFalse(page.text.includes(internal), internal)
  }
})
