// Lost and repeated registration responses. A registration holds a transaction-scoped advisory lock
// on its registration hash; holding that lock from a test connection freezes a request mid-flight.
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { callFunction, newKey, register, resume } from './_api.ts'
import {
  background,
  endWindow,
  fillBucket,
  integrationTest,
  lockWaiters,
  registrationHashOf,
  release,
  resetData,
  sql,
  visitorCount,
  waitUntil,
} from './_db.ts'

/** Holds the advisory lock a registration with this key takes, until release() is called. */
async function holdRegistrationLock(registrationKey: string) {
  const lockName = `my-house:registration:${await registrationHashOf(registrationKey)}`
  const connection = await sql.reserve()
  await connection`begin`
  await connection`select pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`
  return {
    async release() {
      await connection`commit`
      await release(connection)
    },
  }
}

integrationTest('a response lost in flight is recovered by retrying the same key', async () => {
  await resetData()
  const key = newKey()
  const lock = await holdRegistrationLock(key)
  const controller = new AbortController()
  const lost = register(key, { signal: controller.signal }).then(
    () => 'answered',
    (error: Error) => error.name,
  )
  try {
    await waitUntil(async () => (await lockWaiters('advisory')) === 1, 'the registration to reach the database')
    controller.abort()
    assertEquals(await lost, 'AbortError', 'the client never receives this response')
  } finally {
    await lock.release()
  }
  await waitUntil(async () => (await visitorCount()) === 1, 'the abandoned registration to commit')

  const retry = await register(key)
  assertEquals(retry.status, 200)
  assertEquals(retry.json.replayed, true)
  assertEquals(await visitorCount(), 1, 'the retry did not create a second visit')
  const resumed = await resume(retry.json.sessionToken)
  assertEquals(resumed.status, 200)
  assertEquals(resumed.json.visitor, retry.json.visitor)
})

integrationTest('a retry sent while the first attempt is still running gets the same visit and token', async () => {
  await resetData()
  const key = newKey()
  const lock = await holdRegistrationLock(key)
  let attempts: Promise<Awaited<ReturnType<typeof register>>[]>
  try {
    attempts = background(Promise.all([register(key), register(key)]))
    await waitUntil(async () => (await lockWaiters('advisory')) === 2, 'both attempts to reach the database')
  } finally {
    await lock.release()
  }
  const [first, second] = await attempts
  assertEquals([first.status, second.status].sort(), [200, 201])
  assertEquals(first.json.sessionToken, second.json.sessionToken)
  assertEquals(first.json.visitor, second.json.visitor)
  assertEquals(await visitorCount(), 1)
})

integrationTest('eight parallel copies of one registration create one visit with one token', async () => {
  await resetData()
  const key = newKey()
  const results = await Promise.all(Array.from({ length: 8 }, () => register(key)))
  assertEquals(results.filter((r) => r.status === 201).length, 1)
  assertEquals(results.filter((r) => r.status === 200).length, 7)
  assertEquals(new Set(results.map((r) => r.json.sessionToken)).size, 1)
  assertEquals(new Set(results.map((r) => r.json.visitor.visitorNumber)).size, 1)
  assertEquals(await visitorCount(), 1)
})

integrationTest('once its token has been used, the key starts a new visit and the original token still works', async () => {
  await resetData()
  const key = newKey()
  const original = await register(key)
  assertEquals((await resume(original.json.sessionToken)).status, 200)

  const late = await register(key)
  assertEquals(late.status, 201, 'a used key can no longer recover the token')
  assertNotEquals(late.json.sessionToken, original.json.sessionToken)
  assertNotEquals(late.json.visitor.visitorNumber, original.json.visitor.visitorNumber)
  assertEquals((await resume(original.json.sessionToken)).json.visitor, original.json.visitor)
})

integrationTest('after 10 minutes, the key starts a new visit and leaves the original untouched', async () => {
  await resetData()
  const key = newKey()
  const original = await register(key)
  await sql`
    update private.session_credentials
       set created_at = created_at - interval '11 minutes'
     where registration_hash = decode(${await registrationHashOf(key)}, 'hex')`

  const late = await register(key)
  assertEquals(late.status, 201)
  assertNotEquals(late.json.sessionToken, original.json.sessionToken)
  assertEquals((await resume(original.json.sessionToken)).json.visitor, original.json.visitor)
  assertEquals(await visitorCount(), 2)
})

integrationTest('a registration refused with 429 is created exactly once when retried later', async () => {
  await resetData()
  await fillBucket('global_registrations:all', 300)
  const key = newKey()
  const limited = await register(key)
  assertEquals(limited.status, 429)
  assertEquals(await visitorCount(), 0, 'nothing is recorded for a refused registration')

  await endWindow('global_registrations:all')
  const created = await register(key)
  const replayed = await register(key)
  assertEquals(created.status, 201)
  assertEquals(replayed.status, 200)
  assertEquals(replayed.json.sessionToken, created.json.sessionToken)
  assertEquals(await visitorCount(), 1)
})

integrationTest('public identifiers and registration keys never unlock a session', async () => {
  await resetData()
  const key = newKey()
  const registered = await register(key)
  const { visitorNumber, alias } = registered.json.visitor

  assertEquals((await callFunction('start-session', { body: { visitorNumber } })).status, 400)
  assertEquals((await callFunction('start-session', { body: { alias } })).status, 400)
  const keyAsToken = await resume(key)
  assertEquals(keyAsToken.status, 401, 'a registration key is not a session token')
  assertEquals(keyAsToken.json.error.code, 'invalid_session')
  const strangerKey = await register(newKey())
  assert(strangerKey.json.sessionToken !== registered.json.sessionToken)
})
