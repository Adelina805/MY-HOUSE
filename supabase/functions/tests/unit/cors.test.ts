import { assert, assertEquals } from '@std/assert'
import {
  corsHeaders,
  isOriginAllowed,
  parseAllowedOrigins,
  preflightHeaders,
} from '../../_shared/cors.ts'

Deno.test('ALLOWED_ORIGINS keeps only exact http(s) origins', () => {
  const parsed = parseAllowedOrigins(
    ' http://localhost:5173 ,https://example.com,*,null,https://example.com/,https://example.com/path,ftp://example.com,https://EXAMPLE.org,,',
  )
  assertEquals([...parsed.origins], ['http://localhost:5173', 'https://example.com'])
  assertEquals(parsed.ignoredEntries, 6)
})

Deno.test('unset or empty ALLOWED_ORIGINS allows no browser origin', () => {
  for (const raw of [undefined, '', ' , ']) {
    const { origins } = parseAllowedOrigins(raw)
    assertEquals(origins.size, 0)
    assert(!isOriginAllowed('http://localhost:5173', origins))
  }
})

Deno.test('origin checks are exact', () => {
  const { origins } = parseAllowedOrigins('https://example.com')
  assert(isOriginAllowed('https://example.com', origins))
  assert(!isOriginAllowed('https://example.com.evil.test', origins))
  assert(!isOriginAllowed('http://example.com', origins))
  assert(!isOriginAllowed('https://sub.example.com', origins))
  assert(!isOriginAllowed('null', origins))
  assert(isOriginAllowed(null, origins), 'requests without Origin are not browser cross-origin requests')
})

Deno.test('CORS headers echo the allowed origin and expose Retry-After', () => {
  assertEquals(corsHeaders(null), {})
  assertEquals(corsHeaders('https://example.com'), {
    'access-control-allow-origin': 'https://example.com',
    'access-control-expose-headers': 'retry-after',
  })
  const preflight = preflightHeaders('https://example.com', 'POST')
  assertEquals(preflight['access-control-allow-methods'], 'POST, OPTIONS')
  assertEquals(preflight['access-control-max-age'], '3600')
  assertEquals(preflight['access-control-allow-headers'], 'authorization, x-client-info, apikey, content-type')
})
