import { assets } from '../../config/assets'
import type { GoToScene, Scene } from '../types'

export function createCandyScene(goTo: GoToScene): Scene {
  let root: HTMLElement | null = null
  let locked = false

  const onTakeCandy = (): void => {
    if (locked) return
    locked = true
    goTo('goodbye')
  }

  return {
    id: 'candy',

    mount(container: HTMLElement): void {
      const scene = document.createElement('section')
      scene.className = 'scene scene--candy'
      scene.setAttribute('role', 'region')
      scene.setAttribute('aria-label', 'Candy')

      const label = document.createElement('h1')
      label.className = 'scene__label'
      label.textContent = 'Candy'

      const hint = document.createElement('p')
      hint.className = 'scene__hint'
      hint.textContent =
        'Placeholder candy bowl. Tap or click to take a treat. Swap art in src/config/assets.ts.'

      const bowl = document.createElement('button')
      bowl.type = 'button'
      bowl.className = 'candy-bowl'
      bowl.setAttribute('aria-label', 'Take a piece of candy from the bowl')

      if (assets.candy.bowl) {
        const img = document.createElement('img')
        img.src = assets.candy.bowl
        img.alt = ''
        img.draggable = false
        bowl.appendChild(img)
      } else {
        const shape = document.createElement('span')
        shape.className = 'candy-bowl__shape'
        shape.setAttribute('aria-hidden', 'true')
        bowl.appendChild(shape)
      }

      const bowlLabel = document.createElement('span')
      bowlLabel.className = 'candy-bowl__label'
      bowlLabel.textContent = 'Candy bowl'
      bowl.appendChild(bowlLabel)

      bowl.addEventListener('click', onTakeCandy)

      scene.appendChild(label)
      scene.appendChild(hint)
      scene.appendChild(bowl)
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
