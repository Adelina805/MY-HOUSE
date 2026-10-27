import { assets } from '../config/assets'

export interface CuppedRevealElements {
  root: HTMLElement
  /** GSAP target for rise/fade — keeps CSS centering on `root`. */
  motion: HTMLElement
  handsImage: HTMLImageElement
  prize: HTMLElement
  /** GSAP target for prize pop — keeps CSS placement on `prize`. */
  prizeVisual: HTMLElement
}

export interface HandsOverlay {
  element: HTMLElement
  leftHand: HTMLImageElement
  rightHand: HTMLImageElement
  cuppedReveal: CuppedRevealElements
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

  const cuppedRoot = document.createElement('div')
  cuppedRoot.className = 'hands-overlay__cupped-reveal'
  cuppedRoot.hidden = true
  cuppedRoot.setAttribute('aria-hidden', 'true')

  const cuppedMotion = document.createElement('div')
  cuppedMotion.className = 'hands-overlay__cupped-reveal-motion'

  const cuppedImg = document.createElement('img')
  cuppedImg.className = 'hands-overlay__cupped-hands'
  cuppedImg.src = assets.hands.cupped
  cuppedImg.alt = ''
  cuppedImg.draggable = false
  cuppedImg.decoding = 'sync'

  const prize = document.createElement('div')
  prize.className = 'hands-overlay__prize'
  prize.setAttribute('aria-hidden', 'true')

  const prizeVisual = document.createElement('div')
  prizeVisual.className = 'hands-overlay__prize-visual'
  prize.append(prizeVisual)

  cuppedMotion.append(cuppedImg)
  cuppedRoot.append(cuppedMotion, prize)

  const objectsFront = document.createElement('div')
  objectsFront.className = 'hands-overlay__objects-front candy__objects'
  objectsFront.setAttribute('aria-hidden', 'true')

  overlay.append(left, right, objectsFront, cuppedRoot)
  return {
    element: overlay,
    leftHand: left,
    rightHand: right,
    cuppedReveal: {
      root: cuppedRoot,
      motion: cuppedMotion,
      handsImage: cuppedImg,
      prize,
      prizeVisual,
    },
    objectsFrontRoot: objectsFront,
  }
}
