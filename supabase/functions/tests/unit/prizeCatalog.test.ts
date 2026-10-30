import { assert, assertEquals } from '@std/assert'
import { PRIZES } from '../../../../src/data/prizes.ts'
import { PRIZE_CATALOG } from '../../_shared/prizeCatalog.generated.ts'
import { resolveAward } from '../../_shared/prizeCatalog.ts'

Deno.test('the generated catalog matches src/data/prizes.ts (run `npm run catalog:generate` if this fails)', () => {
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
    assert([...prize.objectName].length <= 80)
    assert(prize.adjectives.length > 0 && prize.adjectives.every((a) => [...a].length <= 40))
    assert(prize.locations.length > 0 && prize.locations.every((l) => [...l].length <= 80))
  }
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

Deno.test('resolveAward rejects anything outside the catalog', () => {
  assertEquals(resolveAward('trophy', 'Champion', 'Balboa Park'), null, 'matching is case-sensitive')
  assertEquals(resolveAward('trophy', 'champion', 'balboa park'), null)
  assertEquals(resolveAward('trophy', 'sandy', 'Balboa Park'), null, "another prize's adjective")
  assertEquals(resolveAward('trophy', 'champion', 'Ocean Beach'), null, "another prize's location")
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
