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
  RightHandKnockController,
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
  private knockController: RightHandKnockController | null = null
  private greetingInactivityTimer: ReturnType<typeof setTimeout> | null = null
  private greetingTransitionStarted = false
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

    this.knockController = new RightHandKnockController(
      hands.element,
      hands.rightHand,
    )
    this.knockController.setOnHandReturnedToIdle(() => {
      if (
        this.knockCount < KNOCKS_REQUIRED &&
        !this.greetingTransitionStarted &&
        this.state === 'idle'
      ) {
        this.door.setPerspectiveEnabled(true)
      }
    })

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
      this.handleKnock(point)
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
    this.clearGreetingInactivityTimer()
    this.knockController?.dispose()
    this.knockController = null
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
    if (count > KNOCKS_REQUIRED) return
    this.knockStatusEl.textContent = `Knock ${count} of ${KNOCKS_REQUIRED}`
  }

  private clearGreetingInactivityTimer(): void {
    if (this.greetingInactivityTimer !== null) {
      clearTimeout(this.greetingInactivityTimer)
      this.greetingInactivityTimer = null
    }
  }

  private scheduleGreetingInactivityCheck(): void {
    this.clearGreetingInactivityTimer()
    const delayMs = prefersReducedMotion()
      ? 200
      : handsKnockTiming.greetingInactivity * 1000
    this.greetingInactivityTimer = setTimeout(() => {
      this.greetingInactivityTimer = null
      void this.beginGreetingTransition()
    }, delayMs)
  }

  private async beginGreetingTransition(): Promise<void> {
    if (this.greetingTransitionStarted || this.busy || this.state !== 'idle') {
      return
    }
    if (this.knockCount < KNOCKS_REQUIRED) return

    this.greetingTransitionStarted = true
    this.busy = true
    this.knockController?.cancelIdleReturn()

    await this.knockController?.returnToOpenHand()

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

  private handleKnock(point: KnockPoint): void {
    if (this.state === 'greeting') {
      this.playKnockFeedbackOnly(point)
      return
    }

    if (this.busy || this.greetingTransitionStarted || this.state !== 'idle') {
      return
    }

    const controller = this.knockController
    if (!controller) return

    if (this.knockCount === 0) {
      this.door.snapPerspectiveToNeutral()
      this.door.setPerspectiveEnabled(false)
    }

    this.knockCount += 1
    this.announceKnock(this.knockCount)

    controller.knock(point, () => {
      this.door.playKnockStrike()
      this.controls?.showTransientCaption('[knock]')
      void this.door.playKnockFeedback()
    })
    controller.scheduleIdleReturn()

    if (this.knockCount >= KNOCKS_REQUIRED) {
      this.scheduleGreetingInactivityCheck()
    }
  }

  /** Strike animation + sound during the hello video; does not affect knock count or flow. */
  private playKnockFeedbackOnly(point: KnockPoint): void {
    const controller = this.knockController
    if (!controller) return

    controller.knock(point, () => {
      this.door.playKnockStrike()
      this.controls?.showTransientCaption('[knock]')
      void this.door.playKnockFeedback()
    })
    controller.scheduleIdleReturn()
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
    this.clearGreetingInactivityTimer()
    this.greetingTransitionStarted = false
    this.knockCount = 0
    this.knockController?.dispose()
    if (this.hands) {
      this.knockController = new RightHandKnockController(
        this.hands.element,
        this.hands.rightHand,
      )
      this.knockController.setOnHandReturnedToIdle(() => {
        if (
          this.knockCount < KNOCKS_REQUIRED &&
          !this.greetingTransitionStarted &&
          this.state === 'idle'
        ) {
          this.door.setPerspectiveEnabled(true)
        }
      })
    }
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
