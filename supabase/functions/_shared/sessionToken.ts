/**
 * Session tokens and registration keys.
 *
 * - registrationKey R: 32 random bytes chosen by the browser for one registration attempt.
 * - token = HMAC-SHA-256(key = salt, message = R), where salt is 32 server-random bytes. The token
 *   is therefore server-generated, and only someone holding R can re-derive it from the salt.
 * - Postgres stores only SHA-256(R), SHA-256(token), and the salt. The salt and SHA-256(R) are
 *   deleted on the token's first use or after 10 minutes.
 *
 * Raw keys and tokens exist only in request and response bodies. Never log them.
 */

export type Bytes = Uint8Array<ArrayBuffer>

export const SECRET_BYTES = 32

const BASE64URL_SECRET = /^[A-Za-z0-9_-]{43}$/

export function encodeBase64Url(bytes: Bytes): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Decodes the canonical unpadded base64url encoding of exactly 32 bytes; anything else is null. */
export function decodeSecret(text: string): Bytes | null {
  if (!BASE64URL_SECRET.test(text)) return null
  const binary = atob(`${text.replaceAll('-', '+').replaceAll('_', '/')}=`)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  if (bytes.length !== SECRET_BYTES || encodeBase64Url(bytes) !== text) return null
  return bytes
}

export function toHex(bytes: Bytes): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): Bytes | null {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export function randomSecret(): Bytes {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
}

export async function sha256(bytes: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

export async function hmacSha256(key: Bytes, message: Bytes): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message))
}

export function timingSafeEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i]
  return difference === 0
}

/** The hex SHA-256 that identifies a session token in Postgres. */
export async function hashSessionToken(token: Bytes): Promise<string> {
  return toHex(await sha256(token))
}

export interface RegistrationMaterial {
  /** Sent to Postgres. */
  registrationHash: string
  tokenSalt: string
  tokenHash: string
  /** Returned to the browser only. */
  sessionToken: string
}

/** Derives the credentials for a registration attempt from its key and a fresh salt. */
export async function prepareRegistration(
  registrationKey: Bytes,
  salt: Bytes = randomSecret(),
): Promise<RegistrationMaterial> {
  const token = await hmacSha256(salt, registrationKey)
  return {
    registrationHash: toHex(await sha256(registrationKey)),
    tokenSalt: toHex(salt),
    tokenHash: await hashSessionToken(token),
    sessionToken: encodeBase64Url(token),
  }
}

/**
 * Re-derives the token of a replayed registration from the stored salt. Returns null unless the
 * result hashes to the stored token hash, so a replay can only ever return the original token.
 */
export async function recoverSessionToken(
  registrationKey: Bytes,
  storedSaltHex: string,
  storedTokenHashHex: string,
): Promise<string | null> {
  const salt = fromHex(storedSaltHex)
  const expectedHash = fromHex(storedTokenHashHex)
  if (salt?.length !== SECRET_BYTES || expectedHash?.length !== SECRET_BYTES) return null
  const token = await hmacSha256(salt, registrationKey)
  return timingSafeEqual(await sha256(token), expectedHash) ? encodeBase64Url(token) : null
}
