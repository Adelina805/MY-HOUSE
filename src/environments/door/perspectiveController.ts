import gsap from 'gsap'
import { movement } from '../../config/movement'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isCoarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * Subtle 2.5D camera on the door rig.
 * Sensitivity: see src/config/movement.ts
 */
export class PerspectiveController {
  private readonly viewport: HTMLElement
  private readonly rig: HTMLElement
  private readonly reducedMotion: boolean
  private readonly coarse: boolean
  private paused = false
  private destroyed = false

  private readonly quickRotateX: gsap.QuickToFunc
  private readonly quickRotateY: gsap.QuickToFunc
  private readonly quickScale: gsap.QuickToFunc
  private idleTween: gsap.core.Tween | null = null

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.destroyed || this.paused || this.reducedMotion || this.coarse) return

    const rect = this.viewport.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1
    const clampedX = Math.max(-1, Math.min(1, nx))
    const clampedY = Math.max(-1, Math.min(1, ny))
    const distance = Math.min(1, Math.hypot(clampedX, clampedY))

    this.quickRotateY(clampedX * movement.maxYawDeg)
    this.quickRotateX(-clampedY * movement.maxPitchDeg)
    this.quickScale(1 + distance * movement.scaleBoost)
  }

  private readonly onPointerLeave = (): void => {
    if (this.destroyed || this.paused || this.reducedMotion || this.coarse) return
    this.returnToNeutral(movement.returnEaseDuration)
  }

  constructor(viewport: HTMLElement, rig: HTMLElement) {
    this.viewport = viewport
    this.rig = rig
    this.reducedMotion = prefersReducedMotion()
    this.coarse = isCoarsePointer()

    gsap.set(this.rig, { rotateX: 0, rotateY: 0, scale: 1, force3D: true })

    this.quickRotateX = gsap.quickTo(this.rig, 'rotateX', {
      duration: movement.pointerEaseDuration,
      ease: 'power2.out',
    })
    this.quickRotateY = gsap.quickTo(this.rig, 'rotateY', {
      duration: movement.pointerEaseDuration,
      ease: 'power2.out',
    })
    this.quickScale = gsap.quickTo(this.rig, 'scale', {
      duration: movement.pointerEaseDuration,
      ease: 'power2.out',
    })

    if (!this.reducedMotion) {
      if (this.coarse) {
        this.startIdle()
      } else {
        this.viewport.addEventListener('pointermove', this.onPointerMove, {
          passive: true,
        })
        this.viewport.addEventListener('pointerleave', this.onPointerLeave)
      }
    }
  }

  pause(): void {
    this.paused = true
    this.stopIdle()
    if (!this.reducedMotion) {
      this.returnToNeutral(0.35)
    }
  }

  resume(): void {
    if (this.destroyed) return
    this.paused = false
    if (!this.reducedMotion && this.coarse) {
      this.startIdle()
    }
  }

  returnToNeutralAnimated(duration = movement.returnEaseDuration): Promise<void> {
    if (this.reducedMotion) {
      gsap.set(this.rig, { rotateX: 0, rotateY: 0, scale: 1 })
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      gsap.to(this.rig, {
        rotateX: 0,
        rotateY: 0,
        scale: 1,
        duration,
        ease: 'power2.out',
        overwrite: 'auto',
        onComplete: resolve,
      })
    })
  }

  destroy(): void {
    this.destroyed = true
    this.paused = true
    this.viewport.removeEventListener('pointermove', this.onPointerMove)
    this.viewport.removeEventListener('pointerleave', this.onPointerLeave)
    this.stopIdle()
    gsap.killTweensOf(this.rig)
  }

  private returnToNeutral(duration: number): void {
    gsap.to(this.rig, {
      rotateX: 0,
      rotateY: 0,
      scale: 1,
      duration,
      ease: 'power2.out',
      overwrite: 'auto',
    })
  }

  private startIdle(): void {
    this.stopIdle()
    const amp = movement.idleAmplitudeDeg
    this.idleTween = gsap.to(this.rig, {
      rotateY: amp,
      rotateX: amp * 0.4,
      duration: movement.idleDuration,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    })
  }

  private stopIdle(): void {
    if (this.idleTween) {
      this.idleTween.kill()
      this.idleTween = null
    }
  }
}
