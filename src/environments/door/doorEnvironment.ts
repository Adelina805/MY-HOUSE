import { assets } from '../../config/assets'
import { movement } from '../../config/movement'
import { DoorMediaController } from './doorMedia'
import { playKnockAnimation } from './knockAnimation'
import { PerspectiveController } from './perspectiveController'

export interface DoorEnvironment {
  mount(container: HTMLElement): void
  unmount(): void
  setHidden(hidden: boolean): void
  setPerspectiveEnabled(enabled: boolean): void
  returnToNeutral(): Promise<void>
  playKnock(): Promise<void>
  playGreeting(): Promise<void>
  playGoodbye(): Promise<void>
  applyFinishedState(): void
  resetToIdle(): void
  bindKnockHandler(handler: () => void): void
  bindRestartHandler(handler: () => void): void
  setKnockEnabled(enabled: boolean): void
  getSceneElement(): HTMLElement | null
  resetSceneTransform(): void
  prepareForGoodbye(): void
  clearGreetingHold(): void
}

export function createDoorEnvironment(): DoorEnvironment {
  let root: HTMLElement | null = null
  let scene: HTMLElement | null = null
  let perspective: PerspectiveController | null = null
  let media: DoorMediaController | null = null
  let knockTarget: HTMLButtonElement | null = null
  let restartBtn: HTMLButtonElement | null = null
  let onKnock: (() => void) | null = null
  let onRestart: (() => void) | null = null
  let knockAudio: HTMLAudioElement | null = null

  const playKnockSound = (): void => {
    const src = assets.audio.knock
    if (!src) return
    if (!knockAudio) {
      knockAudio = new Audio(src)
    }
    knockAudio.currentTime = 0
    void knockAudio.play().catch(() => {})
  }

  return {
    mount(container: HTMLElement): void {
      const env = document.createElement('section')
      env.className = 'environment environment--door'
      env.setAttribute('role', 'region')
      env.setAttribute('aria-label', 'Front door')
      if (assets.door.wall) {
        env.dataset.wall = ''
        env.style.setProperty('--door-wall-image', `url("${assets.door.wall}")`)
      }

      const viewport = document.createElement('div')
      viewport.className = 'door__viewport'

      const perspectiveEl = document.createElement('div')
      perspectiveEl.className = 'door__perspective'
      perspectiveEl.style.perspective = `${movement.perspectivePx}px`

      const rig = document.createElement('div')
      rig.className = 'door__rig'

      const sceneEl = document.createElement('div')
      sceneEl.className = 'door__scene'

      const background = document.createElement('div')
      background.className = 'door__background'
      background.setAttribute('aria-hidden', 'true')

      const doorwayFrame = document.createElement('div')
      doorwayFrame.className = 'door__doorway-frame'

      const mediaRoot = document.createElement('div')
      mediaRoot.className = 'door__media'
      mediaRoot.dataset.mode = 'closed'
      mediaRoot.innerHTML = `
        <img class="door__closed-image" alt="" draggable="false" />
        <video class="door__video door__video--greeting" playsinline></video>
        <video class="door__video door__video--goodbye" playsinline></video>
      `

      const knockBtn = document.createElement('button')
      knockBtn.type = 'button'
      knockBtn.className = 'door__knock-target'
      knockBtn.setAttribute('aria-label', 'Knock on the door')
      knockBtn.innerHTML = `<span class="door__sr-only">Knock on the door</span>`

      const restart = document.createElement('button')
      restart.type = 'button'
      restart.className = 'door__restart'
      restart.hidden = true
      restart.setAttribute('aria-label', 'Visit again')
      restart.innerHTML = `<span class="door__sr-only">Visit again</span>`

      mediaRoot.appendChild(knockBtn)
      doorwayFrame.appendChild(mediaRoot)
      sceneEl.appendChild(background)
      sceneEl.appendChild(doorwayFrame)
      rig.appendChild(sceneEl)
      perspectiveEl.appendChild(rig)
      viewport.appendChild(perspectiveEl)
      viewport.appendChild(restart)
      env.appendChild(viewport)
      container.appendChild(env)

      root = env
      scene = sceneEl
      knockTarget = knockBtn
      restartBtn = restart
      media = new DoorMediaController(mediaRoot)
      perspective = new PerspectiveController(viewport, rig)

      knockBtn.addEventListener('click', () => {
        onKnock?.()
      })
      restart.addEventListener('click', () => {
        onRestart?.()
      })
    },

    unmount(): void {
      perspective?.destroy()
      media?.destroy()
      perspective = null
      media = null
      knockTarget = null
      restartBtn = null
      knockAudio = null
      scene = null
      root?.remove()
      root = null
    },

    setHidden(hidden: boolean): void {
      if (!root) return
      root.dataset.hidden = hidden ? 'true' : 'false'
      root.setAttribute('aria-hidden', hidden ? 'true' : 'false')
    },

    setPerspectiveEnabled(enabled: boolean): void {
      if (!perspective) return
      if (enabled) {
        perspective.resume()
      } else {
        perspective.pause()
      }
    },

    returnToNeutral(): Promise<void> {
      return perspective?.returnToNeutralAnimated() ?? Promise.resolve()
    },

    async playKnock(): Promise<void> {
      if (!scene) return
      playKnockSound()
      await playKnockAnimation(scene)
    },

    playGreeting(): Promise<void> {
      return media?.playGreeting() ?? Promise.resolve()
    },

    playGoodbye(): Promise<void> {
      return media?.playGoodbye() ?? Promise.resolve()
    },

    applyFinishedState(): void {
      if (!root || !knockTarget || !restartBtn) return
      root.dataset.finished = 'true'
      media?.showClosed()
      knockTarget.disabled = true
      restartBtn.hidden = false
      this.setPerspectiveEnabled(false)
    },

    resetToIdle(): void {
      if (!root || !knockTarget || !restartBtn) return
      root.dataset.finished = 'false'
      media?.showClosed()
      knockTarget.disabled = false
      restartBtn.hidden = true
      this.setPerspectiveEnabled(true)
      this.resetSceneTransform()
      this.clearGreetingHold()
    },

    bindKnockHandler(handler: () => void): void {
      onKnock = handler
    },

    bindRestartHandler(handler: () => void): void {
      onRestart = handler
    },

    setKnockEnabled(enabled: boolean): void {
      if (knockTarget) {
        knockTarget.disabled = !enabled
      }
    },

    getSceneElement(): HTMLElement | null {
      return scene
    },

    resetSceneTransform(): void {
      if (!scene) return
      scene.style.transform = ''
      scene.style.transformOrigin = ''
    },

    prepareForGoodbye(): void {
      media?.showClosed()
    },

    clearGreetingHold(): void {
      media?.showClosed()
    },
  }
}
