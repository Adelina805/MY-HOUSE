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
    /** Horizontal spread as a fraction of hand image width (each side). */
    separationHandWidthScale: 0.2,
    separationMinPx: 72,
    separationYOffset: 14,
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
    count: 20,
    sizeMinPx: 14,
    sizeMaxPx: 34,
    shadeMin: 0.35,
    shadeMax: 0.72,
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
