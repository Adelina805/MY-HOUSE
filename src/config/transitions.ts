/**
 * Camera transition between door and candy environments.
 * Tune duration, zoom, and translate for the tilt up/down feel.
 */
export const transitions = {
  toCandyDuration: 0.72,
  toDoorDuration: 0.72,
  /**
   * Camera rig shift as % of .experience__camera height (200% of viewport).
   * 50 moves exactly one viewport down to the candy layer.
   */
  toCandyTranslatePercent: 50,
  /** Slight zoom toward the bowl before panning down to candy. */
  toCandyZoom: 1.1,
  toCandyZoomOrigin: '50% 68%',
  toDoorZoom: 1.06,
  toDoorZoomOrigin: '50% 32%',
  ease: 'power2.inOut',
} as const
