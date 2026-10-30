import gsap from 'gsap'
import { assets } from '../config/assets'
import { candyBowlConfig } from '../config/candyBowl'
import {
  formatPrizeAnnouncement,
  type SelectedPrize,
} from '../config/prizeCatalog'
import { registerMediaElement, restoreMediaMute } from './soundState'

const cfg = candyBowlConfig.announcement

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface PrizeAnnouncementOptions {
  /** Cupped-hands root — burst mounts here so it tracks hands across viewports. */
  burstHost: HTMLElement
}

export interface PrizeAnnouncement {
  element: HTMLElement
  /** Play the announcement for the locked session prize; resolves once when done. */
  play(prize: SelectedPrize): Promise<void>
  /** Hide immediately and kill timelines (scene teardown / restart). */
  reset(): void
  destroy(): void
}

export function createPrizeAnnouncement(
  options: PrizeAnnouncementOptions,
): PrizeAnnouncement {
  const root = document.createElement('div')
  root.className = 'prize-announcement'
  root.hidden = true
  root.setAttribute('aria-hidden', 'true')

  const wash = document.createElement('div')
  wash.className = 'prize-announcement__wash'
  wash.setAttribute('aria-hidden', 'true')

  const burstWrap = document.createElement('div')
  burstWrap.className = 'prize-announcement__burst-wrap'
  burstWrap.setAttribute('aria-hidden', 'true')
  burstWrap.style.setProperty('--prize-burst-size', cfg.burstSize)

  const burst = document.createElement('img')
  burst.className = 'prize-announcement__burst'
  burst.src = assets.effects.feature
  burst.alt = ''
  burst.draggable = false
  burst.decoding = 'async'
  burstWrap.appendChild(burst)
  // Behind cupped hands image + prize inside the shared positioning box.
  options.burstHost.prepend(burstWrap)

  const text = document.createElement('div')
  text.className = 'prize-announcement__text'

  const label = document.createElement('p')
  label.className = 'prize-announcement__label'
  label.textContent = 'YOU RECEIVED'

  const name = document.createElement('p')
  name.className = 'prize-announcement__name'

  const lead = document.createElement('span')
  lead.className = 'prize-announcement__name-lead'

  const object = document.createElement('span')
  object.className = 'prize-announcement__name-object'

  name.append(lead, object)

  const from = document.createElement('p')
  from.className = 'prize-announcement__from'

  text.append(label, name, from)

  const live = document.createElement('div')
  live.className = 'prize-announcement__live'
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('aria-atomic', 'true')

  root.append(wash, text, live)

  let timeline: gsap.core.Timeline | null = null
  let rotationTween: gsap.core.Tween | null = null
  let playing = false
  let resolvePlay: (() => void) | null = null
  let prizeAudio: HTMLAudioElement | null = null
  let unregisterPrizeAudio: (() => void) | null = null

  function ensurePrizeAudio(): HTMLAudioElement | null {
    const src = assets.audio.prize
    if (!src) return null
    if (!prizeAudio) {
      prizeAudio = new Audio(src)
      prizeAudio.volume = 0.15
      unregisterPrizeAudio = registerMediaElement(prizeAudio)
    }
    return prizeAudio
  }

  function playPrizeSound(): void {
    const audio = ensurePrizeAudio()
    if (!audio) return
    restoreMediaMute(audio)
    audio.currentTime = 0
    void audio.play().catch(() => {})
  }

  function stopPrizeSound(): void {
    if (!prizeAudio) return
    prizeAudio.pause()
    prizeAudio.currentTime = 0
  }

  function stopRotation(): void {
    if (rotationTween) {
      rotationTween.kill()
      rotationTween = null
    }
    gsap.killTweensOf(burst)
  }

  function hideImmediate(): void {
    root.hidden = true
    root.setAttribute('aria-hidden', 'true')
    root.classList.remove('prize-announcement--active')
    live.textContent = ''
    gsap.set([wash, burst, label, name, from], {
      clearProps: 'opacity,transform',
    })
    gsap.set(burst, { clearProps: 'rotation' })
    wash.style.opacity = '0'
    burst.style.opacity = '0'
    label.style.opacity = '0'
    name.style.opacity = '0'
    from.style.opacity = '0'
  }

  function cleanupPlayState(): void {
    if (timeline) {
      timeline.kill()
      timeline = null
    }
    stopRotation()
    gsap.killTweensOf([wash, burst, label, name, from])
    playing = false
  }

  function completePlay(): void {
    stopRotation()
    hideImmediate()
    playing = false
    const done = resolvePlay
    resolvePlay = null
    done?.()
  }

  function play(prize: SelectedPrize): Promise<void> {
    if (playing) {
      return new Promise((resolve) => {
        const previous = resolvePlay
        resolvePlay = () => {
          previous?.()
          resolve()
        }
      })
    }

    cleanupPlayState()
    playing = true

    const copy = formatPrizeAnnouncement(prize)
    lead.textContent = copy.leadUpper
    object.textContent = copy.objectUpper
    from.textContent = copy.fromLine

    root.hidden = false
    root.removeAttribute('hidden')
    root.setAttribute('aria-hidden', 'false')
    root.classList.add('prize-announcement--active')

    const reduced = prefersReducedMotion()
    // Always hold the full configured total (including fade-out).
    const total = cfg.totalDurationSec
    const fadeDur = reduced
      ? Math.min(cfg.fadeOutDurationSec, 0.2)
      : cfg.fadeOutDurationSec
    const fadeStart = Math.max(total - fadeDur, 0)
    const nameScaleFrom = reduced ? 1 : cfg.name.scaleFrom

    gsap.set(wash, { opacity: 0 })
    gsap.set(burst, { opacity: 0, rotation: 0 })
    gsap.set(label, { opacity: 0 })
    gsap.set(name, { opacity: 0, scale: nameScaleFrom })
    gsap.set(from, { opacity: 0 })

    // Announce once for screen readers (not each staged fade).
    live.textContent = `You received ${copy.spoken}`
    playPrizeSound()

    if (!reduced) {
      rotationTween = gsap.to(burst, {
        rotation: 360,
        duration: cfg.burstRotationSec,
        ease: 'none',
        repeat: -1,
      })
    }

    return new Promise<void>((resolve) => {
      resolvePlay = resolve

      timeline = gsap
        .timeline({
          defaults: { ease: 'power2.out' },
          onComplete: () => {
            timeline = null
            completePlay()
          },
        })
        .to(
          wash,
          { opacity: 1, duration: reduced ? 0.12 : cfg.washFadeInSec },
          0,
        )
        .to(
          burst,
          { opacity: 1, duration: reduced ? 0.12 : cfg.burstFadeInSec },
          0,
        )
        .to(
          label,
          {
            opacity: 1,
            duration: reduced ? 0.12 : cfg.label.durationSec,
          },
          reduced ? 0.05 : cfg.label.startSec,
        )
        .to(
          name,
          {
            opacity: 1,
            scale: 1,
            duration: reduced ? 0.12 : cfg.name.durationSec,
          },
          reduced ? 0.08 : cfg.name.startSec,
        )
        .to(
          from,
          {
            opacity: 1,
            duration: reduced ? 0.12 : cfg.from.durationSec,
          },
          reduced ? 0.1 : cfg.from.startSec,
        )
        // Fade out so the timeline ends at exactly totalDurationSec.
        .to(
          [wash, burst, label, name, from],
          {
            opacity: 0,
            duration: fadeDur,
            ease: 'power1.inOut',
          },
          fadeStart,
        )
    })
  }

  function reset(): void {
    const done = resolvePlay
    resolvePlay = null
    cleanupPlayState()
    stopPrizeSound()
    hideImmediate()
    done?.()
  }

  function destroy(): void {
    reset()
    unregisterPrizeAudio?.()
    unregisterPrizeAudio = null
    prizeAudio = null
    burstWrap.remove()
    root.remove()
  }

  return {
    element: root,
    play,
    reset,
    destroy,
  }
}
