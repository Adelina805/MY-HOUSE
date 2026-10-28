import { PRIZES, type PrizeDefinition } from '../data/prizes'

/** Locked result for the current visit — available through goodbye. */
export interface SelectedPrize {
  id: string
  objectName: string
  adjective: string
  location: string
  fullName: string
  imagePath: string
}

/** @deprecated Use SelectedPrize — kept as an alias for gradual call-site clarity. */
export type Prize = SelectedPrize

const FALLBACK_PRIZE: SelectedPrize = {
  id: 'fallback-mystery',
  objectName: 'mystery prize',
  adjective: 'mysterious',
  location: 'somewhere nearby',
  fullName: 'A mysterious mystery prize from somewhere nearby',
  imagePath: '',
}

let sessionPrize: SelectedPrize | null = null

/** Bowl subset chosen when the candy scene approaches (décor only). */
let pendingBowlPrizes: PrizeDefinition[] | null = null

function pickOne<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.floor(Math.random() * items.length)]
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

function buildSelectedPrize(def: PrizeDefinition): SelectedPrize {
  const adjective = pickOne(def.adjectives) ?? 'curious'
  const location = pickOne(def.locations) ?? 'San Diego'
  return {
    id: def.id,
    objectName: def.name,
    adjective,
    location,
    fullName: `A ${adjective} ${def.name} from ${location}`,
    imagePath: def.image,
  }
}

export function getAllPrizes(): readonly PrizeDefinition[] {
  return PRIZES
}

export function getSessionPrize(): SelectedPrize | null {
  return sessionPrize
}

export function setSessionPrize(prize: SelectedPrize): void {
  sessionPrize = prize
}

export function clearSessionPrize(): void {
  sessionPrize = null
}

export function fallbackPrize(): SelectedPrize {
  return { ...FALLBACK_PRIZE }
}

/** Shuffle and return unique prizes for bowl décor (up to `count`, typically the full catalog). */
export function pickRandomBowlPrizes(count: number): PrizeDefinition[] {
  const n = Math.max(0, Math.min(count, PRIZES.length))
  return shuffleInPlace([...PRIZES]).slice(0, n)
}

/**
 * Prepare the bowl set early so preload can decode images during greeting.
 * Safe to call multiple times — keeps the first pick until cleared.
 */
export function prepareBowlPrizeSubset(count: number): PrizeDefinition[] {
  if (pendingBowlPrizes && pendingBowlPrizes.length > 0) {
    return pendingBowlPrizes
  }
  pendingBowlPrizes = pickRandomBowlPrizes(count)
  return pendingBowlPrizes
}

export function takeBowlPrizeSubset(count: number): PrizeDefinition[] {
  const subset = prepareBowlPrizeSubset(count)
  pendingBowlPrizes = null
  return subset
}

export function clearPendingBowlPrizes(): void {
  pendingBowlPrizes = null
}

/** Pick from the full catalog and lock adjective/location for this visit. */
export function selectRandomPrize(): SelectedPrize {
  const def = pickOne(PRIZES)
  if (!def) return fallbackPrize()
  return buildSelectedPrize(def)
}

export function ensureSessionPrize(): SelectedPrize {
  const existing = getSessionPrize()
  if (existing) return existing
  const prize = selectRandomPrize()
  setSessionPrize(prize)
  return prize
}
