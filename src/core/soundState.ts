type SoundListener = (muted: boolean) => void

let soundMuted = false
const listeners = new Set<SoundListener>()
const mediaElements = new Set<HTMLMediaElement>()

function applyToElement(element: HTMLMediaElement): void {
  element.muted = soundMuted
}

function syncAllMedia(): void {
  for (const element of mediaElements) {
    applyToElement(element)
  }
}

export function isSoundMuted(): boolean {
  return soundMuted
}

export function setSoundMuted(muted: boolean): void {
  if (soundMuted === muted) return
  soundMuted = muted
  syncAllMedia()
  for (const listener of listeners) {
    listener(soundMuted)
  }
}

export function toggleSoundMuted(): boolean {
  setSoundMuted(!soundMuted)
  return soundMuted
}

export function subscribeSound(listener: SoundListener): () => void {
  listeners.add(listener)
  listener(soundMuted)
  return () => {
    listeners.delete(listener)
  }
}

/** Keep global mute state in sync when registering videos, audio, etc. */
export function registerMediaElement(element: HTMLMediaElement): () => void {
  applyToElement(element)
  mediaElements.add(element)
  return () => {
    mediaElements.delete(element)
  }
}

/** iOS prime playback may require muted=true briefly; restore afterward. */
export function restoreMediaMute(element: HTMLMediaElement): void {
  applyToElement(element)
}
