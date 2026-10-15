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
import type { ExperienceState } from './types'

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
  }

  destroy(): void {
    gsap.killTweensOf(this.camera)
    this.door.unmount()
    this.candy.unmount()
    this.host.replaceChildren()
    this.camera = null
  }

  private async handleKnock(): Promise<void> {
    if (this.busy || this.state !== 'idle') return
    this.busy = true
    this.state = 'knocking'
    this.door.setKnockEnabled(false)
    this.door.setPerspectiveEnabled(false)

    await this.door.returnToNeutral()

    this.state = 'greeting'
    await this.door.playGreeting()

    this.state = 'waiting-for-candy'
    this.transitionToCandy()
    this.candy.setInteractive(true)
    this.busy = false
  }

  private async handleTakeCandy(): Promise<void> {
    if (this.busy || this.state !== 'waiting-for-candy') return
    this.busy = true
    this.candy.setInteractive(false)

    this.transitionToDoor()

    this.door.setHidden(false)
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

  private transitionToCandy(): void {
    const camera = this.camera
    if (!camera) return

    const yPercent = transitions.toCandyTranslatePercent
    this.candy.setHidden(false)
    this.door.setHidden(true)
    gsap.set(camera, { y: `-${yPercent}%` })
  }

  private transitionToDoor(): void {
    const camera = this.camera
    if (!camera) return

    this.candy.setHidden(true)
    gsap.set(camera, { y: 0 })
  }
}
