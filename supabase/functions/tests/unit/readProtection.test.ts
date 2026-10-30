import { assertEquals } from '@std/assert'
import { apiError } from '../../_shared/http.ts'
import { type PageLoad, ReadProtection } from '../../_shared/readProtection.ts'

function setup(options: { readsPerSecond?: number; maxEntries?: number; networkRequestsPerMinute?: number } = {}) {
  const clock = { now: 1_000_000 }
  const protection = new ReadProtection({ now: () => clock.now, ...options })
  let loads = 0
  const loader = (json: string) => (): Promise<PageLoad> => {
    loads += 1
    return Promise.resolve({ ok: true, json })
  }
  return { clock, protection, loader, loads: () => loads }
}

const unavailable: PageLoad = {
  ok: false,
  response: apiError(503, 'busy', { retryAfterSeconds: 1 }),
  retryable: true,
}

Deno.test('the first page is cached for 5 seconds', async () => {
  const { clock, protection, loader, loads } = setup()
  assertEquals(await protection.getPage(20, null, loader('v1')), { kind: 'fresh', json: 'v1', maxAgeSeconds: 5 })
  clock.now += 4_999
  assertEquals(await protection.getPage(20, null, loader('v2')), { kind: 'cached', json: 'v1', maxAgeSeconds: 5 })
  clock.now += 1
  assertEquals(await protection.getPage(20, null, loader('v2')), { kind: 'fresh', json: 'v2', maxAgeSeconds: 5 })
  assertEquals(loads(), 2)
})

Deno.test('cursor pages are cached for 60 seconds, per limit and cursor', async () => {
  const { clock, protection, loader, loads } = setup()
  const cursor = '0b4f3c1e-2a6d-4f8e-9c3b-7d1e5a9f2c4b'
  await protection.getPage(20, cursor, loader('older'))
  clock.now += 59_999
  assertEquals((await protection.getPage(20, cursor, loader('x'))).kind, 'cached')
  assertEquals((await protection.getPage(10, cursor, loader('other limit'))).kind, 'fresh')
  clock.now += 1
  assertEquals((await protection.getPage(20, cursor, loader('newer'))).kind, 'fresh')
  assertEquals(loads(), 3)
})

Deno.test('concurrent misses on one key share a single database read', async () => {
  const { protection } = setup()
  let release!: (load: PageLoad) => void
  let calls = 0
  const slowLoad = () => {
    calls += 1
    return new Promise<PageLoad>((resolve) => (release = resolve))
  }
  const pending = [1, 2, 3, 4, 5].map(() => protection.getPage(20, null, slowLoad))
  release({ ok: true, json: 'shared' })
  const outcomes = await Promise.all(pending)
  assertEquals(calls, 1)
  for (const outcome of outcomes) assertEquals(outcome, { kind: 'fresh', json: 'shared', maxAgeSeconds: 5 })
})

Deno.test('over the read budget, a stale copy is served, or 503 when there is none', async () => {
  const { clock, protection, loader, loads } = setup({ readsPerSecond: 2 })
  await protection.getPage(1, null, loader('page-1'))
  await protection.getPage(2, null, loader('page-2'))
  assertEquals(await protection.getPage(3, null, loader('page-3')), { kind: 'busy' })

  clock.now += 6_000 // page-1 is now expired but refill gives two new reads
  await protection.getPage(4, null, loader('page-4'))
  await protection.getPage(5, null, loader('page-5'))
  assertEquals(await protection.getPage(1, null, loader('page-1b')), { kind: 'stale', json: 'page-1', maxAgeSeconds: 1 })
  assertEquals(loads(), 4)
})

Deno.test('the read budget refills continuously', async () => {
  const { clock, protection, loader } = setup({ readsPerSecond: 2 })
  await protection.getPage(1, null, loader('a'))
  await protection.getPage(2, null, loader('b'))
  assertEquals((await protection.getPage(3, null, loader('c'))).kind, 'busy')
  clock.now += 250
  assertEquals((await protection.getPage(3, null, loader('c'))).kind, 'busy', 'half a read has accrued')
  clock.now += 250
  assertEquals((await protection.getPage(3, null, loader('c'))).kind, 'fresh')
})

Deno.test('a retryable failure falls back to a stale copy; other failures pass through', async () => {
  const { clock, protection, loader } = setup()
  await protection.getPage(20, null, loader('good'))
  clock.now += 10_000
  assertEquals(await protection.getPage(20, null, () => Promise.resolve(unavailable)), {
    kind: 'stale',
    json: 'good',
    maxAgeSeconds: 1,
  })

  const invalidCursor: PageLoad = { ok: false, response: apiError(400, 'invalid_cursor'), retryable: false }
  const outcome = await protection.getPage(20, null, () => Promise.resolve(invalidCursor))
  assertEquals(outcome, { kind: 'failed', response: invalidCursor.response })

  const fresh = await protection.getPage(7, null, () => Promise.resolve(unavailable))
  assertEquals(fresh, { kind: 'failed', response: unavailable.response })
})

Deno.test('stale copies expire after 5 minutes', async () => {
  const { clock, protection, loader } = setup({ readsPerSecond: 1 })
  await protection.getPage(20, null, loader('old'))
  clock.now += 300_001
  await protection.getPage(1, null, loader('uses the refilled read'))
  assertEquals(await protection.getPage(20, null, loader('new')), { kind: 'busy' })
})

Deno.test('the cache holds a bounded number of pages', async () => {
  const { protection, loader, loads } = setup({ maxEntries: 2, readsPerSecond: 100 })
  await protection.getPage(1, null, loader('1'))
  await protection.getPage(2, null, loader('2'))
  await protection.getPage(3, null, loader('3'))
  assertEquals((await protection.getPage(3, null, loader('3'))).kind, 'cached')
  assertEquals((await protection.getPage(1, null, loader('1 again'))).kind, 'fresh', 'the oldest page was evicted')
  assertEquals(loads(), 4)
})

Deno.test('the per-network limiter allows 120 requests per minute', () => {
  const { clock, protection } = setup()
  for (let i = 0; i < 120; i += 1) assertEquals(protection.takeNetworkRequest('net-a'), 0)
  assertEquals(protection.takeNetworkRequest('net-a'), 60)
  assertEquals(protection.takeNetworkRequest('net-b'), 0, 'networks are limited independently')
  clock.now += 30_500
  assertEquals(protection.takeNetworkRequest('net-a'), 30)
  clock.now += 29_500
  assertEquals(protection.takeNetworkRequest('net-a'), 0, 'a new window starts after a minute')
})
