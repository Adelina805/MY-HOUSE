import { assert, assertEquals } from '@std/assert'
import { getAllPrizes, selectRandomPrize } from '../../../src/config/prizeCatalog.ts'
import { PRIZES } from '../../../src/data/prizes.ts'
import { PRIZE_CATALOG } from '../../../supabase/functions/_shared/prizeCatalog.generated.ts'
import { resolveAward } from '../../../supabase/functions/_shared/prizeCatalog.ts'

const KOALA_ID = 'the-koala-newspaper'
const KOALA_AWARD = {
  prizeId: KOALA_ID,
  objectName: 'The Koala newspaper',
  adjective: 'vintage',
  location: 'SDSU',
} as const

function frontendCombinations(): Array<{
  prizeId: string
  objectName: string
  adjective: string
  location: string
}> {
  return PRIZES.flatMap((prize) =>
    [...new Set(prize.adjectives)].flatMap((adjective) =>
      [...new Set(prize.locations)].map((location) => ({
        prizeId: prize.id,
        objectName: prize.name,
        adjective,
        location,
      })),
    ),
  )
}

Deno.test('the frontend catalog used by the prize generator matches the server catalog', () => {
  assertEquals(PRIZES.length, 100)
  assertEquals(PRIZE_CATALOG.length, 100)
  assertEquals(getAllPrizes(), PRIZES)
  assertEquals(
    PRIZE_CATALOG,
    PRIZES.map((prize) => ({
      id: prize.id,
      objectName: prize.name,
      adjectives: [...new Set(prize.adjectives)],
      locations: [...new Set(prize.locations)],
    })),
  )
})

Deno.test('every frontend prize combination is accepted by the server validator', () => {
  const combinations = frontendCombinations()
  assertEquals(combinations.length, 2620)
  for (const award of combinations) {
    assertEquals(resolveAward(award.prizeId, award.adjective, award.location), award)
  }
})

Deno.test('the koala newspaper vintage SDSU award is a valid frontend combination', () => {
  const prize = PRIZES.find((entry) => entry.id === KOALA_ID)
  assert(prize)
  assertEquals(prize.name, KOALA_AWARD.objectName)
  assert(prize.adjectives.includes(KOALA_AWARD.adjective))
  assert(prize.locations.includes(KOALA_AWARD.location))
  assertEquals(resolveAward(KOALA_ID, KOALA_AWARD.adjective, KOALA_AWARD.location), {
    prizeId: KOALA_AWARD.prizeId,
    objectName: KOALA_AWARD.objectName,
    adjective: KOALA_AWARD.adjective,
    location: KOALA_AWARD.location,
  })
})

Deno.test('selectRandomPrize only emits catalog ids, adjectives, and locations', () => {
  for (let i = 0; i < 200; i += 1) {
    const prize = selectRandomPrize()
    const resolved = resolveAward(prize.id, prize.adjective, prize.location)
    assert(resolved, `${prize.id} / ${prize.adjective} / ${prize.location}`)
    assertEquals(resolved.objectName, prize.objectName)
  }
})
