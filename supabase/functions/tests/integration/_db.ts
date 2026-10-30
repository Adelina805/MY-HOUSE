/**
 * Direct access to the local database for arranging states the API cannot produce on demand
 * (full rate-limit buckets, aged credentials, held locks) and for checking invariants.
 * The connection settings come from _env.ts, which only accepts the local stack.
 */
import postgres from 'postgres'
import { decodeSecret, hashSessionToken, sha256, toHex } from '../../_shared/sessionToken.ts'
import { stack } from './_env.ts'

export const sql = postgres(stack.dbUrl, { max: 30, idle_timeout: 5, onnotice: () => {} })

export type ReservedConnection = Awaited<ReturnType<typeof sql.reserve>>

/** Rolls back anything a failed test left open, then returns the connection to the pool. */
export async function release(connection: ReservedConnection): Promise<void> {
  await connection`rollback`.catch(() => {})
  connection.release()
}

/** Integration tests share one connection pool across tests, so per-test resource checks are off. */
export function integrationTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })
}

/** Deletes every visitor, award, and rate-limit bucket. TRUNCATE also rebuilds site_stats. */
export async function resetData(): Promise<void> {
  await sql`truncate public.visitor_sessions, public.prize_awards cascade`
  await sql`delete from private.rate_limit_buckets`
}

export async function fillBucket(bucketKey: string, used: number): Promise<void> {
  await sql`
    insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
    values (${bucketKey}, now(), ${used})
    on conflict (bucket_key) do update set window_started_at = now(), used = excluded.used`
}

/** Moves a bucket's window into the past, as if its window had elapsed. */
export async function endWindow(bucketKey: string): Promise<void> {
  await sql`
    update private.rate_limit_buckets
       set window_started_at = now() - interval '1 day'
     where bucket_key = ${bucketKey}`
}

export async function sessionIdForToken(sessionToken: string): Promise<string> {
  const tokenHash = await hashSessionToken(decodeSecret(sessionToken)!)
  const [row] = await sql`
    select session_id::text as id from private.session_credentials
     where token_hash = decode(${tokenHash}, 'hex')`
  if (!row) throw new Error('No credential for this token')
  return row.id
}

export async function registrationHashOf(registrationKey: string): Promise<string> {
  return toHex(await sha256(decodeSecret(registrationKey)!))
}

/** Moves a session's start into the past, which raises its knock cap by one per second. */
export async function ageSessionStart(sessionToken: string, seconds: number): Promise<void> {
  const id = await sessionIdForToken(sessionToken)
  await sql`
    update public.visitor_sessions
       set started_at = started_at - make_interval(secs => ${seconds})
     where id = ${id}::uuid`
}

export async function visitorCount(): Promise<number> {
  const [row] = await sql`select count(*)::int as n from public.visitor_sessions`
  return row.n
}

export interface Totals {
  visitorCount: number
  giftsGiven: number
  doorKnocks: number
}

/** The stored totals and the totals recomputed from the tables, read in one snapshot. */
export async function totals(): Promise<{ stored: Totals; actual: Totals }> {
  const [row] = await sql`
    select
      (select jsonb_build_object(
         'visitorCount', visitor_count, 'giftsGiven', gifts_given, 'doorKnocks', door_knocks)
         from public.site_stats where id = 1) as stored,
      jsonb_build_object(
        'visitorCount', (select count(*) from public.visitor_sessions),
        'giftsGiven', (select count(*) from public.prize_awards),
        'doorKnocks', (select coalesce(sum(knock_count), 0) from public.visitor_sessions)) as actual`
  return { stored: row.stored, actual: row.actual }
}

/** Number of other backends waiting on a heavyweight lock of the given kind. */
export async function lockWaiters(waitEvent: 'advisory' | 'relation' | 'transactionid' | 'tuple'): Promise<number> {
  const [row] = await sql`
    select count(*)::int as n from pg_stat_activity
     where wait_event_type = 'Lock' and wait_event = ${waitEvent} and pid <> pg_backend_pid()`
  return row.n
}

/** For work started now and awaited later: an early failure surfaces at the await, not as an unhandled rejection. */
export function background<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {})
  return promise
}

export async function waitUntil(check: () => Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
