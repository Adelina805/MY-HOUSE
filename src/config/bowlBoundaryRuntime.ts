import { readBowlLayoutTuning } from './bowlLayout'
import { candyBowlConfig } from './candyBowl'

const BOWL_DEBUG_STORAGE_KEY = 'my-house:bowlDebug'

function searchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

/** Dev-only: `?bowlDebug=1` or `localStorage.setItem('my-house:bowlDebug', '1')`. */
export function isBowlDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  const params = searchParams()
  if (params.has('bowlDebug')) {
    return params.get('bowlDebug') !== '0'
  }
  try {
    return localStorage.getItem(BOWL_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const MOBILE_MAX_WIDTH = 480

function defaultBoundaryRadii(): { radiusX: number; radiusY: number } {
  const isMobile =
    typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH
  return isMobile
    ? candyBowlConfig.hands.boundaryMobile
    : candyBowlConfig.hands.boundary
}

/**
 * Ellipse radii in normalized object-layer space (0–1, center 0.5).
 * Override at runtime with `?bowlRx=0.5&bowlRy=0.48` while debugging.
 */
export function getBowlBoundaryRadii(): { radiusX: number; radiusY: number } {
  const defaults = defaultBoundaryRadii()
  if (!import.meta.env.DEV) {
    return { radiusX: defaults.radiusX, radiusY: defaults.radiusY }
  }
  const params = searchParams()
  const rx = params.get('bowlRx')
  const ry = params.get('bowlRy')
  const stored = readBowlLayoutTuning()
  return {
    radiusX:
      rx !== null && rx !== ''
        ? Number(rx)
        : stored.radiusX ?? defaults.radiusX,
    radiusY:
      ry !== null && ry !== ''
        ? Number(ry)
        : stored.radiusY ?? defaults.radiusY,
  }
}
