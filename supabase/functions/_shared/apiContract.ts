/**
 * Wire contract for the guestbook Edge Functions.
 *
 * Types only: src/data/apiContract.ts re-exports this file for the frontend, so it must never
 * import anything or contain runtime code.
 */

/** A visitor as the public API describes it. Session ids, tokens, and hashes never appear. */
export interface PublicVisitor {
  visitorNumber: number
  alias: string
  knockCount: number
  /** ISO-8601 UTC timestamp, e.g. "2026-10-29T18:04:05.123Z". */
  startedAt: string
}

export interface GuestbookEntry {
  awardId: string
  visitorNumber: number
  alias: string
  prizeId: string
  objectName: string
  adjective: string
  location: string
  /** ISO-8601 UTC timestamp. */
  awardedAt: string
}

export interface GuestbookStats {
  visitorCount: number
  giftsGiven: number
  doorKnocks: number
}

/**
 * POST /functions/v1/start-session to register a new visit.
 * Generate the key once per registration attempt, save it before sending, and resend the same key
 * on every retry until a response arrives.
 */
export interface RegisterSessionRequest {
  /** 32 random bytes, base64url-encoded without padding (43 characters). */
  registrationKey: string
}

/** POST /functions/v1/start-session to continue a visit. */
export interface ResumeSessionRequest {
  sessionToken: string
}

/** Exactly one of the two fields; sending both or neither is a 400. */
export type StartSessionRequest = RegisterSessionRequest | ResumeSessionRequest

/** 201 for a new visit; 200 with `replayed: true` when a retry recovered an earlier registration. */
export interface RegisterSessionResponse {
  status: 'registered'
  replayed: boolean
  sessionToken: string
  visitor: PublicVisitor
}

/** 200 */
export interface ResumeSessionResponse {
  status: 'resumed'
  visitor: PublicVisitor
}

export type StartSessionResponse = RegisterSessionResponse | ResumeSessionResponse

/** POST /functions/v1/record-award */
export interface RecordAwardRequest {
  sessionToken: string
  /** UUID chosen once per prize reveal and reused for every retry of that reveal. */
  awardId: string
  prizeId: string
  adjective: string
  location: string
}

/** 201 when recorded; 200 with `duplicate: true` when a retry matched the recorded award. */
export interface RecordAwardResponse {
  award: GuestbookEntry
  duplicate: boolean
}

/** POST /functions/v1/record-knocks */
export interface RecordKnocksRequest {
  sessionToken: string
  /** Cumulative counted knocks for this session (0-5000), not a delta. */
  totalKnocks: number
}

/** 200 */
export interface RecordKnocksResponse {
  /** The total the server has recorded for this session. */
  knockCount: number
  /** How many knocks this request added. */
  accepted: number
}

/** GET /functions/v1/get-guestbook?limit=1..50&cursor=<awardId> (limit defaults to 20). */
export interface GuestbookPageResponse {
  stats: GuestbookStats
  /** Newest first. */
  entries: GuestbookEntry[]
  /** Pass as `cursor` to fetch the next, older page; null on the last page. */
  nextCursor: string | null
}

export type ApiErrorCode =
  | 'invalid_request' // 400
  | 'invalid_cursor' // 400: the cursor award no longer exists; start again from the first page
  | 'invalid_api_key' // 401: missing or wrong publishable key
  | 'invalid_session' // 401: unknown or expired session token; register a new visit
  | 'origin_not_allowed' // 403
  | 'method_not_allowed' // 405
  | 'award_id_conflict' // 409: the award id was already used for a different award
  | 'payload_too_large' // 413
  | 'unsupported_media_type' // 415
  | 'invalid_prize' // 422: not a prize/adjective/location combination from the catalog
  | 'rate_limited' // 429: nothing was recorded; retry the same request after retryAfterSeconds
  | 'server_misconfigured' // 500
  | 'internal_error' // 500
  | 'busy' // 503: temporary; retry after retryAfterSeconds

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    /** Present on 429 and 503, and mirrored in the Retry-After header. */
    retryAfterSeconds?: number
  }
}
