/**
 * Camera transition between door and candy environments.
 * Tune translateY (vh) and duration for the tilt up/down feel.
 */
export const transitions = {
  toCandyDuration: 0.85,
  toDoorDuration: 0.85,
  /**
   * Camera rig shift as % of .experience__camera height (200% of viewport).
   * 50 moves exactly one viewport down to the candy layer.
   */
  toCandyTranslatePercent: 50,
  ease: 'power2.inOut',
} as const
