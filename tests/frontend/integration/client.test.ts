/**
 * The frontend data layer (src/data) against the local stack, sending what a browser on the Vite
 * dev server sends. Shares the Stage A helpers, which refuse to run against anything but local.
 */
import { assert, assertEquals } from '@std/assert'
import { createApiClient, parseApiConfig } from '../../../src/data/apiClient.ts'
import { createGuestbookRepository } from '../../../src/data/guestbookRepository.ts'
import { PRIZES } from '../../../src/data/prizes.ts'
import { createVisitorSession } from '../../../src/data/visitorSession.ts'
import {
  integrationTest,
  resetData,
  sessionIdForToken,
  sql,
  totals,
  visitorCount,
  waitUntil,
} from '../../../supabase/functions/tests/integration/_db.ts'
import { ALLOWED_ORIGIN, stack } from '../../../supabase/functions/tests/integration/_env.ts'
import { MemoryStorage } from '../unit/_fakes.ts'

const parsed = parseApiConfig({ url: new URL(stack.functionsUrl).origin, publishableKey: stack.publishableKey })
if (!parsed.ok) throw new Error(parsed.problem)
const config = parsed.config

interface Exchange {
  name: string
  // deno-lint-ignore no-explicit-any
  body: any
  delivered: boolean
}

/** A browser-like transport. `lose` drops responses after the server has handled the request. */
function createClient(storage = new MemoryStorage()) {
  const exchanges: Exchange[] = []
  const lose = new Map<string, number>()
  const api = createApiClient(config, {
    fetch: async (input, init) => {
      const headers = new Headers(init.headers)
      headers.set('origin', ALLOWED_ORIGIN)
      const name = new URL(input).pathname.split('/').pop()!
      const exchange: Exchange = { name, body: init.body ? JSON.parse(String(init.body)) : null, delivered: false }
      exchanges.push(exchange)
      const response = await fetch(input, { ...init, headers })
      const pending = lose.get(name) ?? 0
      if (pending > 0) {
        lose.set(name, pending - 1)
        await response.body?.cancel()
        throw new TypeError('connection lost after the server handled the request')
      }
      exchange.delivered = true
      return response
    },
  })
  const warnings: string[] = []
  const session = createVisitorSession({
    api,
    storage,
    scheduler: {
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as number),
    },
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    random: () => 0,
    warn: (message) => warnings.push(message),
  })
  const sent = (name: string) => exchanges.filter((exchange) => exchange.name === name)
  const delivered = (name: string) => sent(name).filter((exchange) => exchange.delivered).length
  return { api, session, storage, lose, sent, delivered, warnings }
}

async function registered(client: ReturnType<typeof createClient>): Promise<void> {
  client.session.start()
  await waitUntil(() => Promise.resolve(client.delivered('start-session') > 0), 'start-session')
}

async function knockCounts(): Promise<number[]> {
  const rows = await sql`select knock_count from public.visitor_sessions order by visitor_number`
  return rows.map((row) => row.knock_count)
}

function prizeAt(index: number) {
  const prize = PRIZES[index]
  return { id: prize.id, adjective: prize.adjectives.at(-1)!, location: prize.locations.at(-1)! }
}

integrationTest('registers once, and a reload resumes the same visitor', async () => {
  await resetData()
  const first = createClient()
  await registered(first)
  const visitor = first.session.getVisitor()
  assert(visitor && visitor.visitorNumber > 0 && visitor.alias.length > 0)
  assertEquals(await visitorCount(), 1)

  const reloaded = createClient(first.storage)
  assertEquals(reloaded.session.getVisitor(), visitor, 'shown from sessionStorage immediately')
  await registered(reloaded)
  assertEquals(Object.keys(reloaded.sent('start-session')[0].body), ['sessionToken'])
  assertEquals(reloaded.session.getVisitor(), visitor)
  assertEquals(await visitorCount(), 1)
})

integrationTest('a lost registration response is replayed with the same key, not a second visitor', async () => {
  await resetData()
  const client = createClient()
  client.lose.set('start-session', 1)
  await registered(client)
  const [lost, retried] = client.sent('start-session')
  assertEquals(retried.body.registrationKey, lost.body.registrationKey)
  assertEquals(await visitorCount(), 1)
  assertEquals(client.storage.visit().registrationKey, null)
})

integrationTest('knocks are batched as cumulative totals and a lost response is not double counted', async () => {
  await resetData()
  const client = createClient()
  await registered(client)

  for (let i = 0; i < 3; i += 1) client.session.recordKnock()
  client.session.flush()
  await waitUntil(() => Promise.resolve(client.delivered('record-knocks') === 1), 'first batch')
  assertEquals(await knockCounts(), [3])

  client.lose.set('record-knocks', 1)
  for (let i = 0; i < 3; i += 1) client.session.recordKnock()
  client.session.flush()
  await waitUntil(() => Promise.resolve(client.delivered('record-knocks') === 2), 'retried batch')
  assertEquals(client.sent('record-knocks').map((exchange) => exchange.body.totalKnocks), [3, 6, 6])
  assertEquals(await knockCounts(), [6])
  const { stored, actual } = await totals()
  assertEquals(stored, actual)
  assertEquals(stored.doorKnocks, 6)
})

integrationTest('a prize is stored once under its award id when the first response is lost', async () => {
  await resetData()
  const client = createClient()
  await registered(client)
  client.lose.set('record-award', 1)
  client.session.recordAward(prizeAt(10))
  await waitUntil(() => Promise.resolve(client.delivered('record-award') === 1), 'award retry')

  const rows = await sql`select id::text as id, prize_id, adjective, location from public.prize_awards`
  assertEquals(rows.length, 1)
  const ids = new Set(client.sent('record-award').map((exchange) => exchange.body.awardId))
  assertEquals(ids, new Set([rows[0].id]))
  assertEquals(client.sent('record-award').length, 2)
  assertEquals(
    { prizeId: rows[0].prize_id, adjective: rows[0].adjective, location: rows[0].location },
    { prizeId: prizeAt(10).id, adjective: prizeAt(10).adjective, location: prizeAt(10).location },
  )
  assertEquals(client.storage.visit().awards, [])
  const { stored, actual } = await totals()
  assertEquals(stored, actual)
  assertEquals(stored.giftsGiven, 1)
})

integrationTest('an expired session becomes a new visit that carries over only unreported knocks', async () => {
  await resetData()
  const client = createClient()
  await registered(client)
  for (let i = 0; i < 3; i += 1) client.session.recordKnock()
  client.session.flush()
  await waitUntil(() => Promise.resolve(client.delivered('record-knocks') === 1), 'first batch')

  client.session.recordKnock()
  client.session.recordKnock()
  const sessionId = await sessionIdForToken(client.storage.visit().sessionToken)
  await sql`
    update public.visitor_sessions
       set last_active_at = now() - interval '25 hours'
     where id = ${sessionId}::uuid`
  client.session.flush()
  await waitUntil(async () => (await knockCounts()).join() === '3,2', 'knocks on the new visit')

  assertEquals(await visitorCount(), 2)
  const [{ visitor_number: newest }] = await sql`select max(visitor_number)::int as visitor_number from public.visitor_sessions`
  assertEquals(client.session.getVisitor()?.visitorNumber, newest)
  const { stored, actual } = await totals()
  assertEquals(stored, actual)
  assertEquals(stored.doorKnocks, 5)
})

integrationTest('the guestbook repository pages through real entries, newest first', async () => {
  await resetData()
  const client = createClient()
  await registered(client)
  for (let i = 0; i < 5; i += 1) client.session.recordAward(prizeAt(20 + i))
  await waitUntil(() => Promise.resolve(client.delivered('record-award') === 5), 'five awards')

  // A page size no other test uses: get-guestbook caches pages per (limit, cursor) for 5 s.
  const repository = createGuestbookRepository(client.api, { pageSize: 2 })
  const sizes: number[] = []
  const entries = []
  let cursor: string | null = null
  do {
    const result = await repository.loadPage(cursor)
    if (!result.ok) throw new Error(`page failed: ${result.reason}`)
    if (cursor === null) {
      assertEquals(result.page.stats, { visitorCount: 1, giftsGiven: 5, doorKnocks: 0 })
    }
    sizes.push(result.page.entries.length)
    entries.push(...result.page.entries)
    cursor = result.page.nextCursor
  } while (cursor !== null)

  assertEquals(sizes, [2, 2, 1])
  const sentIds = client.sent('record-award').map((exchange) => exchange.body.awardId)
  assertEquals(entries.map((entry) => entry.awardId), sentIds.toReversed())
  const visitor = client.session.getVisitor()!
  for (const entry of entries) {
    assertEquals([entry.visitorNumber, entry.alias], [visitor.visitorNumber, visitor.alias])
  }

  assertEquals(await repository.loadPage(crypto.randomUUID()), { ok: false, reason: 'invalid_cursor' })
  assertEquals(
    await repository.loadPage('not-a-cursor'),
    { ok: false, reason: 'unavailable' },
    'a malformed cursor is a plain 400',
  )
})
