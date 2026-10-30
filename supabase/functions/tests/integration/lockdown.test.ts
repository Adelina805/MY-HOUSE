// The Data API cannot reach the guestbook tables with any key; the Edge Functions are the only door.
import { assert, assertEquals, assertFalse } from '@std/assert'
import { callFunction, newKey } from './_api.ts'
import { stack } from './_env.ts'
import { integrationTest } from './_db.ts'

const TABLES = ['visitor_sessions', 'prize_awards', 'site_stats']
const RPCS = [
  'register_visitor_session',
  'resume_visitor_session',
  'record_prize_award',
  'record_knocks',
  'get_guestbook_page',
]

async function rest(path: string, key: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ apikey: key, ...init.headers })
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(`${stack.restUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : null }
}

integrationTest('the publishable key cannot read or write any guestbook table', async () => {
  for (const table of TABLES) {
    const read = await rest(`/${table}?select=*`, stack.publishableKey)
    assertEquals(read.json?.code, '42501', `select ${table}`)
    const write = await rest(`/${table}`, stack.publishableKey, { method: 'POST', body: {} })
    assertEquals(write.json?.code, '42501', `insert ${table}`)
  }
  const patch = await rest('/site_stats?id=eq.1', stack.publishableKey, { method: 'PATCH', body: { visitor_count: 0 } })
  assertEquals(patch.json?.code, '42501')
})

integrationTest('the publishable key cannot call the RPCs directly', async () => {
  for (const rpc of RPCS) {
    const result = await rest(`/rpc/${rpc}`, stack.publishableKey, { method: 'POST', body: {} })
    assert(result.status >= 400, rpc)
    assertFalse(result.status === 200, rpc)
  }
  const page = await rest('/rpc/get_guestbook_page', stack.publishableKey, {
    method: 'POST',
    body: { p_limit: 5, p_cursor: null },
  })
  assertEquals(page.json?.code, '42501')
})

integrationTest('the private schema is not exposed to any key', async () => {
  for (const key of [stack.publishableKey, stack.secretKey]) {
    const credentials = await rest('/session_credentials?select=*', key, { headers: { 'accept-profile': 'private' } })
    assertEquals(credentials.status, 406)
    const rebuild = await rest('/rpc/rebuild_site_stats', key, {
      method: 'POST',
      body: {},
      headers: { 'content-profile': 'private' },
    })
    assertEquals(rebuild.status, 406)
  }
})

integrationTest('even the secret key reaches data only through the RPCs', async () => {
  const page = await rest('/rpc/get_guestbook_page', stack.secretKey, {
    method: 'POST',
    body: { p_limit: 5, p_cursor: null },
  })
  assertEquals(page.status, 200)
  assertEquals(page.json.status, 'ok')
  for (const table of TABLES) {
    const read = await rest(`/${table}?select=*`, stack.secretKey)
    assertEquals(read.json?.code, '42501', `select ${table}`)
  }
  const insert = await rest('/prize_awards', stack.secretKey, { method: 'POST', body: {} })
  assertEquals(insert.json?.code, '42501')
})

async function graphqlSchema(key: string, query: string): Promise<string> {
  const response = await fetch(stack.graphqlUrl, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  assertEquals(response.status, 200)
  return (await response.text()).toLowerCase()
}

const GUESTBOOK_NAMES = ['visitor', 'prize', 'sitestats', 'site_stats', 'credential', 'guestbook', 'knock']

integrationTest('GraphQL exposes nothing from the guestbook to the publishable key', async () => {
  const schema = await graphqlSchema(
    stack.publishableKey,
    '{ __schema { types { name } queryType { fields { name } } mutationType { fields { name } } } }',
  )
  for (const name of GUESTBOOK_NAMES) assertFalse(schema.includes(name), name)
})

integrationTest('GraphQL exposes no guestbook table even to the secret key', async () => {
  const types = await graphqlSchema(stack.secretKey, '{ __schema { types { name } } }')
  for (const name of ['visitorsession', 'prizeaward', 'sitestats', 'credential']) {
    assertFalse(types.includes(name), name)
  }
})

integrationTest('the functions accept only the publishable key, from allowed origins', async () => {
  const body = { registrationKey: newKey() }
  for (const apikey of [null, 'sb_publishable_not_the_key', stack.secretKey, stack.anonKey]) {
    const result = await callFunction('start-session', { body, apikey })
    assertEquals(result.status, 401, String(apikey === null ? 'missing' : apikey.slice(0, 12)))
    assertEquals(result.json.error.code, 'invalid_api_key')
    assertEquals(Object.keys(result.json.error).sort(), ['code', 'message'])
  }
  const bearerOnly = await callFunction('start-session', {
    body,
    apikey: null,
    headers: { authorization: `Bearer ${stack.publishableKey}` },
  })
  assertEquals(bearerOnly.status, 401)

  for (const fn of ['start-session', 'record-award', 'record-knocks', 'get-guestbook']) {
    const result = await callFunction(fn, {
      origin: 'https://evil.test',
      ...(fn === 'get-guestbook' ? {} : { body: {} }),
    })
    assertEquals(result.status, 403, fn)
    assertEquals(result.json.error.code, 'origin_not_allowed')
  }
})

integrationTest('the functions refuse oversized, non-JSON, and malformed bodies', async () => {
  const oversized = await callFunction('start-session', { body: { registrationKey: 'x'.repeat(4_000) } })
  assertEquals(oversized.status, 413)
  assertEquals(oversized.json.error.code, 'payload_too_large')

  const text = await callFunction('record-knocks', { body: 'hello', headers: { 'content-type': 'text/plain' } })
  assertEquals(text.status, 415)

  const malformed = await callFunction('record-award', { body: { sessionToken: 'x', awardId: 'not-a-uuid' } })
  assertEquals(malformed.status, 400)
  assertEquals(malformed.json.error.code, 'invalid_request')
})
