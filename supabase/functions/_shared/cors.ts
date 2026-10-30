const ALLOWED_REQUEST_HEADERS = 'authorization, x-client-info, apikey, content-type'
const PREFLIGHT_MAX_AGE_SECONDS = '3600'

export interface AllowedOrigins {
  origins: ReadonlySet<string>
  /** Entries that were not an exact http(s) origin and were ignored. */
  ignoredEntries: number
}

/**
 * Parses ALLOWED_ORIGINS: a comma-separated list of exact origins such as https://example.com.
 * Unset or empty means no browser origin is allowed. Wildcards, "null", paths, and anything else
 * that is not a canonical http(s) origin are ignored.
 */
export function parseAllowedOrigins(raw: string | undefined): AllowedOrigins {
  const origins = new Set<string>()
  let ignoredEntries = 0
  for (const entry of (raw ?? '').split(',')) {
    const candidate = entry.trim()
    if (!candidate) continue
    if (isCanonicalOrigin(candidate)) origins.add(candidate)
    else ignoredEntries += 1
  }
  return { origins, ignoredEntries }
}

function isCanonicalOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value
  } catch {
    return false
  }
}

/** Requests without an Origin header (servers, curl) are allowed: CORS is not authentication. */
export function isOriginAllowed(origin: string | null, allowed: ReadonlySet<string>): boolean {
  return origin === null || allowed.has(origin)
}

/** Headers for a response to an allowed request. */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (origin === null) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-expose-headers': 'retry-after',
  }
}

/** Headers for a successful preflight (OPTIONS) response. */
export function preflightHeaders(origin: string | null, method: string): Record<string, string> {
  return {
    ...corsHeaders(origin),
    'access-control-allow-methods': `${method}, OPTIONS`,
    'access-control-allow-headers': ALLOWED_REQUEST_HEADERS,
    'access-control-max-age': PREFLIGHT_MAX_AGE_SECONDS,
  }
}
