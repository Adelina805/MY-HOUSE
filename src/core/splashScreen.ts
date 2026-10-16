import gsap from 'gsap'
import { assets } from '../config/assets'
import { splash as splashConfig } from '../config/splash'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function createSplashScreen(): HTMLElement {
  const splash = document.createElement('div')
  splash.className = 'splash'
  splash.setAttribute('role', 'img')
  splash.setAttribute('aria-label', 'Somewhere in San Diego')
  splash.style.setProperty('--splash-background', `url("${assets.splash.background}")`)

  const title = document.createElement('p')
  title.className = 'splash__title'
  title.setAttribute('aria-hidden', 'true')

  const first = document.createElement('span')
  first.textContent = 'Somewhere'

  const space = document.createElement('span')
  space.className = 'splash__space'
  space.textContent = ' '

  const breakEl = document.createElement('br')
  breakEl.className = 'splash__break'

  const rest = document.createElement('span')
  rest.textContent = 'in San Diego...'

  title.append(first, space, breakEl, rest)
  splash.appendChild(title)
  return splash
}

/** Hold, then fade the overlay out and remove it. */
export function playSplashIntro(splash: HTMLElement): Promise<void> {
  const reduced = prefersReducedMotion()
  const hold = reduced ? 0 : splashConfig.holdDuration
  const fade = reduced ? 0.01 : splashConfig.fadeDuration

  return new Promise((resolve) => {
    gsap.to(splash, {
      opacity: 0,
      duration: fade,
      delay: hold,
      ease: splashConfig.ease,
      onStart: () => {
        splash.style.pointerEvents = 'none'
      },
      onComplete: () => {
        splash.remove()
        resolve()
      },
    })
  })
}
