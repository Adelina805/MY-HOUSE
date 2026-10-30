/**
 * The only path from the Edge Functions to Postgres: one SECURITY DEFINER RPC per request, called
 * with the secret key. Results are decoded into public shapes field by field, so nothing the SQL
 * returns beyond the documented fields can reach a response.
 */
import type { GuestbookEntry, GuestbookPageResponse, GuestbookStats, PublicVisitor } from './apiContract.ts'
import { createAdminClient } from './deps.ts'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

/** The five API functions granted to service_role, with their SQL parameter names. */
interface GuestbookDatabase {
  public: {
    Tables: { [_ in never]: never }
    Views: { [_ in never]: never }
    Functions: {
      register_visitor_session: {
        Args: {
          p_registration_hash: string
          p_token_hash: string
          p_token_salt: string
          p_network_key: string | null
        }
        Returns: Json
      }
      resume_visitor_session: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      record_prize_award: {
        Args: {
          p_token_hash: string
          p_award_id: string
          p_prize_id: string
          p_object_name: string
          p_adjective: string
          p_location: string
          p_network_key: string | null
        }
        Returns: Json
      }
      record_knocks: {
        Args: { p_token_hash: string; p_total_knocks: number }
        Returns: Json
      }
      get_guestbook_page: {
        Args: { p_limit: number; p_cursor: string | null }
        Returns: Json
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type ApiFunctions = GuestbookDatabase['public']['Functions']
export type RpcName = keyof ApiFunctions
export type RpcArgs<Name extends RpcName> = ApiFunctions[Name]['Args']

export type RpcFailureKind =
  /** The function cannot create the admin client (missing URL or secret key). */
  | 'misconfigured'
  /** Timeouts, lost connections, lock or serialization conflicts: worth retrying. */
  | 'unavailable'
  /** The RPC rejected an argument (SQLSTATE 22023). */
  | 'invalid_argument'
  | 'error'

export type RpcFailure = { ok: false; kind: RpcFailureKind; sqlstate: string | null }
export type RpcOutcome = { ok: true; data: unknown } | RpcFailure
export type CallRpc = <Name extends RpcName>(name: Name, args: RpcArgs<Name>) => Promise<RpcOutcome>

const RPC_TIMEOUT_MS = 10_000

const RETRYABLE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled
  '53000', // insufficient_resources
  '53100', // disk_full
  '53200', // out_of_memory
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  'PGRST000', // PostgREST could not connect to the database
  'PGRST001', // PostgREST lost its database connection
  'PGRST002', // PostgREST schema cache not loaded
  'PGRST003', // PostgREST connection pool timeout
])

/** Keeps only codes that look like SQLSTATEs or PostgREST errors, so logs never carry free text. */
export function normalizeErrorCode(code: unknown): string | null {
  if (typeof code !== 'string') return null
  return /^[0-9A-Z]{5}$/.test(code) || /^PGRST\d{3}$/.test(code) ? code : null
}

export function classifyErrorCode(sqlstate: string | null): RpcFailureKind {
  if (sqlstate === null) return 'unavailable' // the request never got a database answer
  if (sqlstate === '22023') return 'invalid_argument'
  return RETRYABLE_CODES.has(sqlstate) ? 'unavailable' : 'error'
}

export function createRpcCaller(timeoutMs = RPC_TIMEOUT_MS): CallRpc {
  return async (name, args) => {
    let client: ReturnType<typeof createAdminClient<GuestbookDatabase>>
    try {
      client = createAdminClient<GuestbookDatabase>()
    } catch {
      return { ok: false, kind: 'misconfigured', sqlstate: null }
    }
    const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(timeoutMs))
    if (error) {
      const sqlstate = normalizeErrorCode(error.code)
      return { ok: false, kind: classifyErrorCode(sqlstate), sqlstate }
    }
    return { ok: true, data }
  }
}

/** Thrown when an RPC answers with a shape this code does not know. Maps to a 500. */
export class UnexpectedRpcResult extends Error {
  constructor() {
    super('Unexpected RPC result')
    this.name = 'UnexpectedRpcResult'
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new UnexpectedRpcResult()
  return value as Record<string, unknown>
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new UnexpectedRpcResult()
  return value
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new UnexpectedRpcResult()
  return value
}

function retryAfterSeconds(value: unknown): number {
  const seconds = count(value)
  if (seconds < 1) throw new UnexpectedRpcResult()
  return seconds
}

export function toPublicVisitor(value: unknown): PublicVisitor {
  const visitor = object(value)
  return {
    visitorNumber: count(visitor.visitorNumber),
    alias: text(visitor.alias),
    knockCount: count(visitor.knockCount),
    startedAt: text(visitor.startedAt),
  }
}

export function toGuestbookEntry(value: unknown): GuestbookEntry {
  const entry = object(value)
  return {
    awardId: text(entry.awardId),
    visitorNumber: count(entry.visitorNumber),
    alias: text(entry.alias),
    prizeId: text(entry.prizeId),
    objectName: text(entry.objectName),
    adjective: text(entry.adjective),
    location: text(entry.location),
    awardedAt: text(entry.awardedAt),
  }
}

function toGuestbookStats(value: unknown): GuestbookStats {
  const stats = object(value)
  return {
    visitorCount: count(stats.visitorCount),
    giftsGiven: count(stats.giftsGiven),
    doorKnocks: count(stats.doorKnocks),
  }
}

type RateLimited = { status: 'rate_limited'; retryAfterSeconds: number }
type InvalidSession = { status: 'invalid_session' }

export type RegisterResult =
  | { status: 'created'; visitor: PublicVisitor }
  | { status: 'replayed'; visitor: PublicVisitor; tokenSalt: string; tokenHash: string }
  | RateLimited

export function decodeRegisterResult(data: unknown): RegisterResult {
  const result = object(data)
  switch (result.status) {
    case 'created':
      return { status: 'created', visitor: toPublicVisitor(result.visitor) }
    case 'replayed':
      return {
        status: 'replayed',
        visitor: toPublicVisitor(result.visitor),
        tokenSalt: text(result.tokenSalt),
        tokenHash: text(result.tokenHash),
      }
    case 'rate_limited':
      return { status: 'rate_limited', retryAfterSeconds: retryAfterSeconds(result.retryAfterSeconds) }
    default:
      throw new UnexpectedRpcResult()
  }
}

export type ResumeResult = { status: 'resumed'; visitor: PublicVisitor } | InvalidSession | RateLimited

export function decodeResumeResult(data: unknown): ResumeResult {
  const result = object(data)
  switch (result.status) {
    case 'resumed':
      return { status: 'resumed', visitor: toPublicVisitor(result.visitor) }
    case 'invalid_session':
      return { status: 'invalid_session' }
    case 'rate_limited':
      return { status: 'rate_limited', retryAfterSeconds: retryAfterSeconds(result.retryAfterSeconds) }
    default:
      throw new UnexpectedRpcResult()
  }
}

export type AwardResult =
  | { status: 'created' | 'duplicate'; award: GuestbookEntry }
  | { status: 'conflict' }
  | InvalidSession
  | RateLimited

export function decodeAwardResult(data: unknown): AwardResult {
  const result = object(data)
  switch (result.status) {
    case 'created':
    case 'duplicate':
      return { status: result.status, award: toGuestbookEntry(result.award) }
    case 'conflict':
    case 'invalid_session':
      return { status: result.status }
    case 'rate_limited':
      return { status: 'rate_limited', retryAfterSeconds: retryAfterSeconds(result.retryAfterSeconds) }
    default:
      throw new UnexpectedRpcResult()
  }
}

export type KnocksResult = { status: 'ok'; knockCount: number; accepted: number } | InvalidSession | RateLimited

export function decodeKnocksResult(data: unknown): KnocksResult {
  const result = object(data)
  switch (result.status) {
    case 'ok':
      return { status: 'ok', knockCount: count(result.knockCount), accepted: count(result.accepted) }
    case 'invalid_session':
      return { status: 'invalid_session' }
    case 'rate_limited':
      return { status: 'rate_limited', retryAfterSeconds: retryAfterSeconds(result.retryAfterSeconds) }
    default:
      throw new UnexpectedRpcResult()
  }
}

export type GuestbookResult = { status: 'ok'; page: GuestbookPageResponse } | { status: 'invalid_cursor' }

export function decodeGuestbookResult(data: unknown): GuestbookResult {
  const result = object(data)
  switch (result.status) {
    case 'ok': {
      if (!Array.isArray(result.entries)) throw new UnexpectedRpcResult()
      const nextCursor = result.nextCursor === null ? null : text(result.nextCursor)
      return {
        status: 'ok',
        page: {
          stats: toGuestbookStats(result.stats),
          entries: result.entries.map(toGuestbookEntry),
          nextCursor,
        },
      }
    }
    case 'invalid_cursor':
      return { status: 'invalid_cursor' }
    default:
      throw new UnexpectedRpcResult()
  }
}
