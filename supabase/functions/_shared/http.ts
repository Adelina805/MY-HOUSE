/**
 * Request pipeline shared by the four functions:
 * origin allowlist (403) -> preflight -> method (405) -> publishable key (401) -> JSON media type
 * (415) -> 2 KiB body limit (413) -> strict schema (400) -> handler.
 *
 * Logs carry only the function name, status, SQLSTATE, and a fixed reason string: never tokens,
 * registration keys, hashes, bodies, IP addresses, or database messages.
 */
import type { ApiErrorCode } from './apiContract.ts'
import { networkKeyFor, parseClientIpHeader } from './clientIp.ts'
import { corsHeaders, isOriginAllowed, parseAllowedOrigins, preflightHeaders } from './cors.ts'
import { verifyAuth, type VerifyAuthOptions } from './deps.ts'
import { type CallRpc, createRpcCaller, type RpcFailure, UnexpectedRpcResult } from './rpc.ts'
import type { Parsed } from './validation.ts'

export const MAX_BODY_BYTES = 2048

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  invalid_request: 'The request is invalid.',
  invalid_cursor: 'The cursor no longer exists. Start again from the first page.',
  invalid_api_key: 'A valid publishable key is required in the apikey header.',
  invalid_session: 'The session is unknown or has expired. Register a new visit.',
  origin_not_allowed: 'This origin is not allowed.',
  method_not_allowed: 'This method is not allowed.',
  award_id_conflict: 'This award id was already used for a different award.',
  payload_too_large: 'The request body is too large.',
  unsupported_media_type: 'The request body must be application/json.',
  invalid_prize: 'This prize, adjective, and location combination is not in the catalog.',
  rate_limited: 'Too many requests. Nothing was recorded; retry the same request later.',
  server_misconfigured: 'The server is misconfigured.',
  internal_error: 'Something went wrong.',
  busy: 'The service is busy. Retry shortly.',
}

export interface ApiResponse {
  status: number
  /** Serialized as JSON. Omitted for 204 responses. */
  body?: unknown
  /** Already-serialized JSON body, used instead of `body` (cached guestbook pages). */
  rawBody?: string
  headers?: Record<string, string>
  /** For logs only. */
  sqlstate?: string | null
  /** For logs only: a fixed identifier, never request data. */
  reason?: string
}

export function json(status: number, body: unknown): ApiResponse {
  return { status, body }
}

export function apiError(
  status: number,
  code: ApiErrorCode,
  options: { message?: string; retryAfterSeconds?: number; sqlstate?: string | null; reason?: string } = {},
): ApiResponse {
  const { message = ERROR_MESSAGES[code], retryAfterSeconds, sqlstate, reason } = options
  return {
    status,
    body: { error: { code, message, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) } },
    headers: retryAfterSeconds === undefined ? undefined : { 'retry-after': String(retryAfterSeconds) },
    sqlstate,
    reason,
  }
}

export function rateLimited(retryAfterSeconds: number): ApiResponse {
  return apiError(429, 'rate_limited', { retryAfterSeconds })
}

export function rpcFailure(failure: RpcFailure): ApiResponse {
  switch (failure.kind) {
    case 'misconfigured':
      return apiError(500, 'server_misconfigured', { reason: 'admin_client_unavailable' })
    case 'unavailable':
      return apiError(503, 'busy', { retryAfterSeconds: 1, sqlstate: failure.sqlstate })
    case 'invalid_argument':
      return apiError(400, 'invalid_request', { sqlstate: failure.sqlstate })
    case 'error':
      return apiError(500, 'internal_error', { sqlstate: failure.sqlstate })
  }
}

export interface LogEntry {
  fn: string
  status: number
  sqlstate?: string
  reason?: string
}

export type Logger = (entry: LogEntry) => void

export type ApiKeyCheck = (req: Request) => Promise<'ok' | 'invalid' | 'misconfigured'>

export interface EndpointDeps {
  allowedOrigins: ReadonlySet<string>
  /** Lowercase header name for the optional per-network limits, or null when they are off. */
  clientIpHeader: string | null
  checkApiKey: ApiKeyCheck
  rpc: CallRpc
  log: Logger
  now: () => number
}

export interface HandlerContext<Input> {
  input: Input
  rpc: CallRpc
  /** Hashed network key for rate limits, or null when the per-network layer is off. */
  networkKey: () => Promise<string | null>
}

interface EndpointBase<Input> {
  name: string
  handle: (context: HandlerContext<Input>) => Promise<ApiResponse>
}

export type Endpoint<Input> =
  | (EndpointBase<Input> & { method: 'POST'; parse: (body: unknown) => Parsed<Input> })
  | (EndpointBase<Input> & { method: 'GET'; parse: (query: URLSearchParams) => Parsed<Input> })

export function createEndpoint<Input>(
  deps: EndpointDeps,
  endpoint: Endpoint<Input>,
): (req: Request) => Promise<Response> {
  async function process(req: Request, origin: string | null): Promise<ApiResponse> {
    if (!isOriginAllowed(origin, deps.allowedOrigins)) return apiError(403, 'origin_not_allowed')
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: preflightHeaders(origin, endpoint.method) }
    }
    if (req.method !== endpoint.method) {
      const response = apiError(405, 'method_not_allowed')
      return { ...response, headers: { allow: `${endpoint.method}, OPTIONS` } }
    }

    const apiKey = await deps.checkApiKey(req)
    if (apiKey === 'misconfigured') {
      return apiError(500, 'server_misconfigured', { reason: 'api_key_verification_unavailable' })
    }
    if (apiKey === 'invalid') return apiError(401, 'invalid_api_key')

    let parsed: Parsed<Input>
    if (endpoint.method === 'POST') {
      const body = await readJsonBody(req)
      if ('response' in body) return body.response
      parsed = endpoint.parse(body.value)
    } else {
      parsed = endpoint.parse(new URL(req.url).searchParams)
    }
    if (!parsed.ok) return apiError(400, 'invalid_request', { message: parsed.message })

    return await endpoint.handle({
      input: parsed.value,
      rpc: deps.rpc,
      networkKey: () => networkKeyFor(req, deps.clientIpHeader),
    })
  }

  return async (req) => {
    const origin = req.headers.get('origin')
    let result: ApiResponse
    try {
      result = await process(req, origin)
    } catch (error) {
      const reason = error instanceof UnexpectedRpcResult ? 'unexpected_rpc_result' : 'unhandled_exception'
      result = apiError(500, 'internal_error', { reason })
    }
    if (result.status >= 400) {
      deps.log({
        fn: endpoint.name,
        status: result.status,
        ...(result.sqlstate ? { sqlstate: result.sqlstate } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      })
    }
    const allowedOrigin = origin !== null && deps.allowedOrigins.has(origin) ? origin : null
    return toResponse(result, allowedOrigin)
  }
}

function toResponse(result: ApiResponse, allowedOrigin: string | null): Response {
  const headers = new Headers({
    'cache-control': 'no-store',
    'vary': 'Origin',
    'x-content-type-options': 'nosniff',
    ...corsHeaders(allowedOrigin),
    ...result.headers,
  })
  if (result.body === undefined && result.rawBody === undefined) {
    return new Response(null, { status: result.status, headers })
  }
  headers.set('content-type', 'application/json; charset=utf-8')
  const payload = result.rawBody ?? JSON.stringify(result.body)
  return new Response(payload, { status: result.status, headers })
}

async function readJsonBody(req: Request): Promise<{ value: unknown } | { response: ApiResponse }> {
  const mediaType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (mediaType !== 'application/json') return { response: apiError(415, 'unsupported_media_type') }

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_BODY_BYTES) return { response: apiError(413, 'payload_too_large') }
  const bytes = await readAtMost(req.body, MAX_BODY_BYTES)
  if (!bytes) return { response: apiError(413, 'payload_too_large') }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { response: apiError(400, 'invalid_request', { message: 'The body must be UTF-8 JSON.' }) }
  }
  try {
    return { value: JSON.parse(text) }
  } catch {
    return { response: apiError(400, 'invalid_request', { message: 'The body must be valid JSON.' }) }
  }
}

/** Reads the whole body unless it exceeds `limit` bytes, whatever Content-Length claims. */
async function readAtMost(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array(0)
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Verifies the apikey header against the project's default publishable key. */
export function publishableKeyCheck(env?: VerifyAuthOptions['env']): ApiKeyCheck {
  return async (req) => {
    try {
      const { error } = await verifyAuth(req, { auth: 'publishable', env })
      if (!error) return 'ok'
      // AuthError carries hints and diagnostics; only its status is used, nothing is forwarded.
      return error.status >= 500 ? 'misconfigured' : 'invalid'
    } catch {
      return 'misconfigured'
    }
  }
}

function logToConsole(entry: LogEntry): void {
  const line = JSON.stringify(entry)
  if (entry.status >= 500) console.error(line)
  else console.log(line)
}

/** Dependencies for the deployed functions, read from the environment once per isolate. */
export function productionDeps(): EndpointDeps {
  const origins = parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS'))
  if (origins.origins.size === 0 || origins.ignoredEntries > 0) {
    console.warn(JSON.stringify({
      config: 'ALLOWED_ORIGINS',
      allowedOrigins: origins.origins.size,
      ignoredEntries: origins.ignoredEntries,
    }))
  }
  const clientIp = parseClientIpHeader(Deno.env.get('CLIENT_IP_HEADER'))
  if (clientIp.rejected) {
    console.warn(JSON.stringify({ config: 'CLIENT_IP_HEADER', rejected: true, perNetworkLimits: 'off' }))
  }
  return {
    allowedOrigins: origins.origins,
    clientIpHeader: clientIp.header,
    checkApiKey: publishableKeyCheck(),
    rpc: createRpcCaller(),
    log: logToConsole,
    now: Date.now,
  }
}
