import gsap from 'gsap'
import { assets } from '../config/assets'
import { transitions } from '../config/transitions'
import {
  createCandyEnvironment,
  type CandyEnvironment,
} from '../environments/candy/candyEnvironment'
import {
  createDoorEnvironment,
  type DoorEnvironment,
} from '../environments/door/doorEnvironment'
import {
  createAccessibilityControls,
  type AccessibilityControls,
} from './accessibilityControls'
import {
  handsKnockTiming,
  playRightHandKnock,
} from './handsKnockAnimation'
import { createHandsOverlay, type HandsOverlay } from './handsOverlay'
import type { ExperienceState } from './types'
import type { KnockPoint } from '../environments/door/doorEnvironment'

const KNOCKS_REQUIRED = 3

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export class ExperienceController {
  private readonly host: HTMLElement
  private camera: HTMLElement | null = null
  private door: DoorEnvironment
  private candy: CandyEnvironment
  private state: ExperienceState = 'idle'
  private busy = false
  private knockCount = 0
  private knockAnimating = false
  private hands: HandsOverlay | null = null
  private knockStatusEl: HTMLElement | null = null
  private controls: AccessibilityControls | null = null

  constructor(host: HTMLElement) {
    this.host = host
    this.door = createDoorEnvironment()
    this.candy = createCandyEnvironment()
  }

  start(): void {
    const experience = document.createElement('div')
    experience.className = 'experience'

    if (assets.wall) {
      const wall = document.createElement('div')
      wall.className = 'experience__wall'
      wall.setAttribute('aria-hidden', 'true')
      const wallImg = document.createElement('img')
      wallImg.src = assets.wall
      wallImg.alt = ''
      wallImg.draggable = false
      wallImg.decoding = 'sync'
      wallImg.setAttribute('fetchpriority', 'high')
      wall.appendChild(wallImg)
      experience.appendChild(wall)
    }

    const camera = document.createElement('div')
    camera.className = 'experience__camera'
    experience.appendChild(camera)

    this.host.appendChild(experience)

    const hands = createHandsOverlay()
    this.hands = hands
    this.host.appendChild(hands.element)

    const knockStatus = document.createElement('div')
    knockStatus.className = 'door__sr-only'
    knockStatus.setAttribute('aria-live', 'polite')
    knockStatus.setAttribute('aria-atomic', 'true')
    this.knockStatusEl = knockStatus
    this.host.appendChild(knockStatus)

    const controls = createAccessibilityControls({
      onSkip: () => this.handleSkip(),
    })
    this.controls = controls
    this.host.appendChild(controls.root)
    this.host.appendChild(controls.captions.element)

    this.camera = camera

    this.door.mount(camera)
    this.candy.mount(camera)

    this.door.bindKnockHandler((point) => {
      void this.handleKnock(point)
    })
    this.door.bindRestartHandler(() => {
      void this.handleRestart()
    })
    this.door.bindMediaControls({
      onSkipVisible: (visible) => {
        this.controls?.setSkipVisible(visible)
      },
      onCaptionVideo: (video, vttUrl) => {
        this.controls?.attachCaptions(video, vttUrl)
      },
    })
    this.candy.bindTakeHandler(() => {
      void this.handleTakeCandy()
    })

    this.door.setHidden(false)
    this.candy.setHidden(true)
    this.candy.setInteractive(false)
    this.state = 'idle'
    this.door.setPerspectiveEnabled(true)
    gsap.set(this.camera, { y: 0 })
  }

  showControls(): void {
    this.controls?.show()
  }

  destroy(): void {
    this.controls?.destroy()
    this.controls = null
    gsap.killTweensOf(this.camera)
    const rightHand = this.hands?.rightHand
    if (rightHand) gsap.killTweensOf(rightHand)
    const doorScene = this.door.getSceneElement()
    const candyScene = this.candy.getSceneElement()
    if (doorScene) gsap.killTweensOf(doorScene)
    if (candyScene) gsap.killTweensOf(candyScene)
    this.door.unmount()
    this.candy.unmount()
    this.host.replaceChildren()
    this.camera = null
    this.hands = null
    this.knockStatusEl = null
  }

  private announceKnock(count: number): void {
    if (!this.knockStatusEl) return
    this.knockStatusEl.textContent = `Knock ${count} of ${KNOCKS_REQUIRED}`
  }

  private async handleKnock(point: KnockPoint): Promise<void> {
    if (this.busy || this.knockAnimating || this.state !== 'idle') return
    if (this.knockCount >= KNOCKS_REQUIRED) return

    const hands = this.hands
    if (!hands) return

    this.knockAnimating = true
    this.door.snapPerspectiveToNeutral()
    this.door.setPerspectiveEnabled(false)

    const nextCount = this.knockCount + 1
    this.announceKnock(nextCount)

    await playRightHandKnock(hands.element, hands.rightHand, point, () => {
      this.door.playKnockStrike()
      void this.door.playKnockFeedback()
    })

    this.knockCount = nextCount
    this.knockAnimating = false

    if (this.knockCount < KNOCKS_REQUIRED) {
      this.door.setPerspectiveEnabled(true)
      return
    }

    this.door.setKnockEnabled(false)
    this.busy = true

    const delayMs = prefersReducedMotion()
      ? 120
      : handsKnockTiming.beforeGreeting * 1000
    await new Promise((resolve) => setTimeout(resolve, delayMs))

    if (this.state !== 'idle') {
      this.busy = false
      return
    }

    this.state = 'greeting'
    await this.door.playGreeting()

    this.state = 'waiting-for-candy'
    await this.animateTransitionToCandy()
    this.candy.setInteractive(true)
    this.busy = false
  }

  private async handleTakeCandy(): Promise<void> {
    if (this.busy || this.state !== 'waiting-for-candy') return
    this.busy = true
    this.candy.setInteractive(false)

    await this.candy.playTakeAnimation()
    await this.animateTransitionToDoor()

    this.state = 'goodbye'
    await this.door.playGoodbye()

    this.state = 'finished'
    this.door.applyFinishedState()
    this.busy = false
  }

  private handleSkip(): void {
    if (this.state !== 'greeting' && this.state !== 'goodbye') return
    this.door.skipActiveVideo()
  }

  private async handleRestart(): Promise<void> {
    if (this.busy || this.state !== 'finished') return
    this.busy = true

    gsap.set(this.camera, { y: 0 })
    this.door.setHidden(false)
    this.candy.setHidden(true)
    this.candy.reset()
    this.door.resetToIdle()
    this.door.setKnockEnabled(true)
    this.knockCount = 0
    this.knockAnimating = false
    if (this.knockStatusEl) this.knockStatusEl.textContent = ''
    this.state = 'idle'
    this.busy = false
  }

  private async animateTransitionToCandy(): Promise<void> {
    const camera = this.camera
    const doorScene = this.door.getSceneElement()
    const candyScene = this.candy.getSceneElement()
    if (!camera || !doorScene) return

    const duration = prefersReducedMotion() ? 0.01 : transitions.toCandyDuration
    const yPercent = transitions.toCandyTranslatePercent

    this.candy.setHidden(false)
    if (candyScene) {
      gsap.set(candyScene, { opacity: 0 })
    }

    await gsap
      .timeline({ defaults: { ease: transitions.ease } })
      .to(
        doorScene,
        {
          scale: transitions.toCandyZoom,
          transformOrigin: transitions.toCandyZoomOrigin,
          duration,
        },
        0,
      )
      .to(
        camera,
        {
          y: `-${yPercent}%`,
          duration,
        },
        0,
      )
      .to(
        candyScene,
        {
          opacity: 1,
          duration: duration * 0.55,
        },
        duration * 0.35,
      )

    this.door.resetSceneTransform()
    this.door.setHidden(true)
    this.door.clearGreetingHold()
    if (candyScene) {
      gsap.set(candyScene, { opacity: 1 })
    }
  }

  private async animateTransitionToDoor(): Promise<void> {
    const camera = this.camera
    const doorScene = this.door.getSceneElement()
    const candyScene = this.candy.getSceneElement()
    if (!camera || !doorScene) return

    const duration = prefersReducedMotion() ? 0.01 : transitions.toDoorDuration

    this.door.setHidden(false)
    this.door.prepareForGoodbye()
    gsap.set(doorScene, { scale: transitions.toDoorZoom, opacity: 0 })
    gsap.set(doorScene, {
      transformOrigin: transitions.toDoorZoomOrigin,
    })

    await gsap
      .timeline({ defaults: { ease: transitions.ease } })
      .to(
        candyScene,
        {
          opacity: 0,
          duration: duration * 0.45,
        },
        0,
      )
      .to(
        camera,
        {
          y: 0,
          duration,
        },
        0,
      )
      .to(
        doorScene,
        {
          scale: 1,
          opacity: 1,
          duration,
        },
        duration * 0.2,
      )

    this.candy.setHidden(true)
    this.candy.resetSceneTransform()
    this.door.resetSceneTransform()
    gsap.set(camera, { y: 0 })
  }
}
