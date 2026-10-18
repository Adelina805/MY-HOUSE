import { assets } from '../config/assets'

export function createHandsOverlay(): HTMLElement {
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

  overlay.append(left, right)
  return overlay
}
