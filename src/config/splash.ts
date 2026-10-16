/**
 * Title card shown once on a full page load, then faded into the door.
 * In-app restart does not replay this intro.
 */
export const splash = {
  /** Time the title stays fully opaque after the door scene is ready. */
  holdDuration: 2,
  /** Opacity fade into the doorway. */
  fadeDuration: 2,
  ease: 'power1.inOut',
} as const
