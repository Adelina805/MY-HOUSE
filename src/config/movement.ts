/**
 * Doorstep 2.5D perspective sensitivity.
 *
 * Tune these values to change how much the scene “looks around”:
 * - maxYawDeg / maxPitchDeg: max rotation from pointer (degrees). Keep small.
 * - pointerEaseDuration: how quickly the rig follows the cursor.
 * - returnEaseDuration: how quickly it settles when the pointer leaves.
 * - idleAmplitudeDeg / idleDuration: subtle mobile drift when there is no cursor.
 * - scaleBoost: tiny scale change tied to pointer distance (depth hint).
 */
export const movement = {
  maxYawDeg: 4,
  maxPitchDeg: 2.5,
  pointerEaseDuration: 0.55,
  returnEaseDuration: 0.9,
  idleAmplitudeDeg: 1.2,
  idleDuration: 4.5,
  scaleBoost: 0.012,
  perspectivePx: 1200,
} as const
