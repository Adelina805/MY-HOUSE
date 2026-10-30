// private.rebuild_site_stats() under concurrent writes, with real parallel connections.
// Writers update site_stats through row triggers in their own transaction; the rebuild takes an
// EXCLUSIVE lock on site_stats, so it waits for in-flight writers and holds back new ones, while
// plain reads continue.
import { assert, assertEquals } from '@std/assert'
import { sha256, toHex } from '../../_shared/sessionToken.ts'
import { background, integrationTest, lockWaiters, release, resetData, sql, totals, waitUntil } from './_db.ts'

type Sql = typeof sql

async function hex(label: string): Promise<string> {
  return toHex(await sha256(new TextEncoder().encode(label)))
}

/** Registers a visitor by calling the RPC directly as the database owner. */
async function registerVisitor(connection: Sql, label: string): Promise<string> {
  const tokenHash = await hex(`token:${label}`)
  await connection`
    select public.register_visitor_session(
      ${await hex(`registration:${label}`)}, ${tokenHash}, ${await hex(`salt:${label}`)}, null)`
  return tokenHash
}

async function sqlstateOf(query: Promise<unknown>): Promise<string | null> {
  try {
    await query
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? 'no code'
  }
}

async function assertConsistent(): Promise<void> {
  const { stored, actual } = await totals()
  assertEquals(stored, actual)
}

integrationTest('a rebuild waits for an in-flight writer, includes its write, and never blocks reads', async () => {
  await resetData()
  await registerVisitor(sql, 'committed-before')
  const writer = await sql.reserve()
  const rebuilder = await sql.reserve()
  try {
    await writer`begin`
    await registerVisitor(writer, 'in-flight')

    const rebuild = background(rebuilder`select private.rebuild_site_stats() as result`.then(([row]) => row.result))
    await waitUntil(async () => (await lockWaiters('relation')) === 1, 'the rebuild to queue behind the writer')

    const [read] = await sql`select public.get_guestbook_page(5, null) as page`
    assertEquals(read.page.status, 'ok', 'a guestbook read completes while the rebuild waits')
    assertEquals(read.page.stats.visitorCount, 1, 'reads see only committed totals')

    await writer`commit`
    const result = await rebuild
    assertEquals(result.after.visitorCount, 2, 'the rebuild counted the writer that finished first')
    assertEquals(result.before, result.after, 'the triggers had already counted it: no drift')
  } finally {
    await release(writer)
    await release(rebuilder)
  }
  await assertConsistent()
})

integrationTest('a writer arriving during a rebuild waits and is counted exactly once', async () => {
  await resetData()
  for (const label of ['a', 'b', 'c']) await registerVisitor(sql, label)
  await sql`update public.site_stats set visitor_count = 99` // drift for the rebuild to repair

  const rebuilder = await sql.reserve()
  try {
    await rebuilder`begin`
    const [{ result }] = await rebuilder`select private.rebuild_site_stats() as result`
    assertEquals(result.before.visitorCount, 99)
    assertEquals(result.after.visitorCount, 3)

    const write = background(registerVisitor(sql, 'during-rebuild'))
    await waitUntil(async () => (await lockWaiters('relation')) === 1, 'the writer to queue behind the rebuild')
    const [read] = await sql`select public.get_guestbook_page(5, null) as page`
    assertEquals(read.page.status, 'ok', 'reads are not blocked while the rebuild holds its lock')

    await rebuilder`commit`
    await write
  } finally {
    await release(rebuilder)
  }
  const { stored, actual } = await totals()
  assertEquals(actual.visitorCount, 4)
  assertEquals(stored, actual, 'the late writer added its delta to the rebuilt row')
})

integrationTest('the rebuild refuses to run under REPEATABLE READ or SERIALIZABLE', async () => {
  for (const level of ['repeatable read', 'serializable']) {
    const connection = await sql.reserve()
    try {
      await connection.unsafe(`begin isolation level ${level}`)
      assertEquals(await sqlstateOf(connection`select private.rebuild_site_stats()`), '25000', level)
    } finally {
      await release(connection)
    }
  }
})

integrationTest('a rebuild that cannot get its lock within 5 seconds fails cleanly', async () => {
  await resetData()
  const writer = await sql.reserve()
  try {
    await writer`begin`
    await registerVisitor(writer, 'slow-writer')
    const started = Date.now()
    assertEquals(await sqlstateOf(sql`select private.rebuild_site_stats()`), '55P03')
    const waited = Date.now() - started
    assert(waited >= 4_500 && waited < 9_000, `waited ${waited} ms`)
    await writer`commit`
  } finally {
    await release(writer)
  }
  const [{ result }] = await sql`select private.rebuild_site_stats() as result`
  assertEquals(result.before, result.after)
  await assertConsistent()
})

/** Small deterministic PRNG, so a failing interleaving can be reproduced from its seed. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

integrationTest('concurrent writes, moderation deletes, and rebuilds never let the totals drift', async () => {
  await resetData()
  const seed = 20261029
  const rebuilds: Array<{ before: unknown; after: unknown }> = []
  const failures: string[] = []
  let writing = true

  const rebuildLoop = (async () => {
    while (writing) {
      try {
        const [{ result }] = await sql`select private.rebuild_site_stats() as result`
        rebuilds.push(result)
      } catch (error) {
        failures.push(`rebuild: ${(error as { code?: string }).code ?? (error as Error).message}`)
      }
    }
  })()

  async function writer(id: number): Promise<void> {
    const random = mulberry32(seed + id)
    const sessions: Array<{ tokenHash: string; knocks: number; awards: string[] }> = []
    for (let step = 0; step < 30; step += 1) {
      const roll = random()
      const session = sessions[Math.floor(random() * sessions.length)]
      try {
        if (!session || roll < 0.25) {
          sessions.push({ tokenHash: await registerVisitor(sql, `w${id}-${step}`), knocks: 0, awards: [] })
        } else if (roll < 0.5) {
          session.knocks = Math.min(30, session.knocks + 1 + Math.floor(random() * 3))
          await sql`select public.record_knocks(${session.tokenHash}, ${session.knocks})`
        } else if (roll < 0.75) {
          const awardId = crypto.randomUUID()
          await sql`
            select public.record_prize_award(
              ${session.tokenHash}, ${awardId}::uuid, 'trophy', 'trophy', 'champion', 'Balboa Park', null)`
          session.awards.push(awardId)
        } else if (roll < 0.9 && session.awards.length > 0) {
          await sql`delete from public.prize_awards where id = ${session.awards.pop()!}::uuid`
        } else if (session.awards.length === 0) {
          await sql`
            delete from public.visitor_sessions s
             using private.session_credentials c
             where c.session_id = s.id and c.token_hash = decode(${session.tokenHash}, 'hex')`
          sessions.splice(sessions.indexOf(session), 1)
        }
      } catch (error) {
        failures.push(`writer ${id} step ${step}: ${(error as { code?: string }).code ?? (error as Error).message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: 8 }, (_, id) => writer(id)))
  writing = false
  await rebuildLoop

  assertEquals(failures, [], 'no deadlocks, lock timeouts, or other errors')
  assert(rebuilds.length >= 3, `only ${rebuilds.length} rebuilds overlapped the writers`)
  for (const rebuild of rebuilds) assertEquals(rebuild.before, rebuild.after, 'every rebuild found zero drift')
  const { stored, actual } = await totals()
  assert(actual.visitorCount > 0 && actual.giftsGiven > 0 && actual.doorKnocks > 0, 'the writers did write')
  assertEquals(stored, actual)
})
