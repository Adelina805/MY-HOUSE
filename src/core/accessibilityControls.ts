import { CaptionRenderer } from './captionRenderer'
import { isSoundMuted, subscribeSound, toggleSoundMuted } from './soundState'

const ICON_SOUND_ON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>`

const ICON_SOUND_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/></svg>`

const ICON_CC = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 9.17a3 3 0 1 0 0 5.66"/><path d="M17 9.17a3 3 0 1 0 0 5.66"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg>`

const ICON_SKIP = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/></svg>`

export interface AccessibilityControls {
  root: HTMLElement
  captions: CaptionRenderer
  show(): void
  hide(): void
  setSkipVisible(visible: boolean): void
  attachCaptions(video: HTMLVideoElement | null, vttUrl: string | null): void
  showTransientCaption(text: string, durationMs?: number): void
  destroy(): void
}

export interface AccessibilityControlsOptions {
  onSkip: () => void
}

export function createAccessibilityControls(
  options: AccessibilityControlsOptions,
): AccessibilityControls {
  const root = document.createElement('div')
  root.className = 'experience-controls'
  root.hidden = true

  const captionsEl = document.createElement('div')
  captionsEl.className = 'experience-captions'
  captionsEl.hidden = true

  const startCluster = document.createElement('div')
  startCluster.className =
    'experience-controls__cluster experience-controls__cluster--start'

  const endCluster = document.createElement('div')
  endCluster.className =
    'experience-controls__cluster experience-controls__cluster--end'

  const soundBtn = document.createElement('button')
  soundBtn.type = 'button'
  soundBtn.className = 'experience-controls__btn experience-controls__btn--sound'

  const ccBtn = document.createElement('button')
  ccBtn.type = 'button'
  ccBtn.className = 'experience-controls__btn experience-controls__btn--cc'

  const skipBtn = document.createElement('button')
  skipBtn.type = 'button'
  skipBtn.className = 'experience-controls__btn experience-controls__btn--skip'
  skipBtn.innerHTML = ICON_SKIP
  skipBtn.setAttribute('aria-label', 'Skip video')

  const captions = new CaptionRenderer(captionsEl)
  let captionsEnabled = true

  const updateSoundUi = (muted: boolean): void => {
    soundBtn.innerHTML = muted ? ICON_SOUND_OFF : ICON_SOUND_ON
    soundBtn.setAttribute('aria-pressed', String(muted))
    soundBtn.setAttribute(
      'aria-label',
      muted ? 'Unmute sound' : 'Mute sound',
    )
  }

  const updateCcUi = (): void => {
    ccBtn.innerHTML = ICON_CC
    ccBtn.setAttribute('aria-pressed', String(captionsEnabled))
    ccBtn.setAttribute(
      'aria-label',
      captionsEnabled ? 'Turn captions off' : 'Turn captions on',
    )
    ccBtn.dataset.active = captionsEnabled ? 'true' : 'false'
    captions.setEnabled(captionsEnabled)
  }

  soundBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleSoundMuted()
  })

  ccBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    captionsEnabled = !captionsEnabled
    updateCcUi()
  })

  skipBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    options.onSkip()
  })

  for (const btn of [soundBtn, ccBtn, skipBtn]) {
    btn.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
  }

  startCluster.append(soundBtn, ccBtn)
  endCluster.append(skipBtn)
  root.append(startCluster, endCluster)

  const unsubscribeSound = subscribeSound(updateSoundUi)
  updateSoundUi(isSoundMuted())
  updateCcUi()

  return {
    root,
    captions,
    show(): void {
      root.hidden = false
    },
    hide(): void {
      root.hidden = true
    },
    setSkipVisible(visible: boolean): void {
      skipBtn.dataset.visible = visible ? 'true' : 'false'
      skipBtn.tabIndex = visible ? 0 : -1
    },
    attachCaptions(video: HTMLVideoElement | null, vttUrl: string | null): void {
      captions.attach(video, vttUrl)
    },
    showTransientCaption(text: string, durationMs?: number): void {
      captions.showTransient(text, durationMs)
    },
    destroy(): void {
      unsubscribeSound()
      captions.detach()
      root.remove()
      captionsEl.remove()
    },
  }
}
