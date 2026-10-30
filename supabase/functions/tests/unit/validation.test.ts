import { assert, assertEquals } from '@std/assert'
import { encodeBase64Url, randomSecret } from '../../_shared/sessionToken.ts'
import {
  parseGuestbookQuery,
  parseRecordAward,
  parseRecordKnocks,
  parseStartSession,
} from '../../_shared/validation.ts'

const secret = () => encodeBase64Url(randomSecret())
const AWARD_ID = '0b4f3c1e-2a6d-4f8e-9c3b-7d1e5a9f2c4b'

function rejected(result: { ok: boolean }): boolean {
  return result.ok === false
}

Deno.test('start-session accepts exactly one well-formed field', () => {
  const key = secret()
  const register = parseStartSession({ registrationKey: key })
  assert(register.ok && register.value.kind === 'register')
  assertEquals(encodeBase64Url(register.value.registrationKey), key)

  const resume = parseStartSession({ sessionToken: key })
  assert(resume.ok && resume.value.kind === 'resume')

  assert(rejected(parseStartSession({ registrationKey: key, sessionToken: key })))
  assert(rejected(parseStartSession({})))
  assert(rejected(parseStartSession({ registrationKey: key, alias: 'my own alias' })))
  assert(rejected(parseStartSession({ registrationKey: key.slice(1) })))
  assert(rejected(parseStartSession({ registrationKey: 42 })))
  assert(rejected(parseStartSession({ registrationKey: null })))
  assert(rejected(parseStartSession([key])))
  assert(rejected(parseStartSession(null)))
  assert(rejected(parseStartSession(key)))
  assert(rejected(parseStartSession(JSON.parse(`{"__proto__": {"x": 1}, "registrationKey": "${key}"}`))))
})

Deno.test('record-award requires exactly its five fields', () => {
  const body = {
    sessionToken: secret(),
    awardId: AWARD_ID,
    prizeId: 'trophy',
    adjective: 'champion',
    location: 'Balboa Park',
  }
  const parsed = parseRecordAward(body)
  assert(parsed.ok)
  assertEquals(parsed.value.awardId, AWARD_ID)

  const upper = parseRecordAward({ ...body, awardId: AWARD_ID.toUpperCase() })
  assert(upper.ok)
  assertEquals(upper.value.awardId, AWARD_ID, 'award ids are normalized to lowercase')

  assert(rejected(parseRecordAward({ ...body, objectName: 'trophy' })), 'the object name is never client-supplied')
  assert(rejected(parseRecordAward({ ...body, visitorNumber: 1 })))
  const { location: _location, ...missingLocation } = body
  assert(rejected(parseRecordAward(missingLocation)))
  assert(rejected(parseRecordAward({ ...body, awardId: 'not-a-uuid' })))
  assert(rejected(parseRecordAward({ ...body, awardId: `${AWARD_ID}0` })))
  assert(rejected(parseRecordAward({ ...body, sessionToken: 'short' })))
  assert(rejected(parseRecordAward({ ...body, prizeId: '' })))
  assert(rejected(parseRecordAward({ ...body, prizeId: 'x'.repeat(65) })))
  assert(rejected(parseRecordAward({ ...body, adjective: 'x'.repeat(41) })))
  assert(rejected(parseRecordAward({ ...body, location: 'x'.repeat(81) })))
  assert(rejected(parseRecordAward({ ...body, location: ['Balboa Park'] })))
})

Deno.test('record-knocks accepts integer totals from 0 to 5000 only', () => {
  const sessionToken = secret()
  for (const totalKnocks of [0, 1, 3, 5000]) {
    const parsed = parseRecordKnocks({ sessionToken, totalKnocks })
    assert(parsed.ok)
    assertEquals(parsed.value.totalKnocks, totalKnocks)
  }
  for (const totalKnocks of [-1, 5001, 1.5, '3', null, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
    assert(rejected(parseRecordKnocks({ sessionToken, totalKnocks })), `rejects ${String(totalKnocks)}`)
  }
  assert(rejected(parseRecordKnocks({ sessionToken, totalKnocks: 3, delta: 1 })))
  assert(rejected(parseRecordKnocks({ totalKnocks: 3 })))
})

Deno.test('guestbook query accepts limit 1-50 and a UUID cursor, nothing else', () => {
  const parse = (query: string) => parseGuestbookQuery(new URLSearchParams(query))

  const defaults = parse('')
  assert(defaults.ok)
  assertEquals(defaults.value, { limit: 20, cursor: null })

  const page = parse(`limit=50&cursor=${AWARD_ID.toUpperCase()}`)
  assert(page.ok)
  assertEquals(page.value, { limit: 50, cursor: AWARD_ID })

  for (const query of ['limit=0', 'limit=51', 'limit=05', 'limit=-1', 'limit=1.5', 'limit=', 'limit=abc']) {
    assert(rejected(parse(query)), query)
  }
  assert(rejected(parse('cursor=')))
  assert(rejected(parse('cursor=123')))
  assert(rejected(parse('limit=5&limit=6')))
  assert(rejected(parse('offset=20')))
  assert(rejected(parse('select=*')))
})
