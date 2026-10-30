import { assert, assertEquals, assertFalse } from '@std/assert'
import { type ApiFailure, createApiClient, parseApiConfig } from '../../../src/data/apiClient.ts'

const CONFIG = { url: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_test' }
const NOW = Date.parse('2026-10-29T19:00:00Z')

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    return Promise.resolve().then(() => respond(url, init))
  }
  return { fetch, calls }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function apiError(status: number, code: string, extra: Record<string, unknown> = {}, headers = {}): Response {
  return json(status, { error: { code, message: 'test', ...extra } }, headers)
}

async function failureFor(response: Response): Promise<ApiFailure> {
  const { fetch } = fakeFetch(() => response)
  const result = await createApiClient(CONFIG, { fetch, now: () => NOW }).post('record-knocks', {})
  if (result.ok) throw new Error('expected a failure')
  return result.failure
}

Deno.test('POST sends the publishable key and a JSON body, without credentials', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, { knockCount: 3, accepted: 3 }))
  const api = createApiClient(CONFIG, { fetch })
  const result = await api.post('record-knocks', { sessionToken: 't', totalKnocks: 3 })

  assertEquals(result, { ok: true, status: 200, data: { knockCount: 3, accepted: 3 } })
  const [{ url, init }] = calls
  assertEquals(url, 'http://127.0.0.1:54321/functions/v1/record-knocks')
  assertEquals(init.method, 'POST')
  assertEquals(init.headers, { apikey: 'sb_publishable_test', 'content-type': 'application/json' })
  assertEquals(init.body, '{"sessionToken":"t","totalKnocks":3}')
  assertEquals(init.credentials, 'omit')
  assertEquals(init.keepalive, false)
})

Deno.test('keepalive is passed through for page-exit flushes', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, {}))
  await createApiClient(CONFIG, { fetch }).post('record-award', {}, { keepalive: true })
  assertEquals(calls[0].init.keepalive, true)
})

Deno.test('GET puts only the query in the URL and sends no content type', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, { stats: {} }))
  await createApiClient(CONFIG, { fetch }).get('get-guestbook', { limit: '20', cursor: 'a+b/c=' })
  assertEquals(calls[0].url, 'http://127.0.0.1:54321/functions/v1/get-guestbook?limit=20&cursor=a%2Bb%2Fc%3D')
  assertEquals(calls[0].init.method, 'GET')
  assertEquals(calls[0].init.body, undefined)
  assertEquals(calls[0].init.headers, { apikey: 'sb_publishable_test' })
})

Deno.test('classifies API errors as retryable or final', async () => {
  const cases: Array<[Response, Partial<ApiFailure>]> = [
    [apiError(401, 'invalid_session'), { status: 401, code: 'invalid_session', retryable: false }],
    [apiError(401, 'invalid_api_key'), { code: 'invalid_api_key', retryable: false }],
    [apiError(400, 'invalid_request'), { code: 'invalid_request', retryable: false }],
    [apiError(409, 'award_id_conflict'), { code: 'award_id_conflict', retryable: false }],
    [apiError(422, 'invalid_prize'), { code: 'invalid_prize', retryable: false }],
    [apiError(500, 'internal_error'), { code: 'internal_error', retryable: true, retryAfterSeconds: null }],
    [apiError(503, 'busy', {}, { 'retry-after': '1' }), { code: 'busy', retryable: true, retryAfterSeconds: 1 }],
    [new Response('<html>Bad gateway</html>', { status: 502 }), { code: 'http_error', retryable: true }],
    [new Response('Not found', { status: 404 }), { code: 'http_error', retryable: false }],
    [apiError(418, 'teapot'), { code: 'http_error', retryable: false }],
  ]
  for (const [response, expected] of cases) {
    const actual = await failureFor(response)
    for (const [field, value] of Object.entries(expected)) {
      assertEquals(actual[field as keyof ApiFailure], value, `${response.status} ${field}`)
    }
  }
})

Deno.test('reads Retry-After from the header, an HTTP date, or the error body', async () => {
  assertEquals((await failureFor(apiError(429, 'rate_limited', {}, { 'retry-after': '7' }))).retryAfterSeconds, 7)
  assertEquals((await failureFor(apiError(429, 'rate_limited', { retryAfterSeconds: 3 }))).retryAfterSeconds, 3)
  const date = new Date(NOW + 12_000).toUTCString()
  assertEquals((await failureFor(apiError(429, 'rate_limited', {}, { 'retry-after': date }))).retryAfterSeconds, 12)
  assertEquals((await failureFor(apiError(429, 'rate_limited'))).retryable, true)
})

Deno.test('a request that never gets a response is retryable', async () => {
  const { fetch } = fakeFetch(() => {
    throw new TypeError('Failed to fetch')
  })
  const result = await createApiClient(CONFIG, { fetch }).post('record-award', {})
  assertEquals(result, {
    ok: false,
    failure: { status: 0, code: 'network', retryAfterSeconds: null, retryable: true },
  })
})

Deno.test('slow requests time out and are retryable', async () => {
  const { fetch } = fakeFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
  )
  const result = await createApiClient(CONFIG, { fetch, timeoutMs: 20 }).post('start-session', {})
  assertFalse(result.ok)
  if (!result.ok) assertEquals([result.failure.code, result.failure.retryable], ['timeout', true])
})

Deno.test('a success status with an unreadable body is retryable, not a success', async () => {
  for (const body of ['not json', '']) {
    const { fetch } = fakeFetch(() => new Response(body, { status: 200 }))
    const result = await createApiClient(CONFIG, { fetch }).post('record-award', {})
    assertFalse(result.ok)
    if (!result.ok) assertEquals([result.failure.code, result.failure.retryable], ['bad_response', true])
  }
})

Deno.test('an unconfigured client never touches the network', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, {}))
  const api = createApiClient(null, { fetch })
  assertFalse(api.configured)
  const result = await api.post('start-session', {})
  assertEquals(result, {
    ok: false,
    failure: { status: 0, code: 'not_configured', retryAfterSeconds: null, retryable: false },
  })
  assertEquals(calls.length, 0)
})

Deno.test('parseApiConfig accepts only a URL and a publishable key', () => {
  assertEquals(parseApiConfig({ url: 'http://127.0.0.1:54321/', publishableKey: ' sb_publishable_abc ' }), {
    ok: true,
    config: { url: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_abc' },
  })
  assert(parseApiConfig({ url: 'https://ref.supabase.co', publishableKey: 'sb_publishable_abc' }).ok)

  const refused = [
    { url: undefined, publishableKey: undefined },
    { url: '', publishableKey: 'sb_publishable_abc' },
    { url: 'not a url', publishableKey: 'sb_publishable_abc' },
    { url: 'ftp://127.0.0.1', publishableKey: 'sb_publishable_abc' },
    { url: 'http://127.0.0.1:54321', publishableKey: 'sb_secret_abc' },
    { url: 'http://127.0.0.1:54321', publishableKey: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig' },
    { url: 'http://127.0.0.1:54321', publishableKey: 'some-other-key' },
  ]
  for (const raw of refused) {
    assertFalse(parseApiConfig(raw).ok, JSON.stringify(raw))
  }
  const secret = parseApiConfig({ url: 'http://127.0.0.1:54321', publishableKey: 'sb_secret_abc' })
  assert(!secret.ok && !secret.problem.includes('sb_secret_abc'), 'the key itself is never echoed')
})
