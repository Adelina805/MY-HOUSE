import type { ApiErrorCode, ApiErrorResponse } from './apiContract'

export type FunctionName =
  | 'start-session'
  | 'record-knocks'
  | 'record-award'
  | 'get-guestbook'

/**
 * `network` and `timeout` mean no response arrived; `bad_response` is a response the client
 * could not read; `http_error` is an error status without the API's error body (e.g. a gateway).
 */
export type FailureCode =
  | ApiErrorCode
  | 'network'
  | 'timeout'
  | 'bad_response'
  | 'http_error'
  | 'not_configured'

export interface ApiFailure {
  /** HTTP status, or 0 when no response arrived. */
  status: number
  code: FailureCode
  /** Seconds the server asked for before a retry (429 and 503), or null. */
  retryAfterSeconds: number | null
  /** Sending the identical request again later may succeed. */
  retryable: boolean
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; failure: ApiFailure }

/** Public values only: Vite bundles both into the browser JavaScript. */
export interface ApiConfig {
  /** Project API URL without a trailing slash, e.g. http://127.0.0.1:54321. */
  url: string
  /** sb_publishable_… */
  publishableKey: string
}

export type ApiConfigResult =
  | { ok: true; config: ApiConfig }
  | { ok: false; problem: string }

export interface ApiClient {
  readonly configured: boolean
  post<T>(
    name: FunctionName,
    body: unknown,
    options?: { keepalive?: boolean },
  ): Promise<ApiResult<T>>
  get<T>(name: FunctionName, query?: Record<string, string>): Promise<ApiResult<T>>
}

export interface ApiClientDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>
  timeoutMs?: number
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_RETRY_AFTER_SECONDS = 3600

const API_ERROR_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'invalid_request',
  'invalid_cursor',
  'invalid_api_key',
  'invalid_session',
  'origin_not_allowed',
  'method_not_allowed',
  'award_id_conflict',
  'payload_too_large',
  'unsupported_media_type',
  'invalid_prize',
  'rate_limited',
  'server_misconfigured',
  'internal_error',
  'busy',
])

/**
 * Validates the two VITE_ values. A secret key or legacy JWT is refused outright: the browser
 * bundle is public, and the functions accept only the publishable key.
 */
export function parseApiConfig(raw: {
  url: unknown
  publishableKey: unknown
}): ApiConfigResult {
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  const key = typeof raw.publishableKey === 'string' ? raw.publishableKey.trim() : ''
  if (!url || !key) {
    return {
      ok: false,
      problem: 'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set.',
    }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, problem: 'VITE_SUPABASE_URL is not a valid URL.' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, problem: 'VITE_SUPABASE_URL must use http or https.' }
  }
  if (key.startsWith('sb_secret_') || key.split('.').length === 3) {
    return {
      ok: false,
      problem:
        'VITE_SUPABASE_PUBLISHABLE_KEY must be the publishable key (sb_publishable_…), never a secret or JWT key.',
    }
  }
  if (!key.startsWith('sb_publishable_')) {
    return {
      ok: false,
      problem: 'VITE_SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_.',
    }
  }
  return { ok: true, config: { url: url.replace(/\/+$/, ''), publishableKey: key } }
}

function failure(
  status: number,
  code: FailureCode,
  retryAfterSeconds: number | null = null,
): ApiFailure {
  const retryable =
    status === 0
      ? code !== 'not_configured'
      : status === 408 || status === 429 || status >= 500 || code === 'bad_response'
  return { status, code, retryAfterSeconds, retryable }
}

function parseRetryAfter(
  header: string | null,
  bodySeconds: unknown,
  now: number,
): number | null {
  let seconds: number | null = null
  if (header !== null && /^\d+$/.test(header.trim())) {
    seconds = Number(header.trim())
  } else if (header !== null && header.trim() !== '') {
    const date = Date.parse(header)
    if (Number.isFinite(date)) seconds = Math.ceil((date - now) / 1000)
  }
  if (seconds === null && typeof bodySeconds === 'number' && Number.isFinite(bodySeconds)) {
    seconds = bodySeconds
  }
  if (seconds === null) return null
  return Math.min(Math.max(Math.ceil(seconds), 0), MAX_RETRY_AFTER_SECONDS)
}

function readErrorBody(json: unknown): ApiErrorResponse['error'] | null {
  if (typeof json !== 'object' || json === null) return null
  const error = (json as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return null
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string' || !API_ERROR_CODES.has(code)) return null
  return error as ApiErrorResponse['error']
}

export function createApiClient(
  config: ApiConfig | null,
  deps: ApiClientDeps,
): ApiClient {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = deps.now ?? Date.now

  async function send<T>(
    method: 'GET' | 'POST',
    name: FunctionName,
    init: { body?: string; query?: Record<string, string>; keepalive?: boolean },
  ): Promise<ApiResult<T>> {
    if (!config) return { ok: false, failure: failure(0, 'not_configured') }

    const query = init.query ? `?${new URLSearchParams(init.query).toString()}` : ''
    const headers: Record<string, string> = { apikey: config.publishableKey }
    if (init.body !== undefined) headers['content-type'] = 'application/json'

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    let response: Response
    let text: string
    try {
      response = await deps.fetch(`${config.url}/functions/v1/${name}${query}`, {
        method,
        headers,
        body: init.body,
        credentials: 'omit',
        keepalive: init.keepalive ?? false,
        signal: controller.signal,
      })
      text = await response.text()
    } catch {
      return { ok: false, failure: failure(0, timedOut ? 'timeout' : 'network') }
    } finally {
      clearTimeout(timer)
    }

    let json: unknown = null
    let parsed = false
    if (text) {
      try {
        json = JSON.parse(text)
        parsed = true
      } catch {
        parsed = false
      }
    }

    if (response.ok) {
      if (!parsed) return { ok: false, failure: failure(response.status, 'bad_response') }
      return { ok: true, status: response.status, data: json as T }
    }

    const error = parsed ? readErrorBody(json) : null
    const retryAfterSeconds = parseRetryAfter(
      response.headers.get('retry-after'),
      error?.retryAfterSeconds,
      now(),
    )
    return {
      ok: false,
      failure: failure(response.status, error?.code ?? 'http_error', retryAfterSeconds),
    }
  }

  return {
    configured: config !== null,
    post(name, body, options) {
      return send('POST', name, {
        body: JSON.stringify(body),
        keepalive: options?.keepalive,
      })
    },
    get(name, query) {
      return send('GET', name, { query })
    },
  }
}
