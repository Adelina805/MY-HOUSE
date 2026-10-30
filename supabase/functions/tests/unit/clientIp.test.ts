import { assert, assertEquals, assertMatch, assertNotEquals } from '@std/assert'
import { networkKeyFor, networkOf, parseClientIpHeader, UNKNOWN_NETWORK } from '../../_shared/clientIp.ts'

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost/functions/v1/start-session', { method: 'POST', headers })
}

const FORGED = { 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' }

Deno.test('CLIENT_IP_HEADER is off unless set, and forgeable headers are refused', () => {
  assertEquals(parseClientIpHeader(undefined), { header: null, rejected: false })
  assertEquals(parseClientIpHeader('  '), { header: null, rejected: false })
  assertEquals(parseClientIpHeader('CF-Connecting-IP'), { header: 'cf-connecting-ip', rejected: false })
  assertEquals(parseClientIpHeader('X-Forwarded-For'), { header: null, rejected: true })
  assertEquals(parseClientIpHeader('forwarded'), { header: null, rejected: true })
  assertEquals(parseClientIpHeader('bad header!'), { header: null, rejected: true })
})

Deno.test('with the layer off there is no network key, whatever the client sends', async () => {
  assertEquals(await networkKeyFor(request(FORGED), null), null)
})

Deno.test('only the configured header is read', async () => {
  assertEquals(await networkKeyFor(request(FORGED), 'cf-connecting-ip'), UNKNOWN_NETWORK)
  const key = await networkKeyFor(request({ ...FORGED, 'cf-connecting-ip': '203.0.113.7' }), 'cf-connecting-ip')
  // SHA-256("ipv4:203.0.113.7"), computed independently with Node's crypto module.
  assertEquals(key, '0848b9df039c15b8bb978b081df267d518223641925939449c571ee3fd7c50c7')
})

Deno.test('missing or malformed values share one bucket', async () => {
  for (const value of ['', 'not-an-ip', '203.0.113.7, 198.51.100.1', '203.0.113.7:443', 'fe80::1%eth0', '[::1]']) {
    assertEquals(await networkKeyFor(request({ 'x-client-ip': value }), 'x-client-ip'), UNKNOWN_NETWORK, value)
  }
})

Deno.test('IPv4 addresses are parsed strictly', () => {
  assertEquals(networkOf('203.0.113.7'), 'ipv4:203.0.113.7')
  assertEquals(networkOf(' 203.0.113.7 '), 'ipv4:203.0.113.7')
  assertEquals(networkOf('0.0.0.0'), 'ipv4:0.0.0.0')
  assertEquals(networkOf('203.0.113.07'), null)
  assertEquals(networkOf('256.1.1.1'), null)
  assertEquals(networkOf('1.2.3'), null)
  assertEquals(networkOf(null), null)
})

Deno.test('IPv6 addresses are grouped by /64', async () => {
  assertEquals(networkOf('2001:db8:1:2:3:4:5:6'), 'ipv6:2001:db8:1:2::/64')
  assertEquals(networkOf('2001:DB8:1:2::1'), 'ipv6:2001:db8:1:2::/64')
  assertEquals(networkOf('2001:db8:1:2:ffff::9'), 'ipv6:2001:db8:1:2::/64')
  assertEquals(networkOf('2001:db8::'), 'ipv6:2001:db8:0:0::/64')
  assertEquals(networkOf('::1'), 'ipv6:0:0:0:0::/64')
  assertEquals(networkOf('::ffff:203.0.113.7'), 'ipv4:203.0.113.7', 'IPv4-mapped addresses count as IPv4')
  assertEquals(networkOf('2001:db8:1:2:3:4:5:6:7'), null)
  assertEquals(networkOf('2001:db8::1::2'), null)
  assertEquals(networkOf('gggg::1'), null)

  const header = 'x-client-ip'
  const sameNetworkA = await networkKeyFor(request({ [header]: '2001:db8:1:2::a' }), header)
  const sameNetworkB = await networkKeyFor(request({ [header]: '2001:db8:1:2:9::b' }), header)
  const otherNetwork = await networkKeyFor(request({ [header]: '2001:db8:1:3::a' }), header)
  assertEquals(sameNetworkA, sameNetworkB)
  assertNotEquals(sameNetworkA, otherNetwork)
  assert(sameNetworkA)
  assertMatch(sameNetworkA, /^[0-9a-f]{64}$/)
})
