import { PRIZE_CATALOG } from './prizeCatalog.generated.ts'

export interface ResolvedAward {
  prizeId: string
  objectName: string
  adjective: string
  location: string
}

interface IndexedPrize {
  objectName: string
  adjectives: ReadonlySet<string>
  locations: ReadonlySet<string>
}

const PRIZES_BY_ID: ReadonlyMap<string, IndexedPrize> = new Map(
  PRIZE_CATALOG.map((prize) => [
    prize.id,
    {
      objectName: prize.objectName,
      adjectives: new Set(prize.adjectives),
      locations: new Set(prize.locations),
    },
  ]),
)

/**
 * Matches a client-reported prize exactly (case-sensitive) against the catalog generated from
 * src/data/prizes.ts. The object name always comes from the catalog, never from the client.
 */
export function resolveAward(prizeId: string, adjective: string, location: string): ResolvedAward | null {
  const prize = PRIZES_BY_ID.get(prizeId)
  if (!prize || !prize.adjectives.has(adjective) || !prize.locations.has(location)) return null
  return { prizeId, objectName: prize.objectName, adjective, location }
}
