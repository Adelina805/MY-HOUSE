import gsap from 'gsap'
import { assets } from '../config/assets'
import { candyBowlConfig } from '../config/candyBowl'
import { transitions } from '../config/transitions'
import {
  createCandyEnvironment,
  type CandyEnvironment,
} from '../environments/candy/candyEnvironment'
import {
  createCandyRummageController,
  type CandyRummageController,
} from '../environments/candy/candyRummage'
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
import { registerCandyRespawn } from './candyBowlDebug'
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
  private candyAutoGoodbyeTimer: ReturnType<typeof setTimeout> | null = null
  private revealGoodbyeTimer: ReturnType<typeof setTimeout> | null = null
  private greetingTransitionStarted = false
  private hands: HandsOverlay | null = null
  private knockStatusEl: HTMLElement | null = null
  private controls: AccessibilityControls | null = null
  private candyRummage: CandyRummageController | null = null
  private cuppedDismissPointerHandler: ((event: PointerEvent) => void) | null =
    null
  private cuppedAutoDismissTimer: ReturnType<typeof setTimeout> | null = null

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
      const rummageState = this.candyRummage?.getState()
      if (rummageState === 'idle') {
        this.candyRummage?.beginPlungeFromKeyboard()
        return
      }
      if (rummageState === 'rummaging') {
        this.candyRummage?.tryGrabFromKeyboard()
        return
      }
      if (
        rummageState === 'plunging' ||
        rummageState === 'grabbing' ||
        rummageState === 'revealing'
      ) {
        return
      }
      void this.handleTakeCandy()
    })

    this.candyRummage = createCandyRummageController({
      overlay: hands.element,
      leftHand: hands.leftHand,
      rightHand: hands.rightHand,
      cuppedReveal: hands.cuppedReveal,
      getBowlTarget: () => this.candy.getBowlTarget(),
      getObjectsRoot: () => this.candy.getObjectsRoot(),
      getObjectsFrontRoot: () => this.hands?.objectsFrontRoot ?? null,
      onPlungeStart: () => {
        this.clearCandyAutoGoodbyeTimer()
      },
      onPrizeRevealed: () => {
        this.clearCandyAutoGoodbyeTimer()
        this.scheduleGoodbyeAfterReveal()
      },
    })
    registerCandyRespawn(() => {
      this.candyRummage?.respawnObjects()
    })

    this.door.setHidden(false)
    this.candy.setHidden(true)
    this.candy.setInteractive(false)
    this.state = 'idle'
    this.door.setPerspectiveEnabled(true)
  }

  showControls(): void {
    this.controls?.show()
  }

  /** Dev-only: jump to candy bowl without playing the door flow. */
  devEnterCandyScene(): void {
    if (!import.meta.env.DEV) return
    this.clearGreetingInactivityTimer()
    this.clearCandyAutoGoodbyeTimer()
    this.busy = false
    this.greetingTransitionStarted = true
    this.knockCount = KNOCKS_REQUIRED
    this.door.setHidden(true)
    this.door.setKnockEnabled(false)
    this.candy.setHidden(false)
    const candyScene = this.candy.getSceneElement()
    if (candyScene) {
      gsap.set(candyScene, { opacity: 1 })
    }
    this.state = 'waiting-for-candy'
    this.candy.setInteractive(true)
    this.candyRummage?.bind()
  }

  /** Idle fallback if the visitor never grabs a prize (after candy is actually visible). */
  startCandyIdleGoodbyeTimer(): void {
    if (this.state !== 'waiting-for-candy') return
    this.scheduleCandyAutoGoodbye()
  }

  destroy(): void {
    this.controls?.destroy()
    this.controls = null
    gsap.killTweensOf(this.camera)
    this.clearGreetingInactivityTimer()
    this.clearCandyAutoGoodbyeTimer()
    this.clearRevealGoodbyeTimer()
    this.clearCuppedAutoDismissTimer()
    this.unbindCuppedDismissOnTap()
    this.knockController?.dispose()
    this.knockController = null
    const doorScene = this.door.getSceneElement()
    const candyScene = this.candy.getSceneElement()
    if (doorScene) gsap.killTweensOf(doorScene)
    if (candyScene) gsap.killTweensOf(candyScene)
    this.door.unmount()
    this.candyRummage?.dispose()
    this.candyRummage = null
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

  private clearCandyAutoGoodbyeTimer(): void {
    if (this.candyAutoGoodbyeTimer !== null) {
      clearTimeout(this.candyAutoGoodbyeTimer)
      this.candyAutoGoodbyeTimer = null
    }
  }

  private clearRevealGoodbyeTimer(): void {
    if (this.revealGoodbyeTimer !== null) {
      clearTimeout(this.revealGoodbyeTimer)
      this.revealGoodbyeTimer = null
    }
  }

  private scheduleGoodbyeAfterReveal(): void {
    this.clearRevealGoodbyeTimer()
    const delayMs = candyBowlConfig.reveal.holdBeforeGoodbyeMs
    this.revealGoodbyeTimer = setTimeout(() => {
      this.revealGoodbyeTimer = null
      void this.leaveCandyForGoodbye()
    }, delayMs)
  }

  private scheduleCandyAutoGoodbye(): void {
    this.clearCandyAutoGoodbyeTimer()
    this.candyAutoGoodbyeTimer = setTimeout(() => {
      this.candyAutoGoodbyeTimer = null
      void this.leaveCandyForGoodbye()
    }, transitions.candyAutoGoodbyeDelayMs)
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
    this.door.setKnockEnabled(false)
    this.knockController?.cancelIdleReturn()

    await this.knockController?.returnToOpenHand()

    if (this.state !== 'idle') {
      this.busy = false
      this.greetingTransitionStarted = false
      this.door.setKnockEnabled(true)
      return
    }

    this.state = 'greeting'
    this.door.setKnockEnabled(true)
    await this.door.playGreeting()

    this.state = 'waiting-for-candy'
    await this.animateTransitionToCandy()
    this.candy.setInteractive(true)
    this.candyRummage?.bind()
    this.busy = false
    this.scheduleCandyAutoGoodbye()
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
      this.door.setKnockEnabled(false)
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
    await this.leaveCandyForGoodbye()
  }

  private async leaveCandyForGoodbye(): Promise<void> {
    const rummageState = this.candyRummage?.getState()
    if (rummageState === 'grabbing') return
    if (this.busy || this.state !== 'waiting-for-candy') return
    this.clearCandyAutoGoodbyeTimer()

    if (!this.candyRummage?.isCuppedRevealActive()) {
      const started = this.candyRummage?.beginCuppedOutroForGoodbye() ?? false
      if (started) {
        this.candy.setInteractive(false)
        return
      }
    }

    this.busy = true
    this.candy.setInteractive(false)

    await this.animateTransitionToDoor()

    this.state = 'goodbye'
    await this.door.playGoodbye()

    this.state = 'finished'
    this.door.applyFinishedState()
    this.beginCuppedDismissPhase()
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
    this.candyRummage?.reset()
    this.candy.setHidden(true)
    this.candy.reset()
    this.door.resetToIdle()
    this.door.setKnockEnabled(true)
    this.clearGreetingInactivityTimer()
    this.clearCandyAutoGoodbyeTimer()
    this.clearRevealGoodbyeTimer()
    this.clearCuppedAutoDismissTimer()
    this.unbindCuppedDismissOnTap()
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
    const doorScene = this.door.getSceneElement()
    const candyScene = this.candy.getSceneElement()
    if (!doorScene) return

    const duration = prefersReducedMotion() ? 0.01 : transitions.toCandyDuration
    const outDuration = duration * 0.52
    const inDuration = duration * 0.52

    this.candy.setHidden(false)
    if (candyScene) {
      gsap.set(candyScene, { opacity: 0 })
    }
    gsap.set(doorScene, { opacity: 1 })

    await gsap
      .timeline({ defaults: { ease: transitions.ease } })
      .to(
        doorScene,
        {
          opacity: 0,
          duration: outDuration,
        },
        0,
      )
      .to(
        candyScene,
        {
          opacity: 1,
          duration: inDuration,
        },
        outDuration * 0.82,
      )

    this.door.resetSceneTransform()
    this.door.setHidden(true)
    this.door.clearGreetingHold()
    if (candyScene) {
      gsap.set(candyScene, { clearProps: 'opacity' })
    }
  }

  private async animateTransitionToDoor(): Promise<void> {
    const doorScene = this.door.getSceneElement()
    const candyScene = this.candy.getSceneElement()
    if (!doorScene) return

    const duration = prefersReducedMotion() ? 0.01 : transitions.toDoorDuration
    const outDuration = duration * 0.52
    const inDuration = duration * 0.52

    this.door.setHidden(false)
    this.door.prepareForGoodbye()
    gsap.set(doorScene, { opacity: 0 })
    if (candyScene) {
      gsap.set(candyScene, { opacity: 1 })
    }

    await gsap
      .timeline({ defaults: { ease: transitions.ease } })
      .to(
        candyScene,
        {
          opacity: 0,
          duration: outDuration,
        },
        0,
      )
      .to(
        doorScene,
        {
          opacity: 1,
          duration: inDuration,
        },
        outDuration * 0.82,
      )

    this.candyRummage?.detachRummageForGoodbye()
    this.candy.setHidden(true)
    this.candy.resetSceneTransform()
    this.door.resetSceneTransform()
  }

  private clearCuppedAutoDismissTimer(): void {
    if (this.cuppedAutoDismissTimer !== null) {
      clearTimeout(this.cuppedAutoDismissTimer)
      this.cuppedAutoDismissTimer = null
    }
  }

  private dismissCuppedIfActive(): void {
    if (!this.candyRummage?.isCuppedRevealActive()) {
      this.clearCuppedAutoDismissTimer()
      this.unbindCuppedDismissOnTap()
      return
    }
    this.candyRummage.dismissCuppedReveal()
    this.clearCuppedAutoDismissTimer()
    this.unbindCuppedDismissOnTap()
  }

  private beginCuppedDismissPhase(): void {
    if (!this.candyRummage?.isCuppedRevealActive()) return
    this.bindCuppedDismissOnTap()
    this.scheduleCuppedAutoDismissAfterGoodbye()
  }

  private scheduleCuppedAutoDismissAfterGoodbye(): void {
    this.clearCuppedAutoDismissTimer()
    if (!this.candyRummage?.isCuppedRevealActive()) return
    this.cuppedAutoDismissTimer = setTimeout(() => {
      this.cuppedAutoDismissTimer = null
      this.dismissCuppedIfActive()
    }, transitions.cuppedDismissAfterGoodbyeMs)
  }

  private bindCuppedDismissOnTap(): void {
    this.unbindCuppedDismissOnTap()
    if (!this.candyRummage?.isCuppedRevealActive()) return

    this.cuppedDismissPointerHandler = (event: PointerEvent) => {
      if (this.state !== 'finished') return
      if (event.button !== 0) return
      const target = event.target
      if (target instanceof Element && target.closest('.experience-controls')) {
        return
      }
      if (!this.candyRummage?.isCuppedRevealActive()) {
        this.unbindCuppedDismissOnTap()
        return
      }
      event.preventDefault()
      this.dismissCuppedIfActive()
    }
    window.addEventListener('pointerdown', this.cuppedDismissPointerHandler, {
      capture: true,
    })
  }

  private unbindCuppedDismissOnTap(): void {
    if (!this.cuppedDismissPointerHandler) return
    window.removeEventListener(
      'pointerdown',
      this.cuppedDismissPointerHandler,
      { capture: true },
    )
    this.cuppedDismissPointerHandler = null
  }
}
