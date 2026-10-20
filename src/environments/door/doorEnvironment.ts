import { assets } from '../../config/assets'
import { registerMediaElement, restoreMediaMute } from '../../core/soundState'
import { movement } from '../../config/movement'
import type { KnockPoint } from '../../core/handsKnockAnimation'
import { DoorMediaController } from './doorMedia'
import { playDoorPanelKnockFeedback } from './knockAnimation'
import { PerspectiveController } from './perspectiveController'

export type { KnockPoint }

export interface DoorEnvironment {
  mount(container: HTMLElement): void
  unmount(): void
  setHidden(hidden: boolean): void
  setPerspectiveEnabled(enabled: boolean): void
  snapPerspectiveToNeutral(): void
  returnToNeutral(): Promise<void>
  playKnockStrike(): void
  playKnockFeedback(): Promise<void>
  playGreeting(): Promise<void>
  playGoodbye(): Promise<void>
  applyFinishedState(): void
  resetToIdle(): void
  bindKnockHandler(handler: (point: KnockPoint) => void): void
  bindRestartHandler(handler: () => void): void
  setKnockEnabled(enabled: boolean): void
  getSceneElement(): HTMLElement | null
  resetSceneTransform(): void
  prepareForGoodbye(): void
  clearGreetingHold(): void
  skipActiveVideo(): void
  bindMediaControls(handlers: {
    onSkipVisible: (visible: boolean) => void
    onCaptionVideo: (
      video: HTMLVideoElement | null,
      vttUrl: string | null,
    ) => void
  }): void
}

function knockPointFromEvent(
  button: HTMLButtonElement,
  event: MouseEvent,
): KnockPoint {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { clientX: event.clientX, clientY: event.clientY }
  }
  const rect = button.getBoundingClientRect()
  return {
    clientX: rect.left + rect.width * 0.5,
    clientY: rect.top + rect.height * 0.5,
  }
}

export function createDoorEnvironment(): DoorEnvironment {
  let root: HTMLElement | null = null
  let scene: HTMLElement | null = null
  let mediaRoot: HTMLElement | null = null
  let perspective: PerspectiveController | null = null
  let media: DoorMediaController | null = null
  let knockTarget: HTMLButtonElement | null = null
  let restartBtn: HTMLButtonElement | null = null
  let onKnock: ((point: KnockPoint) => void) | null = null
  let onRestart: (() => void) | null = null
  const knockAudioPool: HTMLAudioElement[] = []
  const knockAudioUnregister: (() => void)[] = []
  const KNOCK_AUDIO_POOL_SIZE = 5

  const playKnockSound = (): void => {
    const src = assets.audio.knock
    if (!src) return

    while (knockAudioPool.length < KNOCK_AUDIO_POOL_SIZE) {
      const audio = new Audio(src)
      knockAudioUnregister.push(registerMediaElement(audio))
      knockAudioPool.push(audio)
    }

    const idle =
      knockAudioPool.find((audio) => audio.paused || audio.ended) ??
      knockAudioPool[0]
    restoreMediaMute(idle)
    idle.currentTime = 0
    void idle.play().catch(() => {})
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

      const mediaEl = document.createElement('div')
      mediaEl.className = 'door__media'
      mediaEl.dataset.mode = 'closed'
      mediaEl.innerHTML = `
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

      mediaEl.appendChild(knockBtn)
      doorwayFrame.appendChild(mediaEl)
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
      mediaRoot = mediaEl
      knockTarget = knockBtn
      restartBtn = restart
      media = new DoorMediaController(mediaEl)
      perspective = new PerspectiveController(viewport, rig)

      knockBtn.addEventListener('click', (event) => {
        media?.primeGreetingPlayback()
        onKnock?.(knockPointFromEvent(knockBtn, event))
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
      mediaRoot = null
      for (const unregister of knockAudioUnregister) {
        unregister()
      }
      knockAudioUnregister.length = 0
      knockAudioPool.length = 0
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

    snapPerspectiveToNeutral(): void {
      perspective?.snapToNeutral()
    },

    returnToNeutral(): Promise<void> {
      return perspective?.returnToNeutralAnimated() ?? Promise.resolve()
    },

    playKnockStrike(): void {
      playKnockSound()
    },

    async playKnockFeedback(): Promise<void> {
      if (!mediaRoot) return
      await playDoorPanelKnockFeedback(mediaRoot)
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

    bindKnockHandler(handler: (point: KnockPoint) => void): void {
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

    skipActiveVideo(): void {
      media?.requestSkip()
    },

    bindMediaControls(handlers): void {
      media?.setSkipVisibleHandler(handlers.onSkipVisible)
      media?.setCaptionVideoHandler(handlers.onCaptionVideo)
    },
  }
}
