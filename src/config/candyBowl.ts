/**
 * Tune candy bowl plunge, hand tracking, and prize object reactions.
 *
 * Bowl “in bounds” for candies = ellipse `hands.boundary` inside the objects layer
 * (`--candy-objects-width/height` on `#app`). Dev: `?startAt=candy&bowlDebug=1`
 * and the live panel (see src/core/candyBowlDebug.ts).
 */
export const candyBowlConfig = {
  plunge: {
    duration: 0.45,
    /** Extra inward pull toward bowl center (px in overlay space). */
    inwardPull: 0.92,
    scale: 1.06,
    scaleSettle: 1,
    ease: 'power3.inOut',
    bounceDuration: 0.1,
    bounceEase: 'power2.out',
    /** Brief overshoot scale on impact. */
    impactScale: 1.04,
  },
  hands: {
    /** Horizontal fingertip half-gap as a fraction of current hand width. */
    separationHandWidthScale: 0.26,
    separationMinPx: 56,
    /** Vertical offset scales with hand height; plus a small fixed nudge. */
    separationHeightScale: 0.1,
    separationYOffsetPx: 4,
    /** Fraction of hand image box for fingertip alignment (like knock knuckle). */
    fingertip: {
      left: { x: 0.62, y: 0.22 },
      right: { x: 0.38, y: 0.22 },
    },
    /** GSAP quickTo duration — lower = snappier cursor follow. */
    trackingDuration: 0.035,
    trackingEase: 'power3.out',
    /** Slight independent rotation wobble from horizontal hand speed. */
    rotationFromSpeed: 0.35,
    maxRotationWobble: 6,
    /** Ellipse that keeps scattered objects inside the bowl (fraction of the objects area). */
    boundary: {
      radiusX: 0.48,
      radiusY: 0.39,
    },
  },
  objects: {
    /** Show every catalog prize in the bowl (capped by catalog length at spawn). */
    count: 60,
    /** Fraction of objects drawn in front of the hands (rest stay behind). */
    frontLayerChance: 0.5,
    /** Uniform box size for every prize image (assets are pre-cropped equally). */
    sizePx: 72,
    /** Push radius as fraction of bowl width. */
    interactionRadius: 0.22,
    pushStrength: 1.15,
    rotationStrength: 0.9,
    bounceAmount: 0.35,
    settleDuration: 0.55,
    settleEase: 'power2.out',
    maxVelocity: 14,
  },
  /** Prize grab + cupped-hands reveal (GSAP). */
  reveal: {
    /** Seconds in rummaging before a grab can register. */
    minRummageBeforeGrabSec: 3,
    /** Converge rummaging hands + transition to cupped image. */
    grabDuration: 0.52,
    scatterDuration: 0.38,
    cuppedFadeIn: 0.28,
    cuppedRisePx: 14,
    prizePopDuration: 0.34,
    prizePopScale: 1.08,
    grabEase: 'power2.inOut',
    prizePopEase: 'power2.out',
    /** Pause on the candy scene with cupped hands before crossfading to goodbye. */
    holdBeforeGoodbyeMs: 700,
  },
} as const
