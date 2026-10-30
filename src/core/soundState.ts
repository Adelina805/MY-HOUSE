import { assets } from '../config/assets'

type SoundListener = (muted: boolean) => void

export type SfxId = 'knock' | 'paper' | 'prize' | 'rummage'

type SfxDefaults = {
  volume: number
  loop?: boolean
}

const SFX_DEFAULTS: Record<SfxId, SfxDefaults> = {
  knock: { volume: 0.6 },
  paper: { volume: 0.55 },
  prize: { volume: 0.15 },
  rummage: { volume: 0.05, loop: true },
}

const SFX_URLS: Record<SfxId, string> = {
  knock: assets.audio.knock,
  paper: assets.audio.paper,
  prize: assets.audio.prize,
  rummage: assets.audio.rummage,
}

type ActiveVoice = {
  id: SfxId
  stop: () => void
}

let soundMuted = false
const listeners = new Set<SoundListener>()
const mediaElements = new Set<HTMLMediaElement>()

let audioCtx: AudioContext | null = null
let masterGain: GainNode | null = null
const buffers = new Map<SfxId, AudioBuffer>()
/** null = decode failed; missing = not attempted yet */
const bufferLoads = new Map<SfxId, Promise<AudioBuffer | null>>()
const activeVoices = new Map<SfxId, Set<ActiveVoice>>()
const decodeFailed = new Set<SfxId>()
/** Bumped on play/stop so pending loadBuffer starts can be cancelled. */
const sfxPlayGeneration = new Map<SfxId, number>()

function applyToElement(element: HTMLMediaElement): void {
  element.muted = soundMuted
}

function syncAllMedia(): void {
  for (const element of mediaElements) {
    applyToElement(element)
  }
}

function syncMasterGain(): void {
  if (!masterGain || !audioCtx) return
  masterGain.gain.setValueAtTime(soundMuted ? 0 : 1, audioCtx.currentTime)
}

function getAudioContextConstructor(): typeof AudioContext | null {
  const w = window as Window & {
    webkitAudioContext?: typeof AudioContext
  }
  return window.AudioContext ?? w.webkitAudioContext ?? null
}

function ensureContext(): AudioContext | null {
  if (audioCtx) return audioCtx
  const Ctor = getAudioContextConstructor()
  if (!Ctor) return null
  audioCtx = new Ctor()
  masterGain = audioCtx.createGain()
  syncMasterGain()
  masterGain.connect(audioCtx.destination)
  return audioCtx
}

function loadBuffer(id: SfxId): Promise<AudioBuffer | null> {
  const cached = buffers.get(id)
  if (cached) return Promise.resolve(cached)
  if (decodeFailed.has(id)) return Promise.resolve(null)

  const existing = bufferLoads.get(id)
  if (existing) return existing

  const url = SFX_URLS[id]
  if (!url) {
    const empty = Promise.resolve(null)
    bufferLoads.set(id, empty)
    return empty
  }

  const ctx = ensureContext()
  if (!ctx) {
    const empty = Promise.resolve(null)
    bufferLoads.set(id, empty)
    return empty
  }

  const load = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`)
      }
      return response.arrayBuffer()
    })
    .then((data) => ctx.decodeAudioData(data.slice(0)))
    .then((buffer) => {
      buffers.set(id, buffer)
      return buffer
    })
    .catch((error: unknown) => {
      console.warn(`SFX decode failed (${id}), using element fallback:`, error)
      decodeFailed.add(id)
      return null
    })

  bufferLoads.set(id, load)
  return load
}

function trackVoice(voice: ActiveVoice): void {
  let set = activeVoices.get(voice.id)
  if (!set) {
    set = new Set()
    activeVoices.set(voice.id, set)
  }
  set.add(voice)
}

function untrackVoice(voice: ActiveVoice): void {
  const set = activeVoices.get(voice.id)
  if (!set) return
  set.delete(voice)
  if (set.size === 0) activeVoices.delete(voice.id)
}

function hasActiveVoice(id: SfxId): boolean {
  const set = activeVoices.get(id)
  return !!set && set.size > 0
}

function startBufferVoice(
  id: SfxId,
  buffer: AudioBuffer,
  options?: { volume?: number; loop?: boolean },
): void {
  const ctx = ensureContext()
  if (!ctx || !masterGain) return

  const defaults = SFX_DEFAULTS[id]
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = options?.loop ?? defaults.loop ?? false

  const gain = ctx.createGain()
  gain.gain.value = options?.volume ?? defaults.volume

  source.connect(gain)
  gain.connect(masterGain)

  const voice: ActiveVoice = {
    id,
    stop: () => {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    },
  }
  trackVoice(voice)
  source.onended = () => {
    untrackVoice(voice)
  }

  try {
    source.start(0)
  } catch (error) {
    console.warn(`SFX start failed (${id}):`, error)
    untrackVoice(voice)
  }
}

/**
 * Fallback when decodeAudioData rejects (e.g. knock.mov on Chromium).
 * GainNode still controls level on iOS, unlike HTMLAudioElement.volume.
 */
function startElementVoice(
  id: SfxId,
  options?: { volume?: number; loop?: boolean },
): void {
  const ctx = ensureContext()
  const url = SFX_URLS[id]
  if (!ctx || !masterGain || !url) return

  const defaults = SFX_DEFAULTS[id]
  const element = new Audio(url)
  element.loop = options?.loop ?? defaults.loop ?? false
  element.preload = 'auto'

  const source = ctx.createMediaElementSource(element)
  const gain = ctx.createGain()
  gain.gain.value = options?.volume ?? defaults.volume
  source.connect(gain)
  gain.connect(masterGain)

  const voice: ActiveVoice = {
    id,
    stop: () => {
      element.pause()
      element.removeAttribute('src')
      element.load()
    },
  }
  trackVoice(voice)

  const onEnded = (): void => {
    element.removeEventListener('ended', onEnded)
    untrackVoice(voice)
  }
  element.addEventListener('ended', onEnded)

  void element.play().catch((error: unknown) => {
    console.warn(`SFX element play failed (${id}):`, error)
    element.removeEventListener('ended', onEnded)
    untrackVoice(voice)
  })
}

function startVoice(
  id: SfxId,
  buffer: AudioBuffer | null,
  options?: { volume?: number; loop?: boolean },
): void {
  if (buffer) {
    startBufferVoice(id, buffer, options)
    return
  }
  startElementVoice(id, options)
}

export function isSoundMuted(): boolean {
  return soundMuted
}

export function setSoundMuted(muted: boolean): void {
  if (soundMuted === muted) return
  soundMuted = muted
  syncMasterGain()
  syncAllMedia()
  if (muted) {
    stopSfx('rummage')
  }
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

/**
 * Create/resume the shared AudioContext from a user gesture so SFX can play on iOS.
 * Safe to call repeatedly.
 */
export function ensureAudioUnlocked(): void {
  const ctx = ensureContext()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
  for (const id of Object.keys(SFX_DEFAULTS) as SfxId[]) {
    if (SFX_URLS[id]) void loadBuffer(id)
  }
}

/** Play a one-shot or looping SFX through the Web Audio gain bus (volume works on iOS). */
export function playSfx(
  id: SfxId,
  options?: { volume?: number; loop?: boolean },
): void {
  if (!SFX_URLS[id]) return
  ensureAudioUnlocked()

  // Keep a single rummage loop; activity windows just extend lifetime via stop timing.
  if (id === 'rummage' && hasActiveVoice(id)) return

  const token = (sfxPlayGeneration.get(id) ?? 0) + 1
  sfxPlayGeneration.set(id, token)

  void loadBuffer(id).then((buffer) => {
    // stopSfx / a newer playSfx invalidated this start (common on mobile decode lag).
    if (sfxPlayGeneration.get(id) !== token) return
    if (id === 'rummage' && hasActiveVoice(id)) return
    startVoice(id, buffer, options)
  })
}

export function stopSfx(id: SfxId): void {
  sfxPlayGeneration.set(id, (sfxPlayGeneration.get(id) ?? 0) + 1)
  const set = activeVoices.get(id)
  if (!set || set.size === 0) return
  for (const voice of [...set]) {
    voice.stop()
    untrackVoice(voice)
  }
}

export function stopAllSfx(): void {
  for (const id of Object.keys(SFX_DEFAULTS) as SfxId[]) {
    stopSfx(id)
  }
}
