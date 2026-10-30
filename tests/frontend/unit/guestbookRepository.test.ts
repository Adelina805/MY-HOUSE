import { assertEquals } from '@std/assert'
import type { ApiClient, ApiResult } from '../../../src/data/apiClient.ts'
import type { GuestbookEntry } from '../../../src/data/apiContract.ts'
import { createGuestbookRepository } from '../../../src/data/guestbookRepository.ts'
import { failure } from './_fakes.ts'

const ENTRY: GuestbookEntry = {
  awardId: '0b6f8f63-3f43-4c8e-9a51-2f1c5e0d7a10',
  visitorNumber: 12,
  alias: 'friendly neighbor',
  prizeId: 'apple',
  objectName: 'apple',
  adjective: 'crisp',
  location: 'North Park',
  awardedAt: '2026-10-29T18:58:00.000Z',
}

const PAGE = {
  stats: { visitorCount: 12, giftsGiven: 4, doorKnocks: 40 },
  entries: [ENTRY],
  nextCursor: 'cursor-2',
}

function setup(results: ApiResult<unknown>[]) {
  const queries: Array<Record<string, string> | undefined> = []
  const sleeps: number[] = []
  const api: ApiClient = {
    configured: true,
    post: () => Promise.reject(new Error('the guestbook only reads')),
    get<T>(name: string, query?: Record<string, string>) {
      assertEquals(name, 'get-guestbook')
      queries.push(query)
      const next = results.shift()
      if (!next) throw new Error('unexpected request')
      return Promise.resolve(next as ApiResult<T>)
    },
  }
  const repository = createGuestbookRepository(api, {
    sleep: (ms) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
  })
  return { repository, queries, sleeps }
}

const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data })
const fail = (...args: Parameters<typeof failure>): ApiResult<unknown> => ({ ok: false, failure: failure(...args) })

Deno.test('loads the first page with the page size and older pages with the cursor', async () => {
  const { repository, queries } = setup([ok(PAGE), ok({ ...PAGE, nextCursor: null })])
  assertEquals(await repository.loadPage(), { ok: true, page: PAGE })
  assertEquals((await repository.loadPage('cursor-2')).ok, true)
  assertEquals(queries, [{ limit: '20' }, { limit: '20', cursor: 'cursor-2' }])
})

Deno.test('a rejected cursor is reported so the caller can start over', async () => {
  const { repository, queries } = setup([fail(400, 'invalid_cursor')])
  assertEquals(await repository.loadPage('stale'), { ok: false, reason: 'invalid_cursor' })
  assertEquals(queries.length, 1)
})

Deno.test('waits for a short Retry-After, then gives up on long ones', async () => {
  const busy = setup([fail(503, 'busy', 1), ok(PAGE)])
  assertEquals((await busy.repository.loadPage()).ok, true)
  assertEquals(busy.sleeps, [1000])

  const limited = setup([fail(429, 'rate_limited', 30)])
  assertEquals(await limited.repository.loadPage(), { ok: false, reason: 'unavailable' })
  assertEquals(limited.sleeps, [], 'never blocks the guestbook for a long wait')
})

Deno.test('retries network failures briefly, then reports the guestbook unavailable', async () => {
  const { repository, queries, sleeps } = setup([fail(0, 'network'), fail(0, 'network'), fail(0, 'network')])
  assertEquals(await repository.loadPage(), { ok: false, reason: 'unavailable' })
  assertEquals(queries.length, 3)
  assertEquals(sleeps, [500, 1000])
})

Deno.test('does not retry requests the server refused', async () => {
  const { repository, queries } = setup([fail(400, 'invalid_request')])
  assertEquals(await repository.loadPage(), { ok: false, reason: 'unavailable' })
  assertEquals(queries.length, 1)
})

Deno.test('rejects malformed pages and drops malformed entries', async () => {
  const broken = setup([ok({ entries: [] }), ok({ stats: PAGE.stats }), ok(null)])
  assertEquals(await broken.repository.loadPage(), { ok: false, reason: 'unavailable' })

  const mixed = setup([ok({ ...PAGE, entries: [ENTRY, { awardId: 7 }, { ...ENTRY, awardedAt: 'yesterday' }] })])
  const result = await mixed.repository.loadPage()
  assertEquals(result.ok && result.page.entries, [ENTRY])
})
