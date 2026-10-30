/** HTTP helpers that call the deployed-locally functions through the API gateway. */
import { encodeBase64Url, randomSecret } from '../../_shared/sessionToken.ts'
import { ALLOWED_ORIGIN, stack } from './_env.ts'

export interface ApiResult {
  status: number
  headers: Headers
  text: string
  // deno-lint-ignore no-explicit-any
  json: any
}

export interface CallOptions {
  method?: string
  body?: unknown
  query?: string
  headers?: Record<string, string>
  /** Defaults to the local publishable key; null sends no apikey header. */
  apikey?: string | null
  /** Defaults to an allowed origin; null sends no Origin header. */
  origin?: string | null
  signal?: AbortSignal
}

export async function callFunction(name: string, options: CallOptions = {}): Promise<ApiResult> {
  const headers = new Headers(options.headers)
  if (options.apikey !== null) headers.set('apikey', options.apikey ?? stack.publishableKey)
  if (options.origin !== null) headers.set('origin', options.origin ?? ALLOWED_ORIGIN)
  if (options.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(`${stack.functionsUrl}/${name}${options.query ?? ''}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, headers: response.headers, text, json }
}

export function newKey(): string {
  return encodeBase64Url(randomSecret())
}

export function register(registrationKey: string = newKey(), options: CallOptions = {}): Promise<ApiResult> {
  return callFunction('start-session', { ...options, body: { registrationKey } })
}

export function resume(sessionToken: string): Promise<ApiResult> {
  return callFunction('start-session', { body: { sessionToken } })
}

export function knock(sessionToken: string, totalKnocks: number): Promise<ApiResult> {
  return callFunction('record-knocks', { body: { sessionToken, totalKnocks } })
}

export const TROPHY = { prizeId: 'trophy', adjective: 'champion', location: 'Balboa Park' }

export function award(
  sessionToken: string,
  awardId: string = crypto.randomUUID(),
  prize: { prizeId: string; adjective: string; location: string } = TROPHY,
): Promise<ApiResult> {
  return callFunction('record-award', { body: { sessionToken, awardId, ...prize } })
}

/** Each test passes its own limit: pages are cached per (limit, cursor) for 5 s in the function. */
export function guestbook(query: string): Promise<ApiResult> {
  return callFunction('get-guestbook', { query })
}
