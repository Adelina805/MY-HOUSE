/**
 * Strict request validation. Unknown fields are rejected, and messages name fields but never echo
 * submitted values.
 */
import { type Bytes, decodeSecret } from './sessionToken.ts'

/** Mirrors private.max_session_knocks(). */
export const MAX_TOTAL_KNOCKS = 5000
export const DEFAULT_PAGE_LIMIT = 20
export const MAX_PAGE_LIMIT = 50

// Mirror the CHECK constraints on public.prize_awards; the catalog check comes after these.
const MAX_PRIZE_ID_LENGTH = 64
const MAX_ADJECTIVE_LENGTH = 40
const MAX_LOCATION_LENGTH = 80

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

function invalid(message: string): { ok: false; message: string } {
  return { ok: false, message }
}

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function hasExactly(body: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(body)
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(body, field))
}

function secret(value: unknown): Bytes | null {
  return typeof value === 'string' ? decodeSecret(value) : null
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const length = [...value].length
  return length >= 1 && length <= maxLength ? value : null
}

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

export type StartSessionInput =
  | { kind: 'register'; registrationKey: Bytes }
  | { kind: 'resume'; sessionToken: Bytes }

export function parseStartSession(value: unknown): Parsed<StartSessionInput> {
  const body = plainObject(value)
  const exactlyOne = 'Send exactly one of registrationKey or sessionToken.'
  if (!body) return invalid(exactlyOne)
  if (hasExactly(body, ['registrationKey'])) {
    const registrationKey = secret(body.registrationKey)
    if (!registrationKey) {
      return invalid('registrationKey must be 32 random bytes encoded as unpadded base64url.')
    }
    return { ok: true, value: { kind: 'register', registrationKey } }
  }
  if (hasExactly(body, ['sessionToken'])) {
    const sessionToken = secret(body.sessionToken)
    if (!sessionToken) return invalid('sessionToken is malformed.')
    return { ok: true, value: { kind: 'resume', sessionToken } }
  }
  return invalid(exactlyOne)
}

export interface RecordAwardInput {
  sessionToken: Bytes
  awardId: string
  prizeId: string
  adjective: string
  location: string
}

export function parseRecordAward(value: unknown): Parsed<RecordAwardInput> {
  const body = plainObject(value)
  if (!body || !hasExactly(body, ['sessionToken', 'awardId', 'prizeId', 'adjective', 'location'])) {
    return invalid('Send exactly sessionToken, awardId, prizeId, adjective, and location.')
  }
  const sessionToken = secret(body.sessionToken)
  if (!sessionToken) return invalid('sessionToken is malformed.')
  if (typeof body.awardId !== 'string' || !isUuid(body.awardId)) {
    return invalid('awardId must be a UUID.')
  }
  const prizeId = boundedText(body.prizeId, MAX_PRIZE_ID_LENGTH)
  const adjective = boundedText(body.adjective, MAX_ADJECTIVE_LENGTH)
  const location = boundedText(body.location, MAX_LOCATION_LENGTH)
  if (!prizeId || !adjective || !location) {
    return invalid('prizeId, adjective, and location must be non-empty strings within their length limits.')
  }
  return {
    ok: true,
    value: { sessionToken, awardId: body.awardId.toLowerCase(), prizeId, adjective, location },
  }
}

export interface RecordKnocksInput {
  sessionToken: Bytes
  totalKnocks: number
}

export function parseRecordKnocks(value: unknown): Parsed<RecordKnocksInput> {
  const body = plainObject(value)
  if (!body || !hasExactly(body, ['sessionToken', 'totalKnocks'])) {
    return invalid('Send exactly sessionToken and totalKnocks.')
  }
  const sessionToken = secret(body.sessionToken)
  if (!sessionToken) return invalid('sessionToken is malformed.')
  const total = body.totalKnocks
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0 || total > MAX_TOTAL_KNOCKS) {
    return invalid(`totalKnocks must be an integer from 0 to ${MAX_TOTAL_KNOCKS}.`)
  }
  return { ok: true, value: { sessionToken, totalKnocks: total } }
}

export interface GuestbookQuery {
  limit: number
  cursor: string | null
}

export function parseGuestbookQuery(params: URLSearchParams): Parsed<GuestbookQuery> {
  const names = [...params.keys()]
  if (names.some((name) => name !== 'limit' && name !== 'cursor') || new Set(names).size !== names.length) {
    return invalid('Only limit and cursor are accepted, each at most once.')
  }
  let limit = DEFAULT_PAGE_LIMIT
  const rawLimit = params.get('limit')
  if (rawLimit !== null) {
    if (!/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > MAX_PAGE_LIMIT) {
      return invalid(`limit must be an integer from 1 to ${MAX_PAGE_LIMIT}.`)
    }
    limit = Number(rawLimit)
  }
  const rawCursor = params.get('cursor')
  if (rawCursor !== null && !isUuid(rawCursor)) {
    return invalid('cursor must be a nextCursor value from an earlier page.')
  }
  return { ok: true, value: { limit, cursor: rawCursor === null ? null : rawCursor.toLowerCase() } }
}
