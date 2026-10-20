import gsap from 'gsap'
import { assets } from '../config/assets'

/** Tune knock motion durations (seconds). */
export const handsKnockTiming = {
  moveToTarget: 0.18,
  strike: 0.1,
  recoil: 0.12,
  returnIdle: 0.26,
  /** Open-hand idle after the visitor stops knocking. */
  handIdleDelay: 0.3,
  /** Pause after last knock (≥3) before greeting. */
  greetingInactivity: 0.6,
} as const

/**
 * Knuckle position as a fraction of the hand image box (accounts for transparent padding).
 * Tune separately for open vs fist if alignment differs.
 */
export const handsKnockAlignment = {
  fist: { knuckleX: 0.36, knuckleY: 0.26 },
  /** Extra nudge along strike axis (px, screen space; negative = toward top of viewport). */
  strikeOffsetY: -10,
} as const

export interface KnockPoint {
  clientX: number
  clientY: number
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function knuckleClientPoint(
  hand: HTMLElement,
  ratios: { knuckleX: number; knuckleY: number },
): { x: number; y: number } {
  const w = hand.offsetWidth
  const h = hand.offsetHeight
  const rect = hand.getBoundingClientRect()
  if (!w || !h) {
    return {
      x: rect.left + rect.width * ratios.knuckleX,
      y: rect.top + rect.height * ratios.knuckleY,
    }
  }

  const sx = rect.width / w
  const sy = rect.height / h
  return {
    x: rect.left + ratios.knuckleX * w * sx,
    y: rect.top + ratios.knuckleY * h * sy,
  }
}

function loadFistImage(hand: HTMLImageElement): Promise<void> {
  const fist = assets.hands.fist
  if (!fist) return Promise.resolve()
  if (hand.getAttribute('src') === fist && hand.complete) return Promise.resolve()

  return new Promise((resolve) => {
    const done = (): void => {
      hand.removeEventListener('load', done)
      hand.removeEventListener('error', done)
      resolve()
    }
    hand.addEventListener('load', done)
    hand.addEventListener('error', done)
    hand.src = fist
    if (hand.complete) done()
  })
}

export class RightHandKnockController {
  private readonly overlay: HTMLElement
  private readonly hand: HTMLImageElement
  private readonly openSrc = assets.hands.right
  private readonly fistSrc = assets.hands.fist
  private activeTimeline: gsap.core.Timeline | null = null
  private idleReturnTimer: ReturnType<typeof setTimeout> | null = null
  private fistPrimed = false
  private fistLoadPromise: Promise<void> | null = null
  private onHandReturnedToIdle: (() => void) | null = null

  constructor(overlay: HTMLElement, hand: HTMLImageElement) {
    this.overlay = overlay
    this.hand = hand
  }

  setOnHandReturnedToIdle(handler: (() => void) | null): void {
    this.onHandReturnedToIdle = handler
  }

  knock(target: KnockPoint, onStrike: () => void): void {
    this.cancelIdleReturn()
    void this.ensureFist().then(() => {
      this.runKnockSegment(target, onStrike)
    })
  }

  scheduleIdleReturn(): void {
    this.cancelIdleReturn()
    const delayMs = prefersReducedMotion()
      ? 120
      : handsKnockTiming.handIdleDelay * 1000
    this.idleReturnTimer = setTimeout(() => {
      this.idleReturnTimer = null
      void this.returnToOpenHand()
    }, delayMs)
  }

  cancelIdleReturn(): void {
    if (this.idleReturnTimer !== null) {
      clearTimeout(this.idleReturnTimer)
      this.idleReturnTimer = null
    }
  }

  returnToOpenHand(): Promise<void> {
    this.cancelIdleReturn()
    this.killActiveTimeline()

    if (!this.fistPrimed) return Promise.resolve()

    const reduced = prefersReducedMotion()
    const returnDur = reduced ? 0.1 : handsKnockTiming.returnIdle

    return new Promise((resolve) => {
      const currentX = Number(gsap.getProperty(this.hand, 'x')) || 0
      const currentY = Number(gsap.getProperty(this.hand, 'y')) || 0
      if (currentX === 0 && currentY === 0) {
        this.resetHandToCssIdle()
        this.onHandReturnedToIdle?.()
        resolve()
        return
      }

      gsap.to(this.hand, {
        x: 0,
        y: 0,
        scale: 1,
        duration: returnDur,
        ease: 'power2.inOut',
        onComplete: () => {
          this.resetHandToCssIdle()
          this.onHandReturnedToIdle?.()
          resolve()
        },
      })
    })
  }

  dispose(): void {
    this.cancelIdleReturn()
    this.killActiveTimeline()
    this.resetHandToCssIdle()
    this.fistPrimed = false
    this.fistLoadPromise = null
  }

  private ensureFist(): Promise<void> {
    if (!this.fistSrc) return Promise.resolve()
    if (this.fistPrimed && this.hand.getAttribute('src') === this.fistSrc) {
      return Promise.resolve()
    }
    if (!this.fistLoadPromise) {
      this.fistLoadPromise = loadFistImage(this.hand).then(() => {
        this.fistPrimed = true
      })
    }
    return this.fistLoadPromise
  }

  private runKnockSegment(target: KnockPoint, onStrike: () => void): void {
    this.killActiveTimeline()

    const reduced = prefersReducedMotion()
    this.hand.classList.add('hands-overlay__hand--knocking')
    if (this.fistSrc) {
      this.hand.src = this.fistSrc
    }

    const rotation =
      parseFloat(
        getComputedStyle(this.overlay).getPropertyValue('--hands-right-rotate'),
      ) || -16

    if (!gsap.getProperty(this.hand, 'rotation')) {
      gsap.set(this.hand, {
        rotation,
        transformOrigin: `${handsKnockAlignment.fist.knuckleX * 100}% ${handsKnockAlignment.fist.knuckleY * 100}%`,
      })
    }

    const knuckle = knuckleClientPoint(this.hand, handsKnockAlignment.fist)
    let deltaX = target.clientX - knuckle.x
    let deltaY = target.clientY - knuckle.y

    if (reduced) {
      deltaX *= 0.35
      deltaY *= 0.35
    }

    const currentX = Number(gsap.getProperty(this.hand, 'x')) || 0
    const currentY = Number(gsap.getProperty(this.hand, 'y')) || 0
    const targetX = currentX + deltaX
    const targetY = currentY + deltaY

    const moveDur = reduced ? 0.08 : handsKnockTiming.moveToTarget
    const strikeDur = reduced ? 0.05 : handsKnockTiming.strike
    const recoilDur = reduced ? 0.06 : handsKnockTiming.recoil
    const strikePush = reduced ? -4 : handsKnockAlignment.strikeOffsetY

    const tl = gsap.timeline({
      onComplete: () => {
        if (this.activeTimeline === tl) {
          this.activeTimeline = null
        }
      },
    })
    this.activeTimeline = tl

    tl.to(this.hand, {
      x: targetX,
      y: targetY,
      duration: moveDur,
      ease: 'power2.out',
    })
      .to(
        this.hand,
        {
          y: targetY + strikePush,
          scale: reduced ? 1 : 0.97,
          duration: strikeDur,
          ease: 'power1.in',
          onStart: onStrike,
        },
        '>',
      )
      .to(this.hand, {
        y: targetY,
        scale: 1,
        duration: recoilDur,
        ease: 'power1.out',
      })
  }

  private killActiveTimeline(): void {
    if (this.activeTimeline) {
      this.activeTimeline.kill()
      this.activeTimeline = null
    }
    gsap.killTweensOf(this.hand)
  }

  private resetHandToCssIdle(): void {
    this.hand.classList.remove('hands-overlay__hand--knocking')
    this.hand.src = this.openSrc
    gsap.set(this.hand, { clearProps: 'transform,x,y,scale,rotation' })
    this.fistPrimed = false
    this.fistLoadPromise = null
  }
}
