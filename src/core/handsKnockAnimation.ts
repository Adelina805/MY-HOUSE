import gsap from 'gsap'
import { assets } from '../config/assets'

/** Tune knock motion durations (seconds). */
export const handsKnockTiming = {
  moveToTarget: 0.18,
  strike: 0.1,
  recoil: 0.12,
  returnIdle: 0.26,
  /** Pause after knock 3 before greeting (seconds). */
  beforeGreeting: 0.5,
} as const

/**
 * Knuckle position as a fraction of the hand image box (accounts for transparent padding).
 * Tune separately for open vs fist if alignment differs.
 */
export const handsKnockAlignment = {
  fist: { knuckleX: 0.36, knuckleY: 0.26 },
  viewportClampPaddingPx: 12,
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
  const rect = hand.getBoundingClientRect()
  return {
    x: rect.left + rect.width * ratios.knuckleX,
    y: rect.top + rect.height * ratios.knuckleY,
  }
}

function clampKnockTarget(
  point: KnockPoint,
  overlay: HTMLElement,
  hand: HTMLElement,
): KnockPoint {
  const pad = handsKnockAlignment.viewportClampPaddingPx
  const overlayRect = overlay.getBoundingClientRect()
  const handRect = hand.getBoundingClientRect()
  const { knuckleX, knuckleY } = handsKnockAlignment.fist

  const minX = overlayRect.left + pad + handRect.width * knuckleX
  const maxX = overlayRect.right - pad - handRect.width * (1 - knuckleX)
  const minY = overlayRect.top + pad + handRect.height * knuckleY
  const maxY = overlayRect.bottom - pad - handRect.height * (1 - knuckleY)

  return {
    clientX: Math.min(maxX, Math.max(minX, point.clientX)),
    clientY: Math.min(maxY, Math.max(minY, point.clientY)),
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

let knockInProgress = false

export function isRightHandKnockBusy(): boolean {
  return knockInProgress
}

export function playRightHandKnock(
  overlay: HTMLElement,
  hand: HTMLImageElement,
  target: KnockPoint,
  onStrike: () => void,
): Promise<void> {
  if (knockInProgress) return Promise.resolve()
  knockInProgress = true

  const openSrc = assets.hands.right
  const fistSrc = assets.hands.fist
  const reduced = prefersReducedMotion()

  const finish = (tl: gsap.core.Timeline | null): void => {
    tl?.kill()
    hand.classList.remove('hands-overlay__hand--knocking')
    hand.src = openSrc
    gsap.set(hand, { clearProps: 'transform,x,y,scale,rotation' })
    knockInProgress = false
  }

  return loadFistImage(hand).then(
    () =>
      new Promise((resolve) => {
        hand.classList.add('hands-overlay__hand--knocking')

        const rotation =
          parseFloat(
            getComputedStyle(overlay).getPropertyValue('--hands-right-rotate'),
          ) || -16

        const runLayout = (): void => {
          const clamped = clampKnockTarget(target, overlay, hand)
          const knuckle = knuckleClientPoint(hand, handsKnockAlignment.fist)
          let dx = clamped.clientX - knuckle.x
          let dy = clamped.clientY - knuckle.y

          if (reduced) {
            dx *= 0.35
            dy *= 0.35
          }

          gsap.set(hand, {
            rotation,
            x: 0,
            y: 0,
            scale: 1,
            transformOrigin: `${handsKnockAlignment.fist.knuckleX * 100}% ${handsKnockAlignment.fist.knuckleY * 100}%`,
          })

          const moveDur = reduced ? 0.08 : handsKnockTiming.moveToTarget
          const strikeDur = reduced ? 0.05 : handsKnockTiming.strike
          const recoilDur = reduced ? 0.06 : handsKnockTiming.recoil
          const returnDur = reduced ? 0.1 : handsKnockTiming.returnIdle
          const strikePush = reduced ? -4 : handsKnockAlignment.strikeOffsetY

          const tl = gsap.timeline({
            onComplete: () => {
              finish(null)
              resolve()
            },
          })

          tl.to(hand, {
            x: dx,
            y: dy,
            duration: moveDur,
            ease: 'power2.out',
          })
            .to(
              hand,
              {
                y: dy + strikePush,
                scale: reduced ? 1 : 0.97,
                duration: strikeDur,
                ease: 'power1.in',
                onStart: onStrike,
              },
              '>',
            )
            .to(hand, {
              y: dy,
              scale: 1,
              duration: recoilDur,
              ease: 'power1.out',
            })
            .to(hand, {
              x: 0,
              y: 0,
              scale: 1,
              duration: returnDur,
              ease: 'power2.inOut',
            })
        }

        if (fistSrc) {
          hand.src = fistSrc
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(runLayout)
        })
      }),
  )
}
