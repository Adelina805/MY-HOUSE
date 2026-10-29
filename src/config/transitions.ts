/** Scene transition between door and candy (crossfade). */
export const transitions = {
  toCandyDuration: 0.72,
  toDoorDuration: 0.72,
  ease: 'power2.inOut',
  /** Time on the candy bowl scene before auto goodbye (item grab comes later). */
  candyAutoGoodbyeDelayMs: 7000,
  /** After goodbye video ends, return cupped hands to idle pose if the visitor has not tapped. */
  cuppedDismissAfterGoodbyeMs: 3000,
  /** Delay after door closes before the guestbook note fades in. */
  guestbookNoteAppearDelayMs: 350,
  /** Closed-note settle / fade-in duration (seconds). */
  guestbookNoteAppearDuration: 0.35,
  /** Small note → expanded paper open duration (seconds). */
  guestbookOpenDuration: 0.55,
  /** Expanded paper → small note close duration (seconds). */
  guestbookCloseDuration: 0.5,
  /** Dim overlay opacity while guestbook is open. */
  guestbookDimOpacity: 0.45,
} as const
