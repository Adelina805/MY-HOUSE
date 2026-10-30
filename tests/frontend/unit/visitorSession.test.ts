import { assert, assertEquals, assertMatch, assertNotEquals } from '@std/assert'
import type { ApiClient } from '../../../src/data/apiClient.ts'
import type { PublicVisitor } from '../../../src/data/apiContract.ts'
import {
  catalogPrize,
  createTestSession,
  failure,
  FakeClock,
  FakeServer,
  MemoryStorage,
  SECRET,
  settle,
  STORAGE_KEY,
  UUID_V4,
} from './_fakes.ts'

function setup() {
  const server = new FakeServer()
  const clock = new FakeClock()
  const storage = new MemoryStorage()
  return { server, clock, storage, ...createTestSession(server, clock, storage) }
}

function knockTotals(server: FakeServer): number[] {
  return server.requestsTo('record-knocks').map((request) => request.body.totalKnocks)
}

async function knock(session: { recordKnock(): void }, clock: FakeClock, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) session.recordKnock()
  await clock.advance(2000)
}

Deno.test('registers on start and resumes the same visitor after a reload', async () => {
  const { server, clock, storage, session } = setup()
  const seen: Array<number | null> = []
  session.subscribeVisitor((visitor) => seen.push(visitor?.visitorNumber ?? null))
  session.start()
  await settle()

  const [registration] = server.requestsTo('start-session')
  assertMatch(registration.body.registrationKey, SECRET)
  assertEquals(Object.keys(registration.body), ['registrationKey'])
  assertEquals(session.getVisitor()?.visitorNumber, 1)
  assertEquals(seen, [null, 1])
  const stored = storage.visit()
  assertMatch(stored.sessionToken, SECRET)
  assertEquals(stored.registrationKey, null, 'the key is deleted once the token is stored')

  const reloaded = createTestSession(server, clock, storage).session
  assertEquals(reloaded.getVisitor()?.visitorNumber, 1, 'shown from storage before the network answers')
  reloaded.start()
  await settle()
  assertEquals(server.requests.at(-1)?.body, { sessionToken: stored.sessionToken })
  assertEquals(reloaded.getVisitor()?.visitorNumber, 1)
  assertEquals(server.sessions.size, 1, 'a reload is not a new visitor')
})

Deno.test('saves the registration key before sending and resends it after a lost response', async () => {
  const { server, clock, storage, session } = setup()
  server.loseResponses.set('start-session', 1)
  session.start()

  const pending = storage.visit()
  assertMatch(pending.registrationKey, SECRET)
  assertEquals(pending.sessionToken, null)
  await settle()
  assertEquals(session.getVisitor(), null)
  assertEquals(server.sessions.size, 1, 'the server registered the visit; only the response was lost')

  await clock.advance(1000)
  const [first, retry] = server.requestsTo('start-session')
  assertEquals(retry.body.registrationKey, first.body.registrationKey)
  assertEquals(server.sessions.size, 1, 'the retry replays the same visit')
  assertEquals(session.getVisitor()?.visitorNumber, 1)
  assertEquals(storage.visit().registrationKey, null)
})

Deno.test('a registration key restored from storage is resent instead of starting a second visit', async () => {
  const { server, clock, storage, session } = setup()
  server.loseResponses.set('start-session', 1)
  session.start()
  await settle()
  const key = storage.visit().registrationKey

  const reloaded = createTestSession(server, clock, storage).session
  reloaded.start()
  await settle()
  assertEquals(server.requests.at(-1)?.body, { registrationKey: key })
  assertEquals(reloaded.getVisitor()?.visitorNumber, 1)
  assertEquals(server.sessions.size, 1)
})

Deno.test('batches knocks and reports cumulative totals across restarts', async () => {
  const { server, clock, session } = setup()
  session.start()
  await settle()

  session.recordKnock()
  await clock.advance(500)
  session.recordKnock()
  await clock.advance(500)
  session.recordKnock()
  await clock.advance(1999)
  assertEquals(knockTotals(server), [], 'waits for a pause in knocking')
  await clock.advance(1)
  assertEquals(knockTotals(server), [3])

  await knock(session, clock, 3)
  assertEquals(knockTotals(server), [3, 6], 'the second round continues the session total')
  assertEquals([...server.sessions.values()][0].visitor.knockCount, 6)
  assertEquals(session.getVisitor()?.knockCount, 6, 'the visitor reflects confirmed knocks')
})

Deno.test('steady knocking is still reported within 8 seconds', async () => {
  const { server, clock, session } = setup()
  session.start()
  await settle()
  for (let i = 0; i < 6; i += 1) {
    session.recordKnock()
    await clock.advance(1500)
  }
  assertEquals(knockTotals(server), [6])
})

Deno.test('retries a failed knock batch with the same total after Retry-After', async () => {
  const { server, clock, session } = setup()
  session.start()
  await settle()
  server.failNext.set('record-knocks', [failure(429, 'rate_limited', 5)])

  await knock(session, clock, 3)
  assertEquals(knockTotals(server), [3])
  await clock.advance(5000)
  assertEquals(knockTotals(server), [3], 'no retry before Retry-After has passed')
  await clock.advance(125)
  assertEquals(knockTotals(server), [3, 3])
  assertEquals([...server.sessions.values()][0].visitor.knockCount, 3)
})

Deno.test('repeated short Retry-After answers still back off exponentially', async () => {
  const { server, clock, session } = setup()
  server.failNext.set('start-session', Array.from({ length: 4 }, () => failure(503, 'busy', 1)))
  const startedAt = clock.time
  session.start()
  const attemptsAt = [0]
  while (server.requestsTo('start-session').length < 5 && clock.time - startedAt < 60_000) {
    const before = server.requestsTo('start-session').length
    await clock.advance(125)
    if (server.requestsTo('start-session').length > before) attemptsAt.push(clock.time - startedAt)
  }
  // Retry-After (1 s, plus jitter) is the floor; consecutive failures still double the wait.
  assertEquals(attemptsAt, [0, 1125, 3125, 7125, 15125])
  assertEquals(session.getVisitor()?.visitorNumber, 1)
})

Deno.test('a lost knock response is retried without double counting', async () => {
  const { server, clock, session } = setup()
  session.start()
  await settle()
  server.loseResponses.set('record-knocks', 1)

  await knock(session, clock, 3)
  await clock.advance(1000)
  assertEquals(knockTotals(server), [3, 3])
  assertEquals([...server.sessions.values()][0].visitor.knockCount, 3)
})

Deno.test('stops counting at the 5000-knock ceiling the API accepts', async () => {
  const { server, clock, session } = setup()
  session.start()
  await settle()
  await knock(session, clock, 5003)
  assertEquals(knockTotals(server), [5000])
})

Deno.test('knocks recorded before a reload are reported after it', async () => {
  const { server, clock, storage, session } = setup()
  session.start()
  await settle()
  session.recordKnock()
  session.recordKnock()

  const reloaded = createTestSession(server, clock, storage).session
  reloaded.start()
  await settle()
  assertEquals(knockTotals(server), [2])
})

Deno.test('one award id per revealed prize, reused for every retry until confirmed', async () => {
  const { server, clock, storage, session, recorded } = setup()
  const prize = catalogPrize(0)
  server.offline = true
  session.start()
  session.recordAward(prize)
  session.recordAward(prize)

  const queued = storage.visit().awards
  assertEquals(queued.length, 1, 'a repeated callback for the same prize is ignored')
  assertMatch(queued[0].awardId, UUID_V4)
  assertEquals(queued[0], { awardId: queued[0].awardId, prizeId: prize.id, adjective: prize.adjective, location: prize.location })

  await clock.advance(10_000)
  assertEquals(recorded(), 0)
  server.offline = false
  await clock.advance(30_000)

  const sent = server.requestsTo('record-award')
  assert(sent.length >= 1)
  assertEquals(new Set(sent.map((request) => request.body.awardId)), new Set([queued[0].awardId]))
  assertEquals(server.awards.size, 1)
  assertEquals(storage.visit().awards, [])
  assertEquals(recorded(), 1)
})

Deno.test('a lost award response is retried with the same id and stored once', async () => {
  const { server, clock, session, recorded } = setup()
  session.start()
  await settle()
  server.loseResponses.set('record-award', 1)
  session.recordAward(catalogPrize(1))
  await settle()
  assertEquals(recorded(), 0, 'not reported as saved before the server confirms')

  await clock.advance(1000)
  const [first, retry] = server.requestsTo('record-award')
  assertEquals(retry.body, first.body)
  assertEquals(server.awards.size, 1)
  assertEquals(recorded(), 1)
})

Deno.test('each round prize gets its own award id', async () => {
  const { server, session, recorded } = setup()
  session.start()
  session.recordAward(catalogPrize(2))
  session.recordAward(catalogPrize(2))
  await settle()
  const ids = server.requestsTo('record-award').map((request) => request.body.awardId)
  assertEquals(ids.length, 2)
  assertNotEquals(ids[0], ids[1])
  assertEquals(recorded(), 2)
})

Deno.test('unsent awards survive a reload and keep their id', async () => {
  const { server, clock, storage, session } = setup()
  server.offline = true
  session.start()
  session.recordAward(catalogPrize(3))
  await settle()
  const [award] = storage.visit().awards

  server.offline = false
  const reloaded = createTestSession(server, clock, storage).session
  reloaded.start()
  await settle()
  assert(server.awards.has(award.awardId))
  assertEquals(server.awards.size, 1)
  assertEquals(storage.visit().awards, [])
})

Deno.test('the fallback prize is not a catalog prize and is never sent', async () => {
  const { server, session, warnings } = setup()
  session.start()
  session.recordAward({ id: 'fallback-mystery', adjective: 'mysterious', location: 'somewhere nearby' })
  session.recordAward({ ...catalogPrize(0), location: 'the moon' })
  await settle()
  assertEquals(server.requestsTo('record-award'), [])
  assertEquals(warnings.length, 2)
})

for (const refusal of [
  failure(409, 'award_id_conflict'),
  failure(422, 'invalid_prize'),
  failure(400, 'invalid_request'),
]) {
  Deno.test(`an award refused with ${refusal.code} is dropped, not retried with a new id`, async () => {
    const { server, clock, storage, session, warnings, recorded } = setup()
    session.start()
    await settle()
    server.failNext.set('record-award', [refusal])
    session.recordAward(catalogPrize(4))
    await clock.advance(60_000)
    assertEquals(server.requestsTo('record-award').length, 1)
    assertEquals(storage.visit().awards, [])
    assertEquals(recorded(), 0)
    assertEquals(warnings.length, 1)
  })
}

Deno.test('an expired session starts a new visit and carries over only unreported knocks', async () => {
  const { server, clock, session } = setup()
  const seen: Array<PublicVisitor | null> = []
  session.subscribeVisitor((visitor) => seen.push(visitor))
  session.start()
  await settle()
  await knock(session, clock, 3)
  session.recordKnock()
  session.recordKnock()
  server.expireAllSessions()

  await clock.advance(2000)
  const [first, second] = [...server.sessions.values()]
  assertEquals(first.visitor.knockCount, 3)
  assertEquals(second.visitor.knockCount, 2, 'the 3 knocks already counted are not sent again')
  assertEquals(session.getVisitor()?.visitorNumber, 2)
  assertEquals(
    seen.map((visitor) => (visitor ? `#${visitor.visitorNumber}:${visitor.knockCount}` : null)),
    [null, '#1:0', '#1:3', null, '#2:0', '#2:2'],
  )
})

Deno.test('an award pending when the session expires is recorded for the new visit with the same id', async () => {
  const { server, clock, storage, session } = setup()
  session.start()
  await settle()
  server.expireAllSessions()
  session.recordAward(catalogPrize(5))
  const [queued] = storage.visit().awards
  await clock.advance(1000)
  assertEquals(server.sessions.size, 2)
  assertEquals(server.awards.get(queued.awardId)?.token, storage.visit().sessionToken)
})

Deno.test('stops re-registering when the server keeps rejecting new sessions', async () => {
  const { server, clock, session, warnings } = setup()
  server.failNext.set('record-knocks', Array.from({ length: 10 }, () => failure(401, 'invalid_session')))
  session.start()
  await settle()
  await knock(session, clock, 1)
  await clock.advance(60_000)
  assertEquals(server.sessions.size, 3, 'the first visit plus two re-registrations')
  assertEquals(server.requestsTo('record-knocks').length, 3)
  assert(warnings.some((warning) => warning.includes('stopped syncing')))
})

Deno.test('configuration errors stop all syncing for the page', async () => {
  const { server, clock, session, warnings } = setup()
  server.failNext.set('start-session', [failure(401, 'invalid_api_key')])
  session.start()
  await settle()
  session.recordKnock()
  session.recordAward(catalogPrize(0))
  session.start()
  await clock.advance(600_000)
  assertEquals(server.requests.length, 1)
  assertEquals(warnings.length, 1)
})

Deno.test('backs off during an outage, pauses, and resumes on new activity', async () => {
  const { server, clock, session } = setup()
  server.offline = true
  session.start()
  await clock.advance(600_000)
  const attempts = server.requestsTo('start-session').length
  assertEquals(attempts, 8, 'about 90 s of retries, then it waits for activity')

  server.offline = false
  await clock.advance(600_000)
  assertEquals(server.requestsTo('start-session').length, attempts)
  session.recordKnock()
  await clock.advance(2000)
  assertEquals(session.getVisitor()?.visitorNumber, 1)
  assertEquals(knockTotals(server), [1])
})

Deno.test('keepalive flush sends copies of unsent work and keeps it queued', async () => {
  const { server, clock, storage, session } = setup()
  session.start()
  await settle()
  server.offline = true
  session.recordKnock()
  session.recordAward(catalogPrize(6))
  await settle()
  const [award] = storage.visit().awards
  const before = server.requests.length

  session.flush({ keepalive: true })
  const copies = server.requests.slice(before)
  assertEquals(copies.map((request) => [request.name, request.keepalive]), [
    ['record-knocks', true],
    ['record-award', true],
  ])
  assertEquals(copies[1].body.awardId, award.awardId)
  assertEquals(storage.visit().awards, [award])
  await clock.advance(0)
})

Deno.test('ignores unreadable or tampered storage', async () => {
  for (const raw of ['{not json', '{"v":1,"sessionToken":"short","knocks":-4,"awards":[{"awardId":"x"}]}', '{"v":2}']) {
    const server = new FakeServer()
    const clock = new FakeClock()
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, raw)
    const { session } = createTestSession(server, clock, storage)
    assertEquals(session.getVisitor(), null)
    session.start()
    await settle()
    assertEquals(Object.keys(server.requests[0].body), ['registrationKey'])
    assertEquals(storage.visit().awards, [])
  }
})

Deno.test('works for one page load when storage is unavailable', async () => {
  const server = new FakeServer()
  const clock = new FakeClock()
  const { session } = createTestSession(server, clock, null)
  session.start()
  await knock(session, clock, 2)
  assertEquals(session.getVisitor()?.visitorNumber, 1)
  assertEquals(knockTotals(server), [2])
})

Deno.test('does nothing when the backend is not configured', async () => {
  const server = new FakeServer()
  const clock = new FakeClock()
  const offline: ApiClient = {
    configured: false,
    post: () => Promise.reject(new Error('must not be called')),
    get: () => Promise.reject(new Error('must not be called')),
  }
  const { session } = createTestSession(server, clock, new MemoryStorage(), offline)
  session.start()
  session.recordKnock()
  session.recordAward(catalogPrize(0))
  session.flush()
  session.flush({ keepalive: true })
  await clock.advance(60_000)
  assertEquals(session.getVisitor(), null)
})
