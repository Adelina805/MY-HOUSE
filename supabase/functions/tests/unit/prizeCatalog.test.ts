import { assert, assertEquals } from '@std/assert'
import { PRIZES } from '../../../../src/data/prizes.ts'
import { PRIZE_CATALOG } from '../../_shared/prizeCatalog.generated.ts'
import { resolveAward } from '../../_shared/prizeCatalog.ts'

/** Original Stage A catalog IDs that must remain valid after expansion. */
const ORIGINAL_60_IDS = [
  'apple',
  'assorted-pebbles',
  'avocado',
  'bagged-goldfish',
  'beach-bucket-and-shovel',
  'bonita-dinosaur-named-rangui',
  'bonita-dinosaur-named-rumbi',
  'bottle-cap',
  'broken-pencil',
  'california-burrito',
  'cocktail-umbrella',
  'cool-ranch-doritos',
  'crab',
  'crumpled-receipt',
  'dollar-bills',
  'flip-flop',
  'french-fry',
  'googly-eye',
  'googly-eyed-rock',
  'house-key',
  'ikes-sandwich',
  'japanese-nautical-glass-orb',
  'killer-fish-from-san-diego',
  'lemon',
  'lifeguard-buoy',
  'magic-eight-ball',
  'metal-slinky',
  'orange',
  'padres-cap',
  'paperclip',
  'parking-ticket',
  'peanut-butter-jelly-sandwich',
  'pink-eraser',
  'pronto-card',
  'rainbow-slinky',
  'rubber-duck',
  'rusty-nail',
  'san-diego-parrot',
  'sand-dollar',
  'sea-monster-toy',
  'seagull',
  'seashell',
  'shark-egg',
  'smooth-rock',
  'sour-patch-kids',
  'sour-skittles',
  'spare-change',
  'starfish',
  'stop-sign',
  'striped-rock',
  'strong-current-warning-sign',
  'surfboard-fin',
  'surfing-santa',
  'tacos',
  'tortilla-chip',
  'toy-dinosaur',
  'traffic-cone',
  'trophy',
  'usb-flash-drive',
  'volleyball',
] as const

Deno.test('frontend and server catalogs each contain exactly 100 prizes', () => {
  assertEquals(PRIZES.length, 100)
  assertEquals(PRIZE_CATALOG.length, 100)
})

Deno.test('the generated catalog matches src/data/prizes.ts (run `npm run catalog:generate` if this fails)', () => {
  for (const prize of PRIZES) {
    assertEquals(prize.adjectives.length, new Set(prize.adjectives).size, `${prize.id} has duplicate adjectives`)
    assertEquals(prize.locations.length, new Set(prize.locations).size, `${prize.id} has duplicate locations`)
  }
  const expected = PRIZES.map((prize) => ({
    id: prize.id,
    objectName: prize.name,
    adjectives: [...new Set(prize.adjectives)],
    locations: [...new Set(prize.locations)],
  }))
  assertEquals(PRIZE_CATALOG, expected)
})

Deno.test('every catalog prize has an image and fits the database limits', async () => {
  const ids = new Set<string>()
  for (const prize of PRIZE_CATALOG) {
    assert(!ids.has(prize.id), `duplicate id ${prize.id}`)
    ids.add(prize.id)
    assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(prize.id) && prize.id.length <= 64, prize.id)
    const image = await Deno.stat(new URL(`../../../../public/media/prizes/${prize.id}.webp`, import.meta.url))
    assert(image.isFile, `missing image for ${prize.id}`)
    assert(prize.objectName.trim().length > 0)
    assert([...prize.objectName].length <= 80)
    assert(prize.adjectives.length > 0 && prize.adjectives.every((a) => [...a].length <= 40))
    assert(prize.locations.length > 0 && prize.locations.every((l) => [...l].length <= 80))
    assertEquals(prize.adjectives.length, new Set(prize.adjectives).size, `${prize.id} has duplicate adjectives`)
    assertEquals(prize.locations.length, new Set(prize.locations).size, `${prize.id} has duplicate locations`)
  }
})

Deno.test('the original 60 prize IDs remain in both catalogs', () => {
  const frontendIds = new Set(PRIZES.map((prize) => prize.id))
  const serverIds = new Set(PRIZE_CATALOG.map((prize) => prize.id))
  assertEquals(ORIGINAL_60_IDS.length, 60)
  for (const id of ORIGINAL_60_IDS) {
    assert(frontendIds.has(id), `missing from frontend: ${id}`)
    assert(serverIds.has(id), `missing from server: ${id}`)
  }
})

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

Deno.test('resolveAward accepts every frontend prize, adjective, and location combination', () => {
  const combinations = frontendCombinations()
  assertEquals(combinations.length, 2620)
  for (const award of combinations) {
    assertEquals(resolveAward(award.prizeId, award.adjective, award.location), award)
  }
})

Deno.test('the production koala newspaper vintage SDSU combination is accepted', () => {
  const frontend = PRIZES.find((prize) => prize.id === 'the-koala-newspaper')
  const server = PRIZE_CATALOG.find((prize) => prize.id === 'the-koala-newspaper')
  assert(frontend)
  assert(server)
  assertEquals(frontend.name, 'The Koala newspaper')
  assertEquals(server.objectName, 'The Koala newspaper')
  assert(frontend.adjectives.includes('vintage'))
  assert(frontend.locations.includes('SDSU'))
  assert(server.adjectives.includes('vintage'))
  assert(server.locations.includes('SDSU'))
  assertEquals(resolveAward('the-koala-newspaper', 'vintage', 'SDSU'), {
    prizeId: 'the-koala-newspaper',
    objectName: 'The Koala newspaper',
    adjective: 'vintage',
    location: 'SDSU',
  })
})

Deno.test('resolveAward accepts exact catalog combinations and derives the object name', () => {
  assertEquals(resolveAward('usb-flash-drive', 'unlabeled', 'Hillcrest'), {
    prizeId: 'usb-flash-drive',
    objectName: 'USB flash drive',
    adjective: 'unlabeled',
    location: 'Hillcrest',
  })
  assertEquals(resolveAward('avocado', 'perfectly ripe', "Ike's Place")?.objectName, 'avocado')
})

Deno.test('resolveAward accepts newly added prizes', () => {
  assertEquals(resolveAward('ikea-pencil', 'suspicious', 'Mission Valley'), {
    prizeId: 'ikea-pencil',
    objectName: 'IKEA pencil',
    adjective: 'suspicious',
    location: 'Mission Valley',
  })
  assertEquals(resolveAward('uss-midway-aircraft-carrier', 'historic', 'Embarcadero'), {
    prizeId: 'uss-midway-aircraft-carrier',
    objectName: 'USS Midway',
    adjective: 'historic',
    location: 'Embarcadero',
  })
  assertEquals(resolveAward('padres-baseball', 'powerful', 'East Village'), {
    prizeId: 'padres-baseball',
    objectName: 'Padres baseball',
    adjective: 'powerful',
    location: 'East Village',
  })
})

Deno.test('resolveAward rejects anything outside the catalog', () => {
  assertEquals(resolveAward('trophy', 'Champion', 'Balboa Park'), null, 'matching is case-sensitive')
  assertEquals(resolveAward('trophy', 'champion', 'balboa park'), null)
  assertEquals(resolveAward('trophy', 'sandy', 'Balboa Park'), null, "another prize's adjective")
  assertEquals(resolveAward('trophy', 'champion', 'Ocean Beach'), null, "another prize's location")
  assertEquals(resolveAward('the-koala-newspaper', 'vintage', 'Bonita'), null, "another prize's location")
  assertEquals(resolveAward('the-koala-newspaper', 'legendary', 'SDSU'), null, "another prize's adjective")
  assertEquals(resolveAward('fallback-mystery', 'mysterious', 'somewhere nearby'), null)
  assertEquals(resolveAward('__proto__', 'champion', 'Balboa Park'), null)
  assertEquals(resolveAward('constructor', 'champion', 'Balboa Park'), null)
  assertEquals(resolveAward('trophy ', 'champion', 'Balboa Park'), null)
})

Deno.test('the corrected prize id resolves and the old misspelling does not', () => {
  const corrected = PRIZE_CATALOG.find((prize) => prize.id === 'japanese-nautical-glass-orb')
  assert(corrected)
  assert(resolveAward(corrected.id, corrected.adjectives[0], corrected.locations[0]))
  assertEquals(resolveAward('japanese-naurical-glass-orb', corrected.adjectives[0], corrected.locations[0]), null)
})
