/** Scene transition between door and candy (crossfade). */
export const transitions = {
  toCandyDuration: 0.72,
  toDoorDuration: 0.72,
  ease: 'power2.inOut',
  /** Time on the candy bowl scene before auto goodbye (item grab comes later). */
  candyAutoGoodbyeDelayMs: 7000,
} as const
