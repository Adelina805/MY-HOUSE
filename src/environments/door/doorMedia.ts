import { assets } from '../../config/assets'

const PLACEHOLDER_VIDEO_MS = 400
const VIDEO_READY_TIMEOUT_MS = 8000
const PLAY_START_TIMEOUT_MS = 5000
const CANPLAY_RETRY_TIMEOUT_MS = 4000
const PLAYBACK_FALLBACK_MS = 20_000
const PLAYBACK_MAX_MS = 30_000

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export type DoorMediaMode =
  | 'closed'
  | 'greeting-loading'
  | 'greeting'
  | 'greeting-hold'
  | 'goodbye'

export class DoorMediaController {
  private readonly mediaRoot: HTMLElement
  private readonly closedImage: HTMLImageElement
  private readonly greetingVideo: HTMLVideoElement
  private readonly goodbyeVideo: HTMLVideoElement

  private greetingLoaded = false
  private goodbyeLoaded = false
  /** Once real greeting playback starts, ignore the muted prime's pause. */
  private greetingPrimeSettled = false

  constructor(mediaRoot: HTMLElement) {
    this.mediaRoot = mediaRoot

    this.closedImage = mediaRoot.querySelector(
      '.door__closed-image',
    ) as HTMLImageElement

    if (assets.door.image) {
      this.closedImage.decoding = 'sync'
      this.closedImage.setAttribute('fetchpriority', 'high')
      this.closedImage.src = assets.door.image
    }

    this.greetingVideo = mediaRoot.querySelector(
      '.door__video--greeting',
    ) as HTMLVideoElement
    this.goodbyeVideo = mediaRoot.querySelector(
      '.door__video--goodbye',
    ) as HTMLVideoElement

    for (const video of [this.greetingVideo, this.goodbyeVideo]) {
      video.playsInline = true
      video.controls = false
      video.setAttribute('playsinline', '')
      video.setAttribute('webkit-playsinline', '')
    }

    this.goodbyeVideo.preload = 'none'
    this.greetingVideo.preload = 'none'
    if (assets.door.greetingVideo) {
      this.ensureGreetingSource(assets.door.greetingVideo)
    }
  }

  /** Call synchronously from the knock click (before any await) for iOS playback. */
  primeGreetingPlayback(): void {
    const src = assets.door.greetingVideo
    if (!src) return

    const video = this.greetingVideo
    this.greetingPrimeSettled = false
    this.ensureGreetingSource(src)
    this.setMode('greeting-loading')
    video.muted = true
    const playPromise = video.play()
    if (!playPromise) {
      video.muted = false
      return
    }
    void playPromise
      .then(() => {
        if (this.greetingPrimeSettled) return
        video.pause()
        video.currentTime = 0
      })
      .catch(() => {})
      .finally(() => {
        if (!this.greetingPrimeSettled) {
          video.muted = false
        }
      })
  }

  setMode(mode: DoorMediaMode): void {
    this.mediaRoot.dataset.mode = mode
    if (mode === 'closed') {
      this.pauseAllVideos()
    }
  }

  showClosed(): void {
    this.setMode('closed')
  }

  holdGreetingEndFrame(): void {
    this.greetingVideo.pause()
    this.setMode('greeting-hold')
  }

  async playGreeting(): Promise<void> {
    this.goodbyeVideo.pause()
    this.goodbyeVideo.currentTime = 0

    const src = assets.door.greetingVideo
    if (!src) {
      await wait(PLACEHOLDER_VIDEO_MS)
      this.holdGreetingEndFrame()
      return
    }

    const video = this.greetingVideo
    video.muted = false

    this.ensureGreetingSource(src)
    this.setMode('greeting-loading')

    await this.waitForStartFrame(video, src)

    const deadline = this.playbackDeadlineMs(video)
    await Promise.race([
      this.playVideo(
        video,
        src,
        this.greetingLoaded,
        () => {
          this.greetingLoaded = true
        },
        {
          onPlaying: () => this.setMode('greeting'),
        },
      ),
      wait(deadline),
    ])

    this.holdGreetingEndFrame()
  }

  async playGoodbye(): Promise<void> {
    this.pauseAllVideos()
    this.setMode('goodbye')

    const src = assets.door.goodbyeVideo
    if (!src) {
      await wait(PLACEHOLDER_VIDEO_MS)
      this.setMode('closed')
      return
    }

    const video = this.goodbyeVideo
    const deadline = this.playbackDeadlineMs(video)
    await Promise.race([
      this.playVideo(video, src, this.goodbyeLoaded, () => {
        this.goodbyeLoaded = true
      }),
      wait(deadline),
    ])
    this.setMode('closed')
  }

  destroy(): void {
    this.pauseAllVideos()
    this.greetingVideo.removeAttribute('src')
    this.goodbyeVideo.removeAttribute('src')
  }

  private ensureGreetingSource(src: string): void {
    if (this.greetingVideo.getAttribute('src') === src) return
    this.greetingVideo.preload = 'auto'
    this.greetingVideo.src = src
    this.greetingVideo.load()
    this.greetingLoaded = true
  }

  private playbackDeadlineMs(video: HTMLVideoElement): number {
    const durationSec = video.duration
    if (Number.isFinite(durationSec) && durationSec > 0) {
      return Math.min(durationSec * 1000 + 2500, PLAYBACK_MAX_MS)
    }
    return PLAYBACK_FALLBACK_MS
  }

  private waitForStartFrame(
    video: HTMLVideoElement,
    src: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      let seekTimer = 0

      const finish = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        window.clearTimeout(seekTimer)
        video.removeEventListener('loadeddata', onData)
        video.removeEventListener('canplay', onData)
        video.removeEventListener('seeked', onSeeked)
        video.removeEventListener('error', onError)
        resolve()
      }

      const revealWhenAtStart = () => {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
        if (video.currentTime > 0.05) {
          video.addEventListener('seeked', onSeeked)
          seekTimer = window.setTimeout(finish, 2000)
          video.currentTime = 0
          return
        }
        finish()
      }

      const onData = () => revealWhenAtStart()
      const onSeeked = () => finish()
      const onError = () => {
        console.warn('Door video failed to load:', src)
        finish()
      }

      const timer = window.setTimeout(finish, VIDEO_READY_TIMEOUT_MS)
      video.addEventListener('loadeddata', onData)
      video.addEventListener('canplay', onData)
      video.addEventListener('error', onError)
      revealWhenAtStart()
    })
  }

  private pauseAllVideos(): void {
    for (const video of [this.greetingVideo, this.goodbyeVideo]) {
      video.pause()
      video.currentTime = 0
    }
  }

  private playVideo(
    video: HTMLVideoElement,
    src: string,
    alreadyLoaded: boolean,
    onLoaded: () => void,
    options?: { onPlaying?: () => void },
  ): Promise<void> {
    return new Promise((resolve) => {
      let finished = false
      let startWatchdog = 0
      let playbackWatchdog = 0
      let canplayRetryTimer = 0

      const cleanup = () => {
        window.clearTimeout(startWatchdog)
        window.clearTimeout(playbackWatchdog)
        window.clearTimeout(canplayRetryTimer)
        video.removeEventListener('ended', onEnded)
        video.removeEventListener('error', onError)
        video.removeEventListener('playing', onPlaying)
        video.removeEventListener('canplay', onCanplayRetry)
      }

      const finish = () => {
        if (finished) return
        finished = true
        cleanup()
        video.pause()
        resolve()
      }

      const onEnded = () => finish()

      const onError = () => {
        console.warn('Door video failed to play:', src)
        finish()
      }

      const armPlaybackWatchdog = () => {
        window.clearTimeout(playbackWatchdog)
        playbackWatchdog = window.setTimeout(() => {
          console.warn('Door video playback timed out:', src)
          finish()
        }, this.playbackDeadlineMs(video))
      }

      const onPlaying = () => {
        window.clearTimeout(startWatchdog)
        options?.onPlaying?.()
        armPlaybackWatchdog()
      }

      const onCanplayRetry = () => {
        window.clearTimeout(canplayRetryTimer)
        video.removeEventListener('canplay', onCanplayRetry)
        void video.play().catch(() => onError())
      }

      const tryPlay = () => {
        this.greetingPrimeSettled = true
        video.muted = false
        const playPromise = video.play()
        if (!playPromise) return
        void playPromise.catch(() => {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            void video.play().catch(() => onError())
            return
          }
          canplayRetryTimer = window.setTimeout(
            () => onError(),
            CANPLAY_RETRY_TIMEOUT_MS,
          )
          video.addEventListener('canplay', onCanplayRetry)
        })
      }

      video.addEventListener('ended', onEnded)
      video.addEventListener('error', onError)
      video.addEventListener('playing', onPlaying)

      startWatchdog = window.setTimeout(() => {
        console.warn('Door video never started playing:', src)
        finish()
      }, PLAY_START_TIMEOUT_MS)

      if (video.getAttribute('src') !== src) {
        video.preload = 'auto'
        video.src = src
        video.load()
        onLoaded()
      } else if (!alreadyLoaded) {
        onLoaded()
      }

      if (video.currentTime > 0.05) {
        video.currentTime = 0
      }

      tryPlay()
    })
  }
}
