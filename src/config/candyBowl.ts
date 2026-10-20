/** Tune candy bowl plunge, hand tracking, and placeholder object reactions. */
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
    /** Ellipse clamp for cursor midpoint (fraction of bowl hit area). */
    boundary: {
      radiusX: 0.52,
      radiusY: 0.48,
    },
  },
  objects: {
    count: 18,
    sizeMinPx: 88,
    sizeMaxPx: 156,
    blueHueMin: 205,
    blueHueMax: 230,
    blueSatMin: 45,
    blueSatMax: 70,
    blueLightMin: 35,
    blueLightMax: 65,
    /** Push radius as fraction of bowl width. */
    interactionRadius: 0.22,
    pushStrength: 1.15,
    rotationStrength: 0.9,
    bounceAmount: 0.35,
    settleDuration: 0.55,
    settleEase: 'power2.out',
    maxVelocity: 14,
  },
} as const
