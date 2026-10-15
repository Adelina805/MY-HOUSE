import gsap from 'gsap'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function playKnockAnimation(target: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    if (prefersReducedMotion()) {
      target.classList.add('door__knock-target--knocking')
      gsap.delayedCall(0.15, () => {
        target.classList.remove('door__knock-target--knocking')
        resolve()
      })
      return
    }

    target.classList.add('door__knock-target--knocking')

    const tl = gsap.timeline({
      onComplete: () => {
        target.classList.remove('door__knock-target--knocking')
        gsap.set(target, { clearProps: 'transform' })
        resolve()
      },
    })

    tl.to(target, { scale: 0.985, duration: 0.08, ease: 'power1.in' })
      .to(target, { scale: 1.01, duration: 0.1, ease: 'power1.out' })
      .to(target, { scale: 1, duration: 0.12, ease: 'power1.out' })
      .to({}, { duration: 0.25 })
  })
}
