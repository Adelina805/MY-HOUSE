// Parallel requests through the full HTTP chain.
import { assert, assertEquals } from '@std/assert'
import { award, knock, register, resume } from './_api.ts'
import { ageSessionStart, integrationTest, resetData, sql, totals } from './_db.ts'

integrationTest('15 parallel registrations get unique visitor numbers and count exactly 15', async () => {
  await resetData()
  const results = await Promise.all(Array.from({ length: 15 }, () => register()))
  assert(results.every((r) => r.status === 201))
  assertEquals(new Set(results.map((r) => r.json.visitor.visitorNumber)).size, 15)
  const { stored, actual } = await totals()
  assertEquals(stored.visitorCount, 15)
  assertEquals(stored, actual)
})

integrationTest('parallel knock reports for one session land on the highest total', async () => {
  await resetData()
  const { json } = await register()
  await ageSessionStart(json.sessionToken, 200)
  const reports = [5, 12, 7, 20, 3, 15, 20, 9]
  const results = await Promise.all(reports.map((total) => knock(json.sessionToken, total)))
  assert(results.every((r) => r.status === 200))
  assertEquals(results.reduce((sum, r) => sum + r.json.accepted, 0), 20, 'every knock is counted once')
  assertEquals((await resume(json.sessionToken)).json.visitor.knockCount, 20)
  const { stored, actual } = await totals()
  assertEquals(stored.doorKnocks, 20)
  assertEquals(stored, actual)
})

integrationTest('five identical award requests record one gift', async () => {
  await resetData()
  const { json } = await register()
  const awardId = crypto.randomUUID()
  const results = await Promise.all(Array.from({ length: 5 }, () => award(json.sessionToken, awardId)))
  assertEquals(results.filter((r) => r.status === 201).length, 1)
  assertEquals(results.filter((r) => r.status === 200 && r.json.duplicate).length, 4)
  assertEquals(new Set(results.map((r) => JSON.stringify(r.json.award))).size, 1)
  const { stored, actual } = await totals()
  assertEquals(stored.giftsGiven, 1)
  assertEquals(stored, actual)
})

integrationTest('one session hammered with knocks, awards, and resumes during repeated rebuilds stays consistent', async () => {
  await resetData()
  const { json } = await register()
  const token: string = json.sessionToken
  await ageSessionStart(token, 1_000)

  const rebuilds: Array<{ before: unknown; after: unknown }> = []
  const rebuildErrors: string[] = []
  let hammering = true
  const rebuildLoop = (async () => {
    while (hammering) {
      try {
        const [{ result }] = await sql`select private.rebuild_site_stats() as result`
        rebuilds.push(result)
      } catch (error) {
        rebuildErrors.push((error as { code?: string }).code ?? (error as Error).message)
      }
    }
  })()

  const statuses: number[] = []
  for (let batch = 0; batch < 4; batch += 1) {
    const requests = Array.from({ length: 15 }, (_, i) => {
      const n = batch * 15 + i
      if (n % 3 === 0) return knock(token, n)
      if (n % 3 === 1) return award(token)
      return resume(token)
    })
    for (const result of await Promise.all(requests)) statuses.push(result.status)
  }
  hammering = false
  await rebuildLoop

  assertEquals(statuses.filter((status) => status >= 500), [], 'no server errors')
  assert(statuses.every((status) => status === 200 || status === 201), `statuses: ${statuses.join(',')}`)
  assertEquals(rebuildErrors, [])
  assert(rebuilds.length > 0)
  for (const rebuild of rebuilds) assertEquals(rebuild.before, rebuild.after)
  const { stored, actual } = await totals()
  assertEquals(stored.giftsGiven, 20)
  assertEquals(stored.doorKnocks, 57)
  assertEquals(stored, actual)
})
