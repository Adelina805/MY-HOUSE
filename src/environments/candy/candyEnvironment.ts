import gsap from 'gsap'
import { assets } from '../../config/assets'

export interface CandyEnvironment {
  mount(container: HTMLElement): void
  unmount(): void
  setHidden(hidden: boolean): void
  setInteractive(interactive: boolean): void
  playTakeAnimation(): Promise<void>
  bindTakeHandler(handler: () => void): void
  reset(): void
  getSceneElement(): HTMLElement | null
  resetSceneTransform(): void
  getBowlTarget(): HTMLElement | null
  getObjectsRoot(): HTMLElement | null
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function createCandyEnvironment(): CandyEnvironment {
  let root: HTMLElement | null = null
  let scene: HTMLElement | null = null
  let takeTarget: HTMLButtonElement | null = null
  let objectsRoot: HTMLElement | null = null
  let onTake: (() => void) | null = null
  let interactive = true

  return {
    mount(container: HTMLElement): void {
      const env = document.createElement('section')
      env.className = 'environment environment--candy'
      env.setAttribute('role', 'region')
      env.setAttribute('aria-label', 'Candy bowl')
      env.dataset.hidden = 'true'
      env.setAttribute('aria-hidden', 'true')

      const viewport = document.createElement('div')
      viewport.className = 'candy__viewport'

      const sceneEl = document.createElement('div')
      sceneEl.className = 'candy__scene'

      if (assets.candy.image) {
        const img = document.createElement('img')
        img.className = 'candy__image'
        img.src = assets.candy.image
        img.alt = ''
        img.draggable = false
        sceneEl.appendChild(img)
      }

      const objectsEl = document.createElement('div')
      objectsEl.className = 'candy__objects'
      objectsEl.setAttribute('aria-hidden', 'true')
      sceneEl.appendChild(objectsEl)

      const takeBtn = document.createElement('button')
      takeBtn.type = 'button'
      takeBtn.className = 'candy__take-target'
      takeBtn.setAttribute('aria-label', 'Rummage in the candy bowl')
      takeBtn.innerHTML = `<span class="candy__sr-only">Rummage in the candy bowl</span>`

      takeBtn.addEventListener('click', () => {
        if (!interactive) return
        onTake?.()
      })

      sceneEl.appendChild(takeBtn)
      viewport.appendChild(sceneEl)
      env.appendChild(viewport)
      container.appendChild(env)

      root = env
      scene = sceneEl
      takeTarget = takeBtn
      objectsRoot = objectsEl
    },

    unmount(): void {
      scene = null
      takeTarget = null
      objectsRoot = null
      root?.remove()
      root = null
    },

    setHidden(hidden: boolean): void {
      if (!root) return
      root.dataset.hidden = hidden ? 'true' : 'false'
      root.setAttribute('aria-hidden', hidden ? 'true' : 'false')
    },

    setInteractive(value: boolean): void {
      interactive = value
      if (takeTarget) {
        takeTarget.disabled = !value
      }
      if (root) {
        root.dataset.interactive = value ? 'true' : 'false'
      }
    },

    playTakeAnimation(): Promise<void> {
      if (!scene) return Promise.resolve()
      if (prefersReducedMotion()) {
        return Promise.resolve()
      }
      return new Promise((resolve) => {
        gsap.fromTo(
          scene,
          { scale: 1 },
          {
            scale: 0.97,
            duration: 0.12,
            ease: 'power1.in',
            yoyo: true,
            repeat: 1,
            onComplete: () => {
              gsap.set(scene, { clearProps: 'transform' })
              resolve()
            },
          },
        )
      })
    },

    bindTakeHandler(handler: () => void): void {
      onTake = handler
    },

    reset(): void {
      interactive = true
      if (takeTarget) {
        takeTarget.disabled = false
      }
      if (scene) {
        gsap.set(scene, { clearProps: 'all' })
      }
    },

    getSceneElement(): HTMLElement | null {
      return scene
    },

    resetSceneTransform(): void {
      if (!scene) return
      gsap.set(scene, { clearProps: 'all' })
    },

    getBowlTarget(): HTMLElement | null {
      return takeTarget
    },

    getObjectsRoot(): HTMLElement | null {
      return objectsRoot
    },
  }
}
