/** Minimal prize data — separate from reveal rendering. */
export interface Prize {
  id: string
  label: string
  /** CSS color for the placeholder prize shape. */
  placeholderColor: string
  shape: 'square' | 'circle'
}

const FALLBACK_PRIZE: Prize = {
  id: 'placeholder-red',
  label: 'Mystery prize',
  placeholderColor: '#e53935',
  shape: 'square',
}

let sessionPrize: Prize | null = null

export function getSessionPrize(): Prize | null {
  return sessionPrize
}

export function setSessionPrize(prize: Prize): void {
  sessionPrize = prize
}

export function clearSessionPrize(): void {
  sessionPrize = null
}

export function prizeFromBowlObjectStyle(
  backgroundColor: string,
  shape: 'square' | 'circle',
  index: number,
): Prize {
  return {
    id: `bowl-object-${index}`,
    label: 'Found treasure',
    placeholderColor: backgroundColor,
    shape,
  }
}

export function fallbackPrize(): Prize {
  return { ...FALLBACK_PRIZE }
}
