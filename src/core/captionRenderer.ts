export interface VttCue {
  start: number
  end: number
  text: string
}

const vttCache = new Map<string, VttCue[]>()

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

async function loadVtt(url: string): Promise<VttCue[]> {
  const cached = vttCache.get(url)
  if (cached) return cached

  const response = await fetch(url)
  if (!response.ok) {
    console.warn('Failed to load captions:', url)
    return []
  }
  const text = await response.text()
  const cues = parseVtt(text)
  vttCache.set(url, cues)
  return cues
}

export class CaptionRenderer {
  readonly element: HTMLElement
  private readonly overlay: HTMLElement
  private enabled = true
  private cues: VttCue[] = []
  private video: HTMLVideoElement | null = null
  private onTimeUpdate: (() => void) | null = null

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
      this.syncToCurrentTime()
    }
  }

  async attach(
    video: HTMLVideoElement | null,
    vttUrl: string | null,
  ): Promise<void> {
    this.detach()

    if (!video || !vttUrl) {
      this.overlay.hidden = true
      return
    }

    this.video = video
    this.cues = await loadVtt(vttUrl)
    this.onTimeUpdate = () => this.syncToCurrentTime()
    video.addEventListener('timeupdate', this.onTimeUpdate)
    video.addEventListener('seeked', this.onTimeUpdate)
    video.addEventListener('pause', this.onTimeUpdate)
    video.addEventListener('play', this.onTimeUpdate)
    this.syncToCurrentTime()
  }

  detach(): void {
    if (this.video && this.onTimeUpdate) {
      this.video.removeEventListener('timeupdate', this.onTimeUpdate)
      this.video.removeEventListener('seeked', this.onTimeUpdate)
      this.video.removeEventListener('pause', this.onTimeUpdate)
      this.video.removeEventListener('play', this.onTimeUpdate)
    }
    this.video = null
    this.onTimeUpdate = null
    this.cues = []
    this.clearText()
    this.overlay.hidden = true
  }

  private syncToCurrentTime(): void {
    if (!this.enabled || !this.video || this.cues.length === 0) {
      this.clearText()
      return
    }

    if (this.video.paused && this.video.currentTime <= 0) {
      this.clearText()
      return
    }

    const time = this.video.currentTime
    const active = this.cues.find((cue) => time >= cue.start && time < cue.end)
    if (!active) {
      this.clearText()
      return
    }

    this.overlay.hidden = false
    this.overlay.textContent = active.text
  }

  private clearText(): void {
    this.overlay.textContent = ''
    this.overlay.hidden = true
  }
}
