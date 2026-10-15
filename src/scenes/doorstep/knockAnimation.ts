import gsap from 'gsap'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Short knock reaction on the door button.
 * Replace or extend this later with filmed / illustrated animation.
 */
export function playKnockAnimation(door: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    if (prefersReducedMotion()) {
      door.classList.add('doorstep__door--knocking')
      gsap.delayedCall(0.15, () => {
        door.classList.remove('doorstep__door--knocking')
        resolve()
      })
      return
    }

    door.classList.add('doorstep__door--knocking')

    const tl = gsap.timeline({
      onComplete: () => {
        door.classList.remove('doorstep__door--knocking')
        gsap.set(door, { clearProps: 'transform,opacity' })
        resolve()
      },
    })

    tl.to(door, {
      scale: 0.985,
      duration: 0.08,
      ease: 'power1.in',
    })
      .to(door, {
        scale: 1.01,
        duration: 0.1,
        ease: 'power1.out',
      })
      .to(door, {
        scale: 1,
        duration: 0.12,
        ease: 'power1.out',
      })
      .to({}, { duration: 0.25 })
  })
}
