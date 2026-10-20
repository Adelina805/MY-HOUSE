import gsap from 'gsap'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Subtle door-panel feedback when the fist contacts the door. */
export function playDoorPanelKnockFeedback(target: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    if (prefersReducedMotion()) {
      gsap.delayedCall(0.12, resolve)
      return
    }

    gsap.killTweensOf(target)

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(target, { clearProps: 'transform' })
        resolve()
      },
    })

    tl.to(target, { scale: 0.992, duration: 0.08, ease: 'power1.in' })
      .to(target, { scale: 1.006, duration: 0.1, ease: 'power1.out' })
      .to(target, { scale: 1, duration: 0.1, ease: 'power1.out' })
  })
}
