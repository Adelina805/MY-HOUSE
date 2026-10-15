import { assets } from '../../config/assets'
import { movement } from '../../config/movement'
import type { GoToScene, Scene } from '../types'
import { playKnockAnimation } from './knockAnimation'
import { PerspectiveController } from './perspectiveController'

export function createDoorstepScene(goTo: GoToScene): Scene {
  let root: HTMLElement | null = null
  let perspective: PerspectiveController | null = null
  let door: HTMLButtonElement | null = null
  let knocking = false

  const onKnock = async (): Promise<void> => {
    if (knocking || !door) return
    knocking = true
    door.disabled = true
    perspective?.pause()

    try {
      await playKnockAnimation(door)
      goTo('greeting')
    } catch {
      knocking = false
      if (door) door.disabled = false
      perspective?.resume()
    }
  }

  return {
    id: 'doorstep',

    mount(container: HTMLElement): void {
      const hasImage = Boolean(assets.doorstep.house)

      const scene = document.createElement('section')
      scene.className = `scene scene--doorstep${hasImage ? ' doorstep--has-image' : ''}`
      scene.setAttribute('role', 'region')
      scene.setAttribute('aria-label', 'Doorstep')

      const viewport = document.createElement('div')
      viewport.className = 'doorstep__viewport'

      const perspectiveEl = document.createElement('div')
      perspectiveEl.className = 'doorstep__perspective'
      perspectiveEl.style.perspective = `${movement.perspectivePx}px`

      const rig = document.createElement('div')
      rig.className = 'doorstep__rig'

      const backdrop = document.createElement('div')
      backdrop.className = 'doorstep__backdrop'

      if (hasImage) {
        backdrop.classList.add('doorstep__backdrop--image')
        const img = document.createElement('img')
        img.src = assets.doorstep.house
        img.alt = ''
        img.draggable = false
        backdrop.appendChild(img)
      } else {
        backdrop.innerHTML = `
          <div class="doorstep__facade" aria-hidden="true">
            <div class="doorstep__facade-sky"></div>
            <div class="doorstep__facade-ground"></div>
            <div class="doorstep__facade-wall"></div>
            <div class="doorstep__facade-roof"></div>
          </div>
        `
      }

      const doorWrap = document.createElement('div')
      doorWrap.className = 'doorstep__door-wrap'

      const doorBtn = document.createElement('button')
      doorBtn.type = 'button'
      doorBtn.className = 'doorstep__door'
      doorBtn.setAttribute('aria-label', 'Knock on the door')
      doorBtn.innerHTML = `<span class="doorstep__sr-only">Knock on the door</span>`

      doorBtn.addEventListener('click', () => {
        void onKnock()
      })

      doorWrap.appendChild(doorBtn)
      rig.appendChild(backdrop)
      rig.appendChild(doorWrap)
      perspectiveEl.appendChild(rig)
      viewport.appendChild(perspectiveEl)
      scene.appendChild(viewport)
      container.appendChild(scene)

      root = scene
      door = doorBtn
      perspective = new PerspectiveController(viewport, rig)
    },

    unmount(): void {
      perspective?.destroy()
      perspective = null
      door = null
      knocking = false
      root?.remove()
      root = null
    },
  }
}
