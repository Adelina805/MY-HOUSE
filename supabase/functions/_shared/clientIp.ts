/**
 * Optional per-network rate limiting.
 *
 * Supabase does not document any client-IP header that hosted Edge Functions can trust, so this
 * layer is off unless CLIENT_IP_HEADER names a header that the staging trust check proved cannot be
 * forged. Headers that clients can always forge are refused outright.
 */
import { sha256, toHex } from './sessionToken.ts'

/** Shared bucket for requests whose configured header is missing or unparseable. */
export const UNKNOWN_NETWORK = 'unknown'

const REFUSED_HEADERS = new Set(['x-forwarded-for', 'forwarded'])
const HEADER_NAME = /^[a-z0-9][a-z0-9-]*$/

export interface ClientIpHeaderConfig {
  header: string | null
  /** Set when CLIENT_IP_HEADER was provided but rejected. */
  rejected: boolean
}

export function parseClientIpHeader(raw: string | undefined): ClientIpHeaderConfig {
  const header = (raw ?? '').trim().toLowerCase()
  if (!header) return { header: null, rejected: false }
  if (!HEADER_NAME.test(header) || REFUSED_HEADERS.has(header)) {
    return { header: null, rejected: true }
  }
  return { header, rejected: false }
}

/**
 * The rate-limit key for the caller's network: hex SHA-256 of the IPv4 address or IPv6 /64, or
 * UNKNOWN_NETWORK. Returns null when the layer is off.
 */
export async function networkKeyFor(req: Request, header: string | null): Promise<string | null> {
  if (!header) return null
  const network = networkOf(req.headers.get(header))
  if (!network) return UNKNOWN_NETWORK
  return toHex(await sha256(new TextEncoder().encode(network)))
}

/** "ipv4:<address>" or "ipv6:<first four hextets>::/64"; null if the value is not one IP literal. */
export function networkOf(raw: string | null): string | null {
  if (raw === null) return null
  const value = raw.trim()
  const ipv4 = parseIpv4(value)
  if (ipv4) return `ipv4:${ipv4.join('.')}`

  const hextets = parseIpv6(value)
  if (!hextets) return null
  const isIpv4Mapped = hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff
  if (isIpv4Mapped) {
    return `ipv4:${[hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff].join('.')}`
  }
  return `ipv6:${hextets.slice(0, 4).map((part) => part.toString(16)).join(':')}::/64`
}

function parseIpv4(value: string): number[] | null {
  const octet = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
  const match = new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}$`).exec(value)
  return match ? match.slice(1).map(Number) : null
}

function parseIpv6(value: string): number[] | null {
  if (!value.includes(':') || !/^[0-9A-Fa-f:.]+$/.test(value)) return null
  let hostname: string
  try {
    hostname = new URL(`http://[${value}]/`).hostname
  } catch {
    return null
  }
  // The URL parser validated the address and serialized it as compressed lowercase hextets.
  const address = hostname.slice(1, -1)
  const [head, tail] = address.split('::') as [string, string | undefined]
  const left = head ? head.split(':') : []
  if (tail === undefined) return left.length === 8 ? left.map((part) => parseInt(part, 16)) : null
  const right = tail ? tail.split(':') : []
  const zeros = 8 - left.length - right.length
  if (zeros < 1) return null
  return [...left, ...Array<string>(zeros).fill('0'), ...right].map((part) => parseInt(part, 16))
}
