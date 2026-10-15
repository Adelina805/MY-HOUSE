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
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function createCandyEnvironment(): CandyEnvironment {
  let root: HTMLElement | null = null
  let bowl: HTMLButtonElement | null = null
  let onTake: (() => void) | null = null
  let interactive = true

  return {
    mount(container: HTMLElement): void {
      const hasBg = Boolean(assets.candy.background)

      const env = document.createElement('section')
      env.className = `environment environment--candy${hasBg ? ' candy--has-bg-image' : ''}`
      env.setAttribute('role', 'region')
      env.setAttribute('aria-label', 'Candy bowl')
      env.dataset.hidden = 'true'
      env.setAttribute('aria-hidden', 'true')

      const scene = document.createElement('div')
      scene.className = 'candy__scene'

      if (hasBg) {
        const bg = document.createElement('div')
        bg.className = 'candy__backdrop candy__backdrop--image'
        const img = document.createElement('img')
        img.src = assets.candy.background
        img.alt = ''
        img.draggable = false
        bg.appendChild(img)
        scene.appendChild(bg)
      }

      const bowlBtn = document.createElement('button')
      bowlBtn.type = 'button'
      bowlBtn.className = 'candy__bowl'
      bowlBtn.setAttribute('aria-label', 'Take a piece of candy')

      if (assets.candy.bowlImage) {
        const img = document.createElement('img')
        img.src = assets.candy.bowlImage
        img.alt = ''
        img.draggable = false
        bowlBtn.appendChild(img)
      } else {
        const shape = document.createElement('span')
        shape.className = 'candy__bowl-shape'
        shape.setAttribute('aria-hidden', 'true')
        bowlBtn.appendChild(shape)
      }

      bowlBtn.addEventListener('click', () => {
        if (!interactive) return
        onTake?.()
      })

      scene.appendChild(bowlBtn)
      env.appendChild(scene)
      container.appendChild(env)

      root = env
      bowl = bowlBtn
    },

    unmount(): void {
      bowl = null
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
      if (bowl) {
        bowl.disabled = !value
      }
    },

    playTakeAnimation(): Promise<void> {
      if (!bowl) return Promise.resolve()
      if (prefersReducedMotion()) {
        return Promise.resolve()
      }
      return new Promise((resolve) => {
        gsap.fromTo(
          bowl,
          { scale: 1 },
          {
            scale: 0.94,
            duration: 0.12,
            ease: 'power1.in',
            yoyo: true,
            repeat: 1,
            onComplete: () => {
              gsap.set(bowl, { clearProps: 'transform' })
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
      if (bowl) {
        bowl.disabled = false
        gsap.set(bowl, { clearProps: 'transform' })
      }
    },
  }
}
