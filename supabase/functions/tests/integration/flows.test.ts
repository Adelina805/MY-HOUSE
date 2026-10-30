// A complete visit through gateway -> Edge Function -> @supabase/server -> PostgREST ->
// SECURITY DEFINER RPC -> Postgres. Exercising every function proves service_role's grants suffice.
import { assert, assertEquals, assertFalse } from '@std/assert'
import { decodeSecret, hashSessionToken } from '../../_shared/sessionToken.ts'
import { award, guestbook, knock, newKey, register, resume } from './_api.ts'
import { integrationTest, registrationHashOf, resetData, sessionIdForToken, totals } from './_db.ts'

integrationTest('a visit flows through all four functions and all five RPCs', async () => {
  await resetData()
  const registrationKey = newKey()

  const registered = await register(registrationKey)
  assertEquals(registered.status, 201)
  assertEquals(registered.json.status, 'registered')
  assertEquals(registered.json.replayed, false)
  assertEquals(registered.headers.get('cache-control'), 'no-store')
  const token: string = registered.json.sessionToken
  const visitor = registered.json.visitor
  assertEquals(Object.keys(visitor).sort(), ['alias', 'knockCount', 'startedAt', 'visitorNumber'])

  const resumed = await resume(token)
  assertEquals(resumed.status, 200)
  assertEquals(resumed.json, { status: 'resumed', visitor })

  const knocked = await knock(token, 3)
  assertEquals(knocked.status, 200)
  assertEquals(knocked.json, { knockCount: 3, accepted: 3 })
  const retriedKnocks = await knock(token, 3)
  assertEquals(retriedKnocks.json, { knockCount: 3, accepted: 0 })

  const awardId = crypto.randomUUID()
  const prize = { prizeId: 'usb-flash-drive', adjective: 'unlabeled', location: 'Hillcrest' }
  const awarded = await award(token, awardId, prize)
  assertEquals(awarded.status, 201)
  assertEquals(awarded.json.duplicate, false)
  assertEquals(awarded.json.award.objectName, 'USB flash drive', 'the object name comes from the server catalog')
  assertEquals(awarded.json.award.visitorNumber, visitor.visitorNumber)
  assertEquals(awarded.json.award.alias, visitor.alias)
  const replayedAward = await award(token, awardId, prize)
  assertEquals(replayedAward.status, 200)
  assertEquals(replayedAward.json, { award: awarded.json.award, duplicate: true })

  const page = await guestbook('?limit=49')
  assertEquals(page.status, 200)
  assertEquals(page.headers.get('cache-control'), 'public, max-age=5')
  assertEquals(page.json, {
    stats: { visitorCount: 1, giftsGiven: 1, doorKnocks: 3 },
    entries: [awarded.json.award],
    nextCursor: null,
  })

  const { stored, actual } = await totals()
  assertEquals(stored, actual)

  const internals = [
    await sessionIdForToken(token),
    await hashSessionToken(decodeSecret(token)!),
    await registrationHashOf(registrationKey),
    registrationKey,
  ]
  const responses = [registered, resumed, knocked, retriedKnocks, awarded, replayedAward, page]
  for (const response of responses) {
    for (const secret of internals) assertFalse(response.text.includes(secret))
  }
  for (const response of responses.slice(1)) {
    assertFalse(response.text.includes(token), 'only the registration response carries the token')
  }
  assert(registered.text.includes(token))
})
