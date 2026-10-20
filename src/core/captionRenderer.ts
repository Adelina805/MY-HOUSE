export interface VttCue {
  start: number
  end: number
  text: string
}

export function parseVtt(source: string): VttCue[] {
  const normalized = source.replace(/\r\n/g, '\n').trim()
  const blocks = normalized.split(/\n\n+/)
  const cues: VttCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim())
    if (!lines.length || lines[0] === 'WEBVTT' || lines[0].startsWith('NOTE')) {
      continue
    }

    let timeIndex = lines.findIndex((line) => line.includes('-->'))
    if (timeIndex < 0) continue

    const [startRaw, endRaw] = lines[timeIndex].split('-->').map((s) => s.trim())
    const text = lines.slice(timeIndex + 1).join('\n').trim()
    if (!text) continue

    cues.push({
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw),
      text,
    })
  }

  return cues
}

function parseTimestamp(value: string): number {
  const parts = value.trim().split(':')
  if (parts.length === 3) {
    const [hours, minutes, secMs] = parts
    const [seconds, ms = '0'] = secMs.split('.')
    return (
      Number(hours) * 3600 +
      Number(minutes) * 60 +
      Number(seconds) +
      Number(ms.padEnd(3, '0').slice(0, 3)) / 1000
    )
  }
  if (parts.length === 2) {
    const [minutes, secMs] = parts
    const [seconds, ms = '0'] = secMs.split('.')
    return (
      Number(minutes) * 60 +
      Number(seconds) +
      Number(ms.padEnd(3, '0').slice(0, 3)) / 1000
    )
  }
  return 0
}

function hideNativeCaptions(video: HTMLVideoElement): void {
  for (const textTrack of video.textTracks) {
    textTrack.mode = 'hidden'
  }
}

function findCaptionTrack(
  video: HTMLVideoElement,
  vttUrl: string | null,
): TextTrack | null {
  const tracks = video.querySelectorAll('track')
  for (const trackEl of tracks) {
    if (trackEl.kind !== 'captions' && trackEl.kind !== 'subtitles') continue
    const src = trackEl.getAttribute('src') ?? ''
    if (!vttUrl || src === vttUrl || src.endsWith(vttUrl)) {
      return trackEl.track
    }
  }

  for (const textTrack of video.textTracks) {
    if (textTrack.kind === 'captions' || textTrack.kind === 'subtitles') {
      return textTrack
    }
  }

  return null
}

function activeCueText(track: TextTrack): string | null {
  const cues = track.activeCues
  if (!cues?.length) return null
  const cue = cues[0] as VTTCue
  const text = cue.text?.trim()
  return text || null
}

const DEFAULT_TRANSIENT_CAPTION_MS = 800

export class CaptionRenderer {
  readonly element: HTMLElement
  private readonly overlay: HTMLElement
  private enabled = true
  private video: HTMLVideoElement | null = null
  private textTrack: TextTrack | null = null
  private onCueChange: (() => void) | null = null
  private onTimeUpdate: (() => void) | null = null
  private onAddTrack: (() => void) | null = null
  private onMetadata: (() => void) | null = null
  private transientTimer: ReturnType<typeof setTimeout> | null = null
  private showingTransient = false

  constructor(overlay: HTMLElement) {
    this.element = overlay
    this.overlay = overlay
    this.overlay.classList.add('experience-captions')
    this.overlay.setAttribute('aria-live', 'polite')
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.clearText()
    } else {
      this.syncToActiveCue()
    }
  }

  /** Visual-only caption (e.g. SFX); does not use aria-live. Independent of mute. */
  showTransient(text: string, durationMs = DEFAULT_TRANSIENT_CAPTION_MS): void {
    if (!this.enabled || !text.trim()) return

    this.clearTransientTimer()
    this.showingTransient = true
    this.overlay.hidden = false
    this.overlay.setAttribute('aria-hidden', 'true')
    this.overlay.textContent = text

    this.transientTimer = setTimeout(() => {
      this.transientTimer = null
      this.endTransient()
    }, durationMs)
  }

  attach(video: HTMLVideoElement | null, vttUrl: string | null): void {
    this.detach()

    if (!video || !vttUrl) {
      this.overlay.hidden = true
      return
    }

    this.video = video
    hideNativeCaptions(video)

    this.onAddTrack = () => hideNativeCaptions(video)
    video.textTracks.addEventListener('addtrack', this.onAddTrack)

    const bindTrack = (): void => {
      const track = findCaptionTrack(video, vttUrl)
      if (!track) return

      if (this.textTrack && this.onCueChange) {
        this.textTrack.removeEventListener('cuechange', this.onCueChange)
      }

      this.textTrack = track
      track.mode = 'hidden'

      this.onCueChange = () => this.syncToActiveCue()
      track.addEventListener('cuechange', this.onCueChange)
      this.syncToActiveCue()
    }

    this.onMetadata = bindTrack
    bindTrack()
    video.addEventListener('loadedmetadata', bindTrack)

    this.onTimeUpdate = () => this.syncToActiveCue()
    video.addEventListener('timeupdate', this.onTimeUpdate)
    video.addEventListener('seeked', this.onTimeUpdate)
    video.addEventListener('pause', this.onTimeUpdate)
    video.addEventListener('play', this.onTimeUpdate)
  }

  detach(): void {
    if (this.textTrack && this.onCueChange) {
      this.textTrack.removeEventListener('cuechange', this.onCueChange)
    }
    if (this.video) {
      if (this.onAddTrack) {
        this.video.textTracks.removeEventListener('addtrack', this.onAddTrack)
      }
      if (this.onTimeUpdate) {
        this.video.removeEventListener('timeupdate', this.onTimeUpdate)
        this.video.removeEventListener('seeked', this.onTimeUpdate)
        this.video.removeEventListener('pause', this.onTimeUpdate)
        this.video.removeEventListener('play', this.onTimeUpdate)
      }
      if (this.onMetadata) {
        this.video.removeEventListener('loadedmetadata', this.onMetadata)
      }
    }
    this.video = null
    this.textTrack = null
    this.onCueChange = null
    this.onTimeUpdate = null
    this.onAddTrack = null
    this.onMetadata = null
    this.clearText()
    this.overlay.hidden = true
  }

  private syncToActiveCue(): void {
    if (!this.enabled || !this.video || !this.textTrack) {
      this.clearText()
      return
    }

    this.textTrack.mode = 'hidden'

    if (this.video.paused && this.video.currentTime <= 0) {
      this.clearText()
      return
    }

    const text = activeCueText(this.textTrack)
    if (!text) {
      this.clearText()
      return
    }

    this.overlay.removeAttribute('aria-hidden')
    this.overlay.hidden = false
    this.overlay.textContent = text
  }

  private endTransient(): void {
    if (!this.showingTransient) return
    this.showingTransient = false
    if (this.video && this.textTrack) {
      this.syncToActiveCue()
    } else {
      this.clearText()
    }
  }

  private clearTransientTimer(): void {
    if (this.transientTimer !== null) {
      clearTimeout(this.transientTimer)
      this.transientTimer = null
    }
  }

  private clearText(): void {
    this.clearTransientTimer()
    this.showingTransient = false
    this.overlay.textContent = ''
    this.overlay.hidden = true
    this.overlay.removeAttribute('aria-hidden')
  }
}
