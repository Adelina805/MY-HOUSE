import { assets } from '../config/assets'

export interface HandsOverlay {
  element: HTMLElement
  leftHand: HTMLImageElement
  rightHand: HTMLImageElement
  /** Foreground candy shapes — above hands for depth mixing. */
  objectsFrontRoot: HTMLElement
}

export function createHandsOverlay(): HandsOverlay {
  const overlay = document.createElement('div')
  overlay.className = 'hands-overlay'
  overlay.setAttribute('aria-hidden', 'true')

  const left = document.createElement('img')
  left.className = 'hands-overlay__hand hands-overlay__hand--left'
  left.src = assets.hands.left
  left.alt = ''
  left.draggable = false
  left.decoding = 'sync'

  const right = document.createElement('img')
  right.className = 'hands-overlay__hand hands-overlay__hand--right'
  right.src = assets.hands.right
  right.alt = ''
  right.draggable = false
  right.decoding = 'sync'

  const objectsFront = document.createElement('div')
  objectsFront.className = 'hands-overlay__objects-front candy__objects'
  objectsFront.setAttribute('aria-hidden', 'true')

  overlay.append(left, right, objectsFront)
  return {
    element: overlay,
    leftHand: left,
    rightHand: right,
    objectsFrontRoot: objectsFront,
  }
}
