// Handlers and the shared pipeline, driven with a fake RPC (no database, no network).
import { assert, assertEquals, assertFalse, assertMatch, assertStringIncludes } from '@std/assert'
import { createGetGuestbookHandler } from '../../get-guestbook/handler.ts'
import { createRecordAwardHandler } from '../../record-award/handler.ts'
import { createRecordKnocksHandler } from '../../record-knocks/handler.ts'
import { createStartSessionHandler } from '../../start-session/handler.ts'
import { type EndpointDeps, type LogEntry, publishableKeyCheck } from '../../_shared/http.ts'
import { ReadProtection } from '../../_shared/readProtection.ts'
import type { RpcName, RpcOutcome } from '../../_shared/rpc.ts'
import {
  decodeSecret,
  encodeBase64Url,
  hashSessionToken,
  prepareRegistration,
  randomSecret,
  sha256,
  toHex,
} from '../../_shared/sessionToken.ts'

const ORIGIN = 'http://localhost:5173'
const AWARD_ID = '0b4f3c1e-2a6d-4f8e-9c3b-7d1e5a9f2c4b'
const SESSION_UUID = 'aaaaaaaa-0000-4000-8000-000000000001'
const VISITOR = { visitorNumber: 7, alias: 'curious raccoon', knockCount: 0, startedAt: '2026-10-29T18:00:00.000Z' }
const ENTRY = {
  awardId: AWARD_ID,
  visitorNumber: 7,
  alias: 'curious raccoon',
  prizeId: 'usb-flash-drive',
  objectName: 'USB flash drive',
  adjective: 'unlabeled',
  location: 'Hillcrest',
  awardedAt: '2026-10-29T18:01:00.000Z',
}
const PAGE = {
  status: 'ok',
  stats: { visitorCount: 3, giftsGiven: 1, doorKnocks: 9 },
  entries: [ENTRY],
  nextCursor: null,
}

type Args = Record<string, unknown>
type Responder = (name: RpcName, args: Args) => RpcOutcome | Promise<RpcOutcome>

const ok = (data: unknown): RpcOutcome => ({ ok: true, data })
const unexpectedCall: Responder = (name) => {
  throw new Error(`unexpected RPC ${name}`)
}

function harness(responder: Responder = unexpectedCall, overrides: Partial<EndpointDeps> = {}) {
  const logs: LogEntry[] = []
  const calls: Array<{ name: RpcName; args: Args }> = []
  let apiKeyChecks = 0
  const deps: EndpointDeps = {
    allowedOrigins: new Set([ORIGIN]),
    clientIpHeader: null,
    checkApiKey: () => {
      apiKeyChecks += 1
      return Promise.resolve('ok')
    },
    rpc: async (name, args) => {
      calls.push({ name, args: args as Args })
      return await responder(name, args as Args)
    },
    log: (entry) => logs.push(entry),
    now: () => 1_000_000,
    ...overrides,
  }
  return { deps, logs, calls, apiKeyChecks: () => apiKeyChecks }
}

function request(fn: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string>; query?: string } = {}) {
  return new Request(`http://localhost/functions/v1/${fn}${init.query ?? ''}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, apikey: 'sb_publishable_unit', ...init.headers },
    body: init.body,
  })
}

function post(fn: string, body: unknown, headers: Record<string, string> = {}) {
  return request(fn, { body: JSON.stringify(body), headers })
}

async function read(response: Response) {
  const text = await response.text()
  return { status: response.status, headers: response.headers, text, json: text ? JSON.parse(text) : null }
}

function assertSecurityHeaders(headers: Headers) {
  assertEquals(headers.get('x-content-type-options'), 'nosniff')
  assertEquals(headers.get('vary'), 'Origin')
}

// start-session ---------------------------------------------------------------------------------

Deno.test('registration returns 201 and sends Postgres only hashes and the salt', async () => {
  const { deps, calls, logs } = harness(() => ok({ status: 'created', visitor: VISITOR }))
  const key = randomSecret()
  const keyText = encodeBase64Url(key)
  const res = await read(await createStartSessionHandler(deps)(post('start-session', { registrationKey: keyText })))

  assertEquals(res.status, 201)
  assertEquals(res.json.status, 'registered')
  assertEquals(res.json.replayed, false)
  assertEquals(res.json.visitor, VISITOR)
  assertEquals(res.headers.get('cache-control'), 'no-store')
  assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN)
  assertSecurityHeaders(res.headers)

  const token = decodeSecret(res.json.sessionToken)
  assert(token, 'the token is 32 bytes of base64url')
  assertEquals(calls.length, 1)
  assertEquals(calls[0].name, 'register_visitor_session')
  assertEquals(calls[0].args.p_token_hash, await hashSessionToken(token))
  assertEquals(calls[0].args.p_registration_hash, toHex(await sha256(key)))
  assertMatch(String(calls[0].args.p_token_salt), /^[0-9a-f]{64}$/)
  assertEquals(calls[0].args.p_network_key, null)

  const sentToDatabase = JSON.stringify(calls)
  assertFalse(sentToDatabase.includes(keyText), 'the raw registration key never reaches Postgres')
  assertFalse(sentToDatabase.includes(res.json.sessionToken), 'the raw token never reaches Postgres')
  for (const value of [calls[0].args.p_token_hash, calls[0].args.p_registration_hash, calls[0].args.p_token_salt]) {
    assertFalse(res.text.includes(String(value)), 'hashes and salts are never returned')
  }
  assertEquals(logs, [])
})

Deno.test('a replayed registration returns 200 with the original token', async () => {
  const key = randomSecret()
  const original = await prepareRegistration(key)
  const { deps } = harness(() =>
    ok({ status: 'replayed', tokenSalt: original.tokenSalt, tokenHash: original.tokenHash, visitor: VISITOR })
  )
  const res = await read(
    await createStartSessionHandler(deps)(post('start-session', { registrationKey: encodeBase64Url(key) })),
  )
  assertEquals(res.status, 200)
  assertEquals(res.json, { status: 'registered', replayed: true, sessionToken: original.sessionToken, visitor: VISITOR })
  assertFalse(res.text.includes(original.tokenSalt))
  assertFalse(res.text.includes(original.tokenHash))
})

Deno.test('a replay that does not reproduce the stored token hash returns no token', async () => {
  const original = await prepareRegistration(randomSecret())
  const { deps, logs } = harness(() =>
    ok({ status: 'replayed', tokenSalt: original.tokenSalt, tokenHash: original.tokenHash, visitor: VISITOR })
  )
  const res = await read(
    await createStartSessionHandler(deps)(post('start-session', { registrationKey: encodeBase64Url(randomSecret()) })),
  )
  assertEquals(res.status, 500)
  assertEquals(res.json.error.code, 'internal_error')
  assertFalse('sessionToken' in res.json)
  assertEquals(logs, [{ fn: 'start-session', status: 500, reason: 'replay_token_mismatch' }])
})

Deno.test('a rate-limited registration returns 429 with retry guidance', async () => {
  const { deps } = harness(() => ok({ status: 'rate_limited', retryAfterSeconds: 17 }))
  const res = await read(
    await createStartSessionHandler(deps)(post('start-session', { registrationKey: encodeBase64Url(randomSecret()) })),
  )
  assertEquals(res.status, 429)
  assertEquals(res.headers.get('retry-after'), '17')
  assertEquals(res.headers.get('access-control-expose-headers'), 'retry-after')
  assertEquals(res.json.error.code, 'rate_limited')
  assertEquals(res.json.error.retryAfterSeconds, 17)
  assertStringIncludes(res.json.error.message, 'Nothing was recorded')
})

Deno.test('resume returns the visitor, 401 for an unknown session, and 429 when limited', async () => {
  const token = randomSecret()
  for (
    const [data, status] of [
      [{ status: 'resumed', visitor: VISITOR }, 200],
      [{ status: 'invalid_session' }, 401],
      [{ status: 'rate_limited', retryAfterSeconds: 60 }, 429],
    ] as const
  ) {
    const { deps, calls } = harness(() => ok(data))
    const res = await read(
      await createStartSessionHandler(deps)(post('start-session', { sessionToken: encodeBase64Url(token) })),
    )
    assertEquals(res.status, status)
    assertEquals(calls[0].name, 'resume_visitor_session')
    assertEquals(calls[0].args, { p_token_hash: await hashSessionToken(token) })
    if (status === 200) assertEquals(res.json, { status: 'resumed', visitor: VISITOR })
    if (status === 401) assertEquals(res.json.error.code, 'invalid_session')
  }
})

Deno.test('fields the database adds beyond the public shape never reach the client', async () => {
  const { deps } = harness(() =>
    ok({
      status: 'created',
      sessionId: SESSION_UUID,
      tokenSalt: 'f00dfeed',
      visitor: { ...VISITOR, sessionId: SESSION_UUID, tokenHash: 'deadbeef', lastActiveAt: 'internal' },
    })
  )
  const res = await read(
    await createStartSessionHandler(deps)(post('start-session', { registrationKey: encodeBase64Url(randomSecret()) })),
  )
  assertEquals(res.status, 201)
  assertEquals(Object.keys(res.json.visitor).sort(), ['alias', 'knockCount', 'startedAt', 'visitorNumber'])
  for (const leaked of [SESSION_UUID, 'f00dfeed', 'deadbeef', 'lastActiveAt']) assertFalse(res.text.includes(leaked))
})

// Shared pipeline -----------------------------------------------------------------------------

Deno.test('a disallowed origin is rejected before the key check or any database call', async () => {
  const { deps, calls, apiKeyChecks } = harness()
  const res = await read(
    await createStartSessionHandler(deps)(
      post('start-session', { registrationKey: encodeBase64Url(randomSecret()) }, { origin: 'https://evil.test' }),
    ),
  )
  assertEquals(res.status, 403)
  assertEquals(res.json.error.code, 'origin_not_allowed')
  assertEquals(res.headers.get('access-control-allow-origin'), null)
  assertEquals(calls.length, 0)
  assertEquals(apiKeyChecks(), 0)
})

Deno.test('requests without an Origin header are served without CORS headers', async () => {
  const { deps } = harness(() => ok({ status: 'created', visitor: VISITOR }))
  const req = new Request('http://localhost/functions/v1/start-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'sb_publishable_unit' },
    body: JSON.stringify({ registrationKey: encodeBase64Url(randomSecret()) }),
  })
  const res = await read(await createStartSessionHandler(deps)(req))
  assertEquals(res.status, 201)
  assertEquals(res.headers.get('access-control-allow-origin'), null)
})

Deno.test('preflight from an allowed origin returns 204 without needing the key', async () => {
  const { deps, apiKeyChecks } = harness()
  const res = await createStartSessionHandler(deps)(
    request('start-session', { method: 'OPTIONS', headers: { apikey: '' } }),
  )
  assertEquals(res.status, 204)
  assertEquals(await res.text(), '')
  assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN)
  assertEquals(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS')
  assertEquals(res.headers.get('access-control-max-age'), '3600')
  assertEquals(apiKeyChecks(), 0)

  const getPreflight = await createGetGuestbookHandler(harness().deps)(request('get-guestbook', { method: 'OPTIONS' }))
  assertEquals(getPreflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS')
})

Deno.test('the wrong method returns 405 with Allow', async () => {
  const res = await read(await createStartSessionHandler(harness().deps)(request('start-session', { method: 'GET' })))
  assertEquals(res.status, 405)
  assertEquals(res.headers.get('allow'), 'POST, OPTIONS')
  const getOnly = await read(
    await createGetGuestbookHandler(harness().deps)(request('get-guestbook', { method: 'POST', body: '{}' })),
  )
  assertEquals(getOnly.status, 405)
  assertEquals(getOnly.headers.get('allow'), 'GET, OPTIONS')
})

Deno.test('API key failures map to 401, configuration failures to 500', async () => {
  const body = { registrationKey: encodeBase64Url(randomSecret()) }
  const invalid = harness(unexpectedCall, { checkApiKey: () => Promise.resolve('invalid') })
  const res401 = await read(await createStartSessionHandler(invalid.deps)(post('start-session', body)))
  assertEquals(res401.status, 401)
  assertEquals(res401.json.error.code, 'invalid_api_key')

  const broken = harness(unexpectedCall, { checkApiKey: () => Promise.resolve('misconfigured') })
  const res500 = await read(await createStartSessionHandler(broken.deps)(post('start-session', body)))
  assertEquals(res500.status, 500)
  assertEquals(res500.json.error.code, 'server_misconfigured')
})

Deno.test('the publishable key is verified with @supabase/server, and its diagnostics are not forwarded', async () => {
  const env = {
    url: 'http://127.0.0.1:54321',
    publishableKeys: { default: 'sb_publishable_unit_test_key' },
    secretKeys: { default: 'sb_secret_unit_test_key' },
  }
  const check = publishableKeyCheck(env)
  const withKey = (apikey?: string) =>
    new Request('http://localhost/', { method: 'POST', headers: apikey === undefined ? {} : { apikey } })

  assertEquals(await check(withKey('sb_publishable_unit_test_key')), 'ok')
  assertEquals(await check(withKey('sb_publishable_wrong')), 'invalid')
  assertEquals(await check(withKey('sb_secret_unit_test_key')), 'invalid', 'the secret key is not a publishable key')
  assertEquals(await check(withKey()), 'invalid')
  assertEquals(await publishableKeyCheck({ ...env, publishableKeys: {} })(withKey('sb_publishable_x')), 'misconfigured')

  const { deps } = harness(unexpectedCall, { checkApiKey: check })
  const res = await read(
    await createStartSessionHandler(deps)(
      post('start-session', { registrationKey: encodeBase64Url(randomSecret()) }, { apikey: 'sb_publishable_wrong' }),
    ),
  )
  assertEquals(res.status, 401)
  assertEquals(Object.keys(res.json.error).sort(), ['code', 'message'])
  for (const internal of ['hint', 'docs', 'details', '@supabase/server', 'configured']) {
    assertFalse(res.text.includes(internal), internal)
  }
})

Deno.test('the body must be JSON, at most 2 KiB, and valid', async () => {
  const handler = createStartSessionHandler(harness().deps)
  const send = async (init: Parameters<typeof request>[1]) => (await read(await handler(request('start-session', init))))

  assertEquals((await send({ body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415)
  assertEquals((await send({ body: '{}', headers: { 'content-type': 'application/jsonx' } })).status, 415)
  const big = JSON.stringify({ registrationKey: 'x'.repeat(2100) })
  assertEquals((await send({ body: big })).status, 413)
  assertEquals((await send({ body: '{}', headers: { 'content-length': '4096' } })).status, 413)

  const chunks = [new TextEncoder().encode('{"registrationKey":"'), new TextEncoder().encode('x'.repeat(3000))]
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  assertEquals((await send({ body: stream })).status, 413, 'the limit holds without Content-Length')

  const notJson = await send({ body: '{"registrationKey":' })
  assertEquals(notJson.status, 400)
  assertEquals(notJson.json.error.code, 'invalid_request')
  assertEquals((await send({ body: new Uint8Array([0x7b, 0xff, 0x7d]) })).status, 400)
  const both = await send({ body: JSON.stringify({ registrationKey: 'a', sessionToken: 'b' }) })
  assertEquals(both.status, 400)
  assertEquals(both.json.error.message, 'Send exactly one of registrationKey or sessionToken.')
})

Deno.test('database failures map to explicit statuses and log only the SQLSTATE', async () => {
  const token = encodeBase64Url(randomSecret())
  const cases: Array<[RpcOutcome | Error, number, string, Partial<LogEntry>]> = [
    [{ ok: false, kind: 'misconfigured', sqlstate: null }, 500, 'server_misconfigured', { reason: 'admin_client_unavailable' }],
    [{ ok: false, kind: 'unavailable', sqlstate: '40P01' }, 503, 'busy', { sqlstate: '40P01' }],
    [{ ok: false, kind: 'unavailable', sqlstate: null }, 503, 'busy', {}],
    [{ ok: false, kind: 'invalid_argument', sqlstate: '22023' }, 400, 'invalid_request', { sqlstate: '22023' }],
    [{ ok: false, kind: 'error', sqlstate: '42501' }, 500, 'internal_error', { sqlstate: '42501' }],
    [{ ok: true, data: { status: 'surprise' } }, 500, 'internal_error', { reason: 'unexpected_rpc_result' }],
    [new Error(`boom ${token}`), 500, 'internal_error', { reason: 'unhandled_exception' }],
  ]
  for (const [outcome, status, code, logged] of cases) {
    const { deps, logs } = harness(() => {
      if (outcome instanceof Error) throw outcome
      return outcome
    })
    const res = await read(await createStartSessionHandler(deps)(post('start-session', { sessionToken: token })))
    assertEquals(res.status, status, code)
    assertEquals(res.json.error.code, code)
    if (status === 503) {
      assertEquals(res.headers.get('retry-after'), '1')
      assertEquals(res.json.error.retryAfterSeconds, 1)
    }
    assertEquals(logs, [{ fn: 'start-session', status, ...logged }])
    assertFalse(res.text.includes(token))
  }
})

// record-award ----------------------------------------------------------------------------------

function awardBody(overrides: Record<string, unknown> = {}) {
  return {
    sessionToken: encodeBase64Url(randomSecret()),
    awardId: AWARD_ID.toUpperCase(),
    prizeId: 'usb-flash-drive',
    adjective: 'unlabeled',
    location: 'Hillcrest',
    ...overrides,
  }
}

Deno.test('a combination outside the catalog is rejected with 422 before any database call', async () => {
  const { deps, calls } = harness()
  for (const overrides of [{ prizeId: 'fallback-mystery' }, { adjective: 'Unlabeled' }, { location: 'Ocean Beach' }]) {
    const res = await read(await createRecordAwardHandler(deps)(post('record-award', awardBody(overrides))))
    assertEquals(res.status, 422)
    assertEquals(res.json.error.code, 'invalid_prize')
  }
  assertEquals(calls.length, 0)
})

Deno.test('awards send the catalog object name and map every outcome', async () => {
  const outcomes = [
    [{ status: 'created', award: ENTRY }, 201],
    [{ status: 'duplicate', award: { ...ENTRY, sessionId: SESSION_UUID } }, 200],
    [{ status: 'conflict' }, 409],
    [{ status: 'invalid_session' }, 401],
    [{ status: 'rate_limited', retryAfterSeconds: 120 }, 429],
  ] as const
  for (const [data, status] of outcomes) {
    const { deps, calls } = harness(() => ok(data))
    const body = awardBody()
    const res = await read(await createRecordAwardHandler(deps)(post('record-award', body)))
    assertEquals(res.status, status)
    assertEquals(calls[0].name, 'record_prize_award')
    assertEquals(calls[0].args, {
      p_token_hash: await hashSessionToken(decodeSecret(body.sessionToken)!),
      p_award_id: AWARD_ID,
      p_prize_id: 'usb-flash-drive',
      p_object_name: 'USB flash drive',
      p_adjective: 'unlabeled',
      p_location: 'Hillcrest',
      p_network_key: null,
    })
    if (status === 201 || status === 200) {
      assertEquals(res.json, { award: ENTRY, duplicate: status === 200 })
      assertFalse(res.text.includes(SESSION_UUID))
    }
    if (status === 409) assertEquals(res.json.error.code, 'award_id_conflict')
    if (status === 429) assertEquals(res.headers.get('retry-after'), '120')
  }
})

// record-knocks ---------------------------------------------------------------------------------

Deno.test('knock reports send the cumulative total and map every outcome', async () => {
  const token = randomSecret()
  for (
    const [data, status] of [
      [{ status: 'ok', knockCount: 6, accepted: 3 }, 200],
      [{ status: 'invalid_session' }, 401],
      [{ status: 'rate_limited', retryAfterSeconds: 4 }, 429],
    ] as const
  ) {
    const { deps, calls } = harness(() => ok(data))
    const res = await read(
      await createRecordKnocksHandler(deps)(post('record-knocks', { sessionToken: encodeBase64Url(token), totalKnocks: 6 })),
    )
    assertEquals(res.status, status)
    assertEquals(calls[0].args, { p_token_hash: await hashSessionToken(token), p_total_knocks: 6 })
    if (status === 200) assertEquals(res.json, { knockCount: 6, accepted: 3 })
    if (status === 429) assertEquals(res.headers.get('retry-after'), '4')
  }

  const { deps, calls } = harness()
  const res = await read(
    await createRecordKnocksHandler(deps)(post('record-knocks', { sessionToken: encodeBase64Url(token), totalKnocks: 5001 })),
  )
  assertEquals(res.status, 400)
  assertEquals(calls.length, 0)
})

// get-guestbook ---------------------------------------------------------------------------------

function getRequest(query = '', headers: Record<string, string> = {}) {
  return request('get-guestbook', { method: 'GET', query, headers: { 'content-type': '', ...headers } })
}

Deno.test('guestbook pages are public, cached, and shaped by the contract', async () => {
  const { deps, calls } = harness(() => ok({ ...PAGE, internal: 'x' }))
  const handler = createGetGuestbookHandler(deps)
  const first = await read(await handler(getRequest()))
  assertEquals(first.status, 200)
  assertEquals(first.json, { stats: PAGE.stats, entries: [ENTRY], nextCursor: null })
  assertEquals(first.headers.get('cache-control'), 'public, max-age=5')
  assertEquals(first.headers.get('access-control-allow-origin'), ORIGIN)
  assertEquals(calls[0].args, { p_limit: 20, p_cursor: null })

  const again = await read(await handler(getRequest()))
  assertEquals(again.json, first.json)
  assertEquals(calls.length, 1, 'served from the cache')

  const older = await read(await handler(getRequest(`?limit=10&cursor=${AWARD_ID.toUpperCase()}`)))
  assertEquals(older.headers.get('cache-control'), 'public, max-age=60')
  assertEquals(calls[1].args, { p_limit: 10, p_cursor: AWARD_ID })
})

Deno.test('guestbook errors are explicit and never cached', async () => {
  const invalidCursor = harness(() => ok({ status: 'invalid_cursor' }))
  const res = await read(await createGetGuestbookHandler(invalidCursor.deps)(getRequest(`?cursor=${AWARD_ID}`)))
  assertEquals(res.status, 400)
  assertEquals(res.json.error.code, 'invalid_cursor')
  assertEquals(res.headers.get('cache-control'), 'no-store')

  for (const query of ['?limit=51', '?limit=0', '?offset=1', '?cursor=abc', '?limit=5&limit=5']) {
    const { deps, calls } = harness()
    assertEquals((await createGetGuestbookHandler(deps)(getRequest(query))).status, 400, query)
    assertEquals(calls.length, 0)
  }

  const down = harness(() => ({ ok: false, kind: 'unavailable', sqlstate: '08006' }))
  const busy = await read(await createGetGuestbookHandler(down.deps)(getRequest()))
  assertEquals(busy.status, 503)
  assertEquals(busy.headers.get('retry-after'), '1')
})

Deno.test('the guestbook per-network limit applies only when a client IP header is configured', async () => {
  const forged = { 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.1' }

  const off = harness(() => ok(PAGE))
  const offHandler = createGetGuestbookHandler(
    off.deps,
    new ReadProtection({ now: off.deps.now, networkRequestsPerMinute: 1 }),
  )
  for (let i = 0; i < 3; i += 1) assertEquals((await offHandler(getRequest('', forged))).status, 200)

  const on = harness(() => ok(PAGE), { clientIpHeader: 'x-client-ip' })
  const onHandler = createGetGuestbookHandler(
    on.deps,
    new ReadProtection({ now: on.deps.now, networkRequestsPerMinute: 1 }),
  )
  assertEquals((await onHandler(getRequest('', { 'x-client-ip': '203.0.113.7' }))).status, 200)
  const limited = await read(await onHandler(getRequest('', { 'x-client-ip': '203.0.113.7' })))
  assertEquals(limited.status, 429)
  assertEquals(limited.headers.get('retry-after'), '60')
  assertEquals((await onHandler(getRequest('', { 'x-client-ip': '203.0.113.8' }))).status, 200)
})

// Logging -------------------------------------------------------------------------------------

Deno.test('secrets never reach logs or the console', async () => {
  const key = encodeBase64Url(randomSecret())
  const token = encodeBase64Url(randomSecret())
  const consoleLines: string[] = []
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
  for (const method of Object.keys(original) as Array<keyof typeof original>) {
    console[method] = (...args: unknown[]) => consoleLines.push(args.map(String).join(' '))
  }
  const { deps, logs } = harness((name) => {
    if (name === 'register_visitor_session') return { ok: false, kind: 'error', sqlstate: 'XX000' }
    if (name === 'record_knocks') return ok({ status: 'invalid_session' })
    return ok({ status: 'rate_limited', retryAfterSeconds: 3 })
  })
  try {
    await createStartSessionHandler(deps)(post('start-session', { registrationKey: key }))
    await createStartSessionHandler(deps)(post('start-session', { sessionToken: token }))
    await createRecordKnocksHandler(deps)(post('record-knocks', { sessionToken: token, totalKnocks: 3 }))
    await createRecordAwardHandler(deps)(post('record-award', awardBody({ sessionToken: token })))
    await createStartSessionHandler(deps)(post('start-session', { registrationKey: key, extra: token }))
  } finally {
    Object.assign(console, original)
  }

  assertEquals(consoleLines, [], 'handlers write only through the injected logger')
  assertEquals(logs.length, 5)
  const serialized = JSON.stringify(logs)
  assertFalse(serialized.includes(key))
  assertFalse(serialized.includes(token))
  for (const entry of logs) {
    for (const field of Object.keys(entry)) assert(['fn', 'status', 'sqlstate', 'reason'].includes(field), field)
  }
})
