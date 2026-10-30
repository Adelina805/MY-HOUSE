// Rate limits through the full chain: explicit 429s with retry guidance, nothing recorded when
// refused, and exactly-once success when the same request is retried after the window.
import { assert, assertEquals } from '@std/assert'
import { award, callFunction, knock, newKey, register, resume } from './_api.ts'
import {
  endWindow,
  fillBucket,
  integrationTest,
  resetData,
  sessionIdForToken,
  sql,
  totals,
  visitorCount,
} from './_db.ts'

function assertRateLimited(result: Awaited<ReturnType<typeof register>>, maxSeconds: number): number {
  assertEquals(result.status, 429)
  assertEquals(result.json.error.code, 'rate_limited')
  const retryAfter = Number(result.headers.get('retry-after'))
  assert(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= maxSeconds, `Retry-After ${retryAfter}`)
  assertEquals(result.json.error.retryAfterSeconds, retryAfter)
  return retryAfter
}

integrationTest('registrations above the site-wide ceiling get 429 and record nothing', async () => {
  await resetData()
  await fillBucket('global_registrations:all', 300)
  const key = newKey()
  assertRateLimited(await register(key), 60)
  assertEquals(await visitorCount(), 0)

  await endWindow('global_registrations:all')
  assertEquals((await register(key)).status, 201)
  assertEquals(await visitorCount(), 1)
})

integrationTest('awards above the per-session limit get 429; the same award id succeeds once later', async () => {
  await resetData()
  const { json } = await register()
  const bucket = `session_awards:${await sessionIdForToken(json.sessionToken)}`
  await fillBucket(bucket, 30)
  const awardId = crypto.randomUUID()
  assertRateLimited(await award(json.sessionToken, awardId), 600)
  assertEquals((await totals()).stored.giftsGiven, 0)

  await endWindow(bucket)
  assertEquals((await award(json.sessionToken, awardId)).status, 201)
  assertEquals((await award(json.sessionToken, awardId)).status, 200)
  assertEquals((await totals()).stored.giftsGiven, 1)
})

integrationTest('awards above the site-wide ceiling get 429', async () => {
  await resetData()
  const { json } = await register()
  await fillBucket('global_awards:all', 300)
  assertRateLimited(await award(json.sessionToken), 60)
  assertEquals((await totals()).stored.giftsGiven, 0)
})

integrationTest('a session over its request budget gets 429 from every authenticated call', async () => {
  await resetData()
  const { json } = await register()
  await fillBucket(`session_requests:${await sessionIdForToken(json.sessionToken)}`, 120)
  assertRateLimited(await resume(json.sessionToken), 60)
  assertRateLimited(await knock(json.sessionToken, 3), 60)
  assertRateLimited(await award(json.sessionToken), 60)
  const { stored } = await totals()
  assertEquals(stored, { visitorCount: 1, giftsGiven: 0, doorKnocks: 0 })
})

integrationTest('knock totals above the session cap are refused whole with retry guidance', async () => {
  await resetData()
  const { json } = await register()
  const over = await knock(json.sessionToken, 31)
  assertEquals(assertRateLimited(over, 1), 1, 'one more second of session time admits 31 knocks')
  assertEquals((await totals()).stored.doorKnocks, 0, 'a refused total is not partially recorded')
  const atCap = await knock(json.sessionToken, 30)
  assertEquals(atCap.json, { knockCount: 30, accepted: 30 })
})

integrationTest('forged X-Forwarded-For and X-Real-IP headers neither create nor dodge limits', async () => {
  await resetData()
  await fillBucket('global_registrations:all', 299)
  const forged = (ip: string) => ({ 'x-forwarded-for': ip, 'x-real-ip': ip })
  const first = await callFunction('start-session', {
    body: { registrationKey: newKey() },
    headers: forged('198.51.100.1'),
  })
  assertEquals(first.status, 201)
  const second = await callFunction('start-session', {
    body: { registrationKey: newKey() },
    headers: forged('198.51.100.2'),
  })
  assertRateLimited(second, 60)
  const [{ n }] = await sql`
    select count(*)::int as n from private.rate_limit_buckets where bucket_key like 'network_%'`
  assertEquals(n, 0, 'the per-network layer is off, so no header is ever trusted')
})
