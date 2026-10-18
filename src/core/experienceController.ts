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
import { createHandsOverlay } from './handsOverlay'
import type { ExperienceState } from './types'

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

    this.host.appendChild(createHandsOverlay())

    this.camera = camera

    this.door.mount(camera)
    this.candy.mount(camera)

    this.door.bindKnockHandler(() => {
      void this.handleKnock()
    })
    this.door.bindRestartHandler(() => {
      void this.handleRestart()
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

  destroy(): void {
    gsap.killTweensOf(this.camera)
    const doorScene = this.door.getSceneElement()
    const candyScene = this.candy.getSceneElement()
    if (doorScene) gsap.killTweensOf(doorScene)
    if (candyScene) gsap.killTweensOf(candyScene)
    this.door.unmount()
    this.candy.unmount()
    this.host.replaceChildren()
    this.camera = null
  }

  private async handleKnock(): Promise<void> {
    if (this.busy || this.state !== 'idle') return
    this.busy = true
    this.state = 'knocking'
    this.door.snapPerspectiveToNeutral()
    this.door.setKnockEnabled(false)
    this.door.setPerspectiveEnabled(false)

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

  private async handleRestart(): Promise<void> {
    if (this.busy || this.state !== 'finished') return
    this.busy = true

    gsap.set(this.camera, { y: 0 })
    this.door.setHidden(false)
    this.candy.setHidden(true)
    this.candy.reset()
    this.door.resetToIdle()
    this.door.setKnockEnabled(true)
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
