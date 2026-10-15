import { assets } from '../../config/assets'
import type { GoToScene, Scene } from '../types'

export function createGoodbyeScene(goTo: GoToScene): Scene {
  let root: HTMLElement | null = null
  let locked = false

  const onRestart = (): void => {
    if (locked) return
    locked = true
    goTo('doorstep')
  }

  return {
    id: 'goodbye',

    mount(container: HTMLElement): void {
      const scene = document.createElement('section')
      scene.className = 'scene scene--goodbye'
      scene.setAttribute('role', 'region')
      scene.setAttribute('aria-label', 'Goodbye')

      const label = document.createElement('h1')
      label.className = 'scene__label'
      label.textContent = 'Goodbye'

      const hint = document.createElement('p')
      hint.className = 'scene__hint'
      hint.textContent =
        'Placeholder for a closing video. Replace via src/config/assets.ts.'

      scene.appendChild(label)
      scene.appendChild(hint)

      if (assets.goodbye.video) {
        const video = document.createElement('video')
        video.src = assets.goodbye.video
        video.controls = true
        video.playsInline = true
        video.setAttribute('aria-label', 'Goodbye video')
        video.style.maxWidth = 'min(100%, 480px)'
        video.style.marginBottom = '1.5rem'
        scene.appendChild(video)
      }

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'scene__button'
      btn.textContent = 'Restart'
      btn.addEventListener('click', onRestart)
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
