import { assets } from '../../config/assets'
import type { GoToScene, Scene } from '../types'

export function createGreetingScene(goTo: GoToScene): Scene {
  let root: HTMLElement | null = null
  let locked = false

  const onContinue = (): void => {
    if (locked) return
    locked = true
    goTo('candy')
  }

  return {
    id: 'greeting',

    mount(container: HTMLElement): void {
      const scene = document.createElement('section')
      scene.className = 'scene scene--greeting'
      scene.setAttribute('role', 'region')
      scene.setAttribute('aria-label', 'Greeting')

      const label = document.createElement('h1')
      label.className = 'scene__label'
      label.textContent = 'Greeting'

      const hint = document.createElement('p')
      hint.className = 'scene__hint'
      hint.textContent =
        'Placeholder for a pre-recorded greeting video. Replace via src/config/assets.ts.'

      scene.appendChild(label)
      scene.appendChild(hint)

      if (assets.greeting.video) {
        const video = document.createElement('video')
        video.src = assets.greeting.video
        video.controls = true
        video.playsInline = true
        video.setAttribute('aria-label', 'Greeting video')
        video.style.maxWidth = 'min(100%, 480px)'
        video.style.marginBottom = '1.5rem'
        scene.appendChild(video)
      }

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'scene__button'
      btn.textContent = 'Continue'
      btn.addEventListener('click', onContinue)
      scene.appendChild(btn)

      container.appendChild(scene)
      root = scene
    },

    unmount(): void {
      locked = false
      root?.remove()
      root = null
    },
  }
}
