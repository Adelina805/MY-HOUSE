import { candyBowlConfig } from './candyBowl'

/** Production defaults — wide rectangle + inset ellipse (bowl opening). */
export const bowlLayoutDefaults = {
  radiusX: candyBowlConfig.hands.boundary.radiusX,
  radiusY: candyBowlConfig.hands.boundary.radiusY,
  objectsWidth: 'min(82vw, 960px)',
  objectsHeight: 'min(47vw, 520px)',
  hitWidth: 'min(67vw, 920px)',
  hitHeight: 'min(39vw, 480px)',
  centerY: '48%',
} as const

export type BowlLayoutTuning = {
  radiusX: number
  radiusY: number
  objectsWidth: string
  objectsHeight: string
  hitWidth: string
  hitHeight: string
  centerY: string
}

const STORAGE_PREFIX = 'my-house:bowlLayout:'

export const bowlLayoutStorageKeys = {
  radiusX: `${STORAGE_PREFIX}radiusX`,
  radiusY: `${STORAGE_PREFIX}radiusY`,
  objectsWidth: `${STORAGE_PREFIX}objectsWidth`,
  objectsHeight: `${STORAGE_PREFIX}objectsHeight`,
  hitWidth: `${STORAGE_PREFIX}hitWidth`,
  hitHeight: `${STORAGE_PREFIX}hitHeight`,
  centerY: `${STORAGE_PREFIX}centerY`,
} as const

function readStoredString(key: string): string | null {
  if (!import.meta.env.DEV) return null
  try {
    const v = localStorage.getItem(key)
    return v !== null && v !== '' ? v : null
  } catch {
    return null
  }
}

function readStoredNumber(key: string): number | null {
  const raw = readStoredString(key)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function readBowlLayoutTuning(): BowlLayoutTuning {
  return {
    radiusX:
      readStoredNumber(bowlLayoutStorageKeys.radiusX) ?? bowlLayoutDefaults.radiusX,
    radiusY:
      readStoredNumber(bowlLayoutStorageKeys.radiusY) ?? bowlLayoutDefaults.radiusY,
    objectsWidth:
      readStoredString(bowlLayoutStorageKeys.objectsWidth) ??
      bowlLayoutDefaults.objectsWidth,
    objectsHeight:
      readStoredString(bowlLayoutStorageKeys.objectsHeight) ??
      bowlLayoutDefaults.objectsHeight,
    hitWidth:
      readStoredString(bowlLayoutStorageKeys.hitWidth) ??
      bowlLayoutDefaults.hitWidth,
    hitHeight:
      readStoredString(bowlLayoutStorageKeys.hitHeight) ??
      bowlLayoutDefaults.hitHeight,
    centerY:
      readStoredString(bowlLayoutStorageKeys.centerY) ?? bowlLayoutDefaults.centerY,
  }
}

export function writeBowlLayoutTuning(partial: Partial<BowlLayoutTuning>): void {
  if (!import.meta.env.DEV) return
  const map: [keyof BowlLayoutTuning, string][] = [
    ['radiusX', bowlLayoutStorageKeys.radiusX],
    ['radiusY', bowlLayoutStorageKeys.radiusY],
    ['objectsWidth', bowlLayoutStorageKeys.objectsWidth],
    ['objectsHeight', bowlLayoutStorageKeys.objectsHeight],
    ['hitWidth', bowlLayoutStorageKeys.hitWidth],
    ['hitHeight', bowlLayoutStorageKeys.hitHeight],
    ['centerY', bowlLayoutStorageKeys.centerY],
  ]
  try {
    for (const [field, storageKey] of map) {
      const value = partial[field]
      if (value === undefined) continue
      localStorage.setItem(storageKey, String(value))
    }
  } catch {
    /* ignore */
  }
}

export function clearBowlLayoutTuning(): void {
  if (!import.meta.env.DEV) return
  try {
    for (const key of Object.values(bowlLayoutStorageKeys)) {
      localStorage.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

export function applyBowlLayoutToApp(appEl: HTMLElement): BowlLayoutTuning {
  const layout = readBowlLayoutTuning()
  appEl.style.setProperty('--bowl-debug-rx', String(layout.radiusX))
  appEl.style.setProperty('--bowl-debug-ry', String(layout.radiusY))
  appEl.style.setProperty('--candy-objects-width', layout.objectsWidth)
  appEl.style.setProperty('--candy-objects-height', layout.objectsHeight)
  appEl.style.setProperty('--candy-bowl-hit-width', layout.hitWidth)
  appEl.style.setProperty('--candy-bowl-hit-height', layout.hitHeight)
  appEl.style.setProperty('--candy-objects-center-y', layout.centerY)
  return layout
}

export function isDevStartAtCandy(): boolean {
  if (!import.meta.env.DEV) return false
  return new URLSearchParams(window.location.search).get('startAt') === 'candy'
}
