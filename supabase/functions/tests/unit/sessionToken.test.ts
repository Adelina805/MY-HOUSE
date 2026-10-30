import { assert, assertEquals, assertNotEquals } from '@std/assert'
import {
  decodeSecret,
  encodeBase64Url,
  fromHex,
  hashSessionToken,
  hmacSha256,
  prepareRegistration,
  randomSecret,
  recoverSessionToken,
  sha256,
  timingSafeEqual,
  toHex,
} from '../../_shared/sessionToken.ts'

const text = (value: string) => new TextEncoder().encode(value)

// Bytes 0x00..0x1f and 0x20..0x3f; expected values computed independently with Node's crypto module.
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i)
const SALT = Uint8Array.from({ length: 32 }, (_, i) => i + 32)
const VECTOR = {
  keyBase64Url: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  saltHex: '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f',
  registrationHash: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
  sessionToken: 'onuG56cKApy6d41vc42VJpbW2DYblRA92Erp32rwY68',
  tokenHash: '6265b460eafc6997cced469752e63e260642928b257b86245b552cc3fd415a1d',
}

Deno.test('SHA-256 matches the FIPS 180-2 "abc" vector', async () => {
  assertEquals(
    toHex(await sha256(text('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

Deno.test('HMAC-SHA-256 matches RFC 4231 test case 2', async () => {
  assertEquals(
    toHex(await hmacSha256(text('Jefe'), text('what do ya want for nothing?'))),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  )
})

Deno.test('registration material matches the reference vector', async () => {
  assertEquals(encodeBase64Url(KEY), VECTOR.keyBase64Url)
  const material = await prepareRegistration(KEY, SALT)
  assertEquals(material, {
    registrationHash: VECTOR.registrationHash,
    tokenSalt: VECTOR.saltHex,
    tokenHash: VECTOR.tokenHash,
    sessionToken: VECTOR.sessionToken,
  })
  assertEquals(await hashSessionToken(decodeSecret(VECTOR.sessionToken)!), VECTOR.tokenHash)
})

Deno.test('the same key and salt always derive the same token; a new salt derives a new one', async () => {
  const first = await prepareRegistration(KEY, SALT)
  const again = await prepareRegistration(KEY, SALT)
  const fresh = await prepareRegistration(KEY)
  assertEquals(first, again)
  assertEquals(fresh.registrationHash, first.registrationHash)
  assertNotEquals(fresh.sessionToken, first.sessionToken)
  assertNotEquals(fresh.tokenSalt, first.tokenSalt)
})

Deno.test('a replay recovers the original token only with the original key', async () => {
  const material = await prepareRegistration(KEY, SALT)
  assertEquals(
    await recoverSessionToken(KEY, material.tokenSalt, material.tokenHash),
    material.sessionToken,
  )
  const otherKey = randomSecret()
  assertEquals(await recoverSessionToken(otherKey, material.tokenSalt, material.tokenHash), null)
  const wrongHash = toHex(await sha256(text('not the token')))
  assertEquals(await recoverSessionToken(KEY, material.tokenSalt, wrongHash), null)
  assertEquals(await recoverSessionToken(KEY, 'not-hex', material.tokenHash), null)
  assertEquals(await recoverSessionToken(KEY, material.tokenSalt.slice(2), material.tokenHash), null)
})

Deno.test('decodeSecret accepts only canonical 43-character base64url encodings of 32 bytes', () => {
  const secret = randomSecret()
  const encoded = encodeBase64Url(secret)
  assertEquals(encoded.length, 43)
  assertEquals(decodeSecret(encoded), secret)

  assertEquals(decodeSecret(`${encoded}=`), null)
  assertEquals(decodeSecret(encoded.slice(1)), null)
  assertEquals(decodeSecret(`${encoded}A`), null)
  assertEquals(decodeSecret(encoded.replace(/^./, '+')), null)
  assertEquals(decodeSecret(encoded.replace(/^./, '/')), null)
  assertEquals(decodeSecret(''), null)
  // The last character carries two padding bits that must be zero: a final "9" decodes to the
  // same bytes as the reference key's final "8", so it is not canonical.
  assertEquals(decodeSecret(VECTOR.keyBase64Url.replace(/8$/, '9')), null)
  assert(decodeSecret(VECTOR.keyBase64Url))
})

Deno.test('hex helpers round-trip and reject malformed input', () => {
  const bytes = randomSecret()
  assertEquals(fromHex(toHex(bytes)), bytes)
  assertEquals(fromHex('abc'), null)
  assertEquals(fromHex('ABCD'), null)
  assertEquals(fromHex('zz'), null)
})

Deno.test('timingSafeEqual compares contents and lengths', () => {
  const a = Uint8Array.from([1, 2, 3])
  assert(timingSafeEqual(a, Uint8Array.from([1, 2, 3])))
  assert(!timingSafeEqual(a, Uint8Array.from([1, 2, 4])))
  assert(!timingSafeEqual(a, Uint8Array.from([1, 2])))
})

Deno.test('random secrets are 32 bytes and distinct', () => {
  const a = randomSecret()
  const b = randomSecret()
  assertEquals(a.length, 32)
  assertNotEquals(toHex(a), toHex(b))
})
