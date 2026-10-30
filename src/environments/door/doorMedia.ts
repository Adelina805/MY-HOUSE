import { assets } from '../../config/assets'
import {
  isSoundMuted,
  registerMediaElement,
  restoreMediaMute,
} from '../../core/soundState'

const PLACEHOLDER_VIDEO_MS = 400
const VIDEO_READY_TIMEOUT_MS = 8000
/** Cold mobile loads of ~13MB goodbye need more than a few seconds. */
const PLAY_START_TIMEOUT_MS = 12_000
const CANPLAY_RETRY_TIMEOUT_MS = 4000
const PLAYBACK_FALLBACK_MS = 20_000
const PLAYBACK_MAX_MS = 30_000

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function isAutoplayBlocked(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  if (name === 'NotAllowedError') return true
  const message = 'message' in error ? String(error.message) : ''
  return /not allowed|user.*(gesture|interact)/i.test(message)
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
  /** Once real greeting playback starts, ignore stale muted primes. */
  private greetingPrimeSettled = false
  /** Bumps on each prime and when real playback starts so stale primes cannot pause the video. */
  private greetingPrimeGeneration = 0
  private greetingPlayInProgress = false
  /** Once real goodbye playback starts, ignore stale muted primes. */
  private goodbyePrimeSettled = false
  private goodbyePrimeGeneration = 0
  private goodbyePlayInProgress = false
  private unregisterGreetingSound: (() => void) | null = null
  private unregisterGoodbyeSound: (() => void) | null = null
  private skipActivePlayback: (() => void) | null = null
  /** Bumps when a playVideo session ends so late play()/retry promises are no-ops. */
  private playbackGeneration = 0
  /** Brief listener that re-silences iOS ghost `playing` after skip/abort. */
  private ghostPlayGuard: {
    video: HTMLVideoElement
    generation: number
    timer: number
    onPlaying: () => void
  } | null = null
  private onSkipVisibleChange: ((visible: boolean) => void) | null = null
  private onCaptionVideoChange:
    | ((video: HTMLVideoElement | null, vttUrl: string | null) => void)
    | null = null

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

    this.attachCaptionTrack(
      this.greetingVideo,
      assets.door.greetingCaptions,
    )
    this.attachCaptionTrack(
      this.goodbyeVideo,
      assets.door.goodbyeCaptions,
    )

    this.unregisterGreetingSound = registerMediaElement(this.greetingVideo)
    this.unregisterGoodbyeSound = registerMediaElement(this.goodbyeVideo)

    this.goodbyeVideo.preload = 'none'
    this.greetingVideo.preload = 'none'
    if (assets.door.greetingVideo) {
      this.ensureGreetingSource(assets.door.greetingVideo)
    }
  }

  /** Call synchronously from the knock click (before any await) for iOS playback. */
  primeGreetingPlayback(): void {
    if (this.greetingPlayInProgress) return

    const mode = this.mediaRoot.dataset.mode as DoorMediaMode
    if (
      mode === 'greeting' ||
      mode === 'greeting-hold' ||
      mode === 'goodbye'
    ) {
      return
    }

    const src = assets.door.greetingVideo
    if (!src) return

    const video = this.greetingVideo
    const generation = ++this.greetingPrimeGeneration
    this.ensureGreetingSource(src)
    this.setMode('greeting-loading')
    video.muted = true
    const playPromise = video.play()
    if (!playPromise) {
      restoreMediaMute(video)
      return
    }
    void playPromise
      .then(() => {
        if (generation !== this.greetingPrimeGeneration) return
        if (this.greetingPrimeSettled) return
        video.pause()
        video.currentTime = 0
      })
      .catch(() => {})
      .finally(() => {
        if (generation !== this.greetingPrimeGeneration) return
        if (!this.greetingPrimeSettled) {
          restoreMediaMute(video)
        }
      })
  }

  /**
   * Call synchronously from candy plunge/grab gestures so iOS will allow
   * unmuted (or at least primed) goodbye playback after async announcement.
   * Does not change door media mode — candy scene is still active.
   */
  primeGoodbyePlayback(): void {
    if (this.goodbyePlayInProgress) return

    const mode = this.mediaRoot.dataset.mode as DoorMediaMode
    if (mode === 'goodbye') return

    const src = assets.door.goodbyeVideo
    if (!src) return

    const video = this.goodbyeVideo
    const generation = ++this.goodbyePrimeGeneration
    this.ensureGoodbyeSource(src)
    video.muted = true
    const playPromise = video.play()
    if (!playPromise) {
      restoreMediaMute(video)
      return
    }
    void playPromise
      .then(() => {
        if (generation !== this.goodbyePrimeGeneration) return
        if (this.goodbyePrimeSettled) return
        video.pause()
        video.currentTime = 0
      })
      .catch(() => {})
      .finally(() => {
        if (generation !== this.goodbyePrimeGeneration) return
        if (!this.goodbyePrimeSettled) {
          restoreMediaMute(video)
        }
      })
  }

  /** Start buffering goodbye during the candy scene (before the outro plays). */
  preloadGoodbye(): void {
    const src = assets.door.goodbyeVideo
    if (!src) return
    this.ensureGoodbyeSource(src)
  }

  setSkipVisibleHandler(handler: (visible: boolean) => void): void {
    this.onSkipVisibleChange = handler
  }

  setCaptionVideoHandler(
    handler: (video: HTMLVideoElement | null, vttUrl: string | null) => void,
  ): void {
    this.onCaptionVideoChange = handler
  }

  requestSkip(): void {
    this.skipActivePlayback?.()
    // iOS can keep decoding audio after pause if a pending play() settles late.
    this.silenceAndPause(this.greetingVideo)
    this.silenceAndPause(this.goodbyeVideo)
  }

  setMode(mode: DoorMediaMode): void {
    // Visual only — seeking/pausing here flashes a frame on iOS after goodbye ends.
    this.mediaRoot.dataset.mode = mode
  }

  /**
   * Show the closed-door still. Pass `resetPlayback` when starting a new visit
   * so videos seek to frame 0; omit it after goodbye so iOS does not flash.
   */
  showClosed(options?: { resetPlayback?: boolean }): void {
    this.invalidateGreetingPrime()
    this.invalidateGoodbyePrime()
    this.clearGhostPlayGuard()
    this.setMode('closed')
    if (options?.resetPlayback) {
      this.pauseAllVideos()
      return
    }
    this.silenceAndPause(this.greetingVideo)
    this.silenceAndPause(this.goodbyeVideo)
  }

  /**
   * Arm goodbye on frame 0 and switch media mode before the door fades in,
   * so the candy→door crossfade never flashes the closed-door still.
   */
  async prepareForGoodbye(): Promise<void> {
    const src = assets.door.goodbyeVideo
    if (!src) {
      this.showClosed()
      return
    }

    this.greetingVideo.pause()
    this.ensureGoodbyeSource(src)

    const video = this.goodbyeVideo
    video.pause()
    this.setMode('goodbye')
    await this.waitForStartFrame(video, src)
  }

  holdGreetingEndFrame(): void {
    this.silenceAndPause(this.greetingVideo)
    this.setMode('greeting-hold')
  }

  async playGreeting(): Promise<void> {
    this.greetingPlayInProgress = true
    this.invalidateGreetingPrime()
    this.silenceAndPause(this.goodbyeVideo)
    this.goodbyeVideo.currentTime = 0

    try {
      const src = assets.door.greetingVideo
      if (!src) {
        await wait(PLACEHOLDER_VIDEO_MS)
        this.holdGreetingEndFrame()
        return
      }

      const video = this.greetingVideo
      restoreMediaMute(video)

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
            captionsUrl: assets.door.greetingCaptions,
            markPrimeSettled: () => {
              this.greetingPrimeSettled = true
            },
          },
        ),
        wait(deadline),
      ])

      // Deadline winning leaves playVideo alive — tear it down so retries cannot resume audio.
      this.skipActivePlayback?.()
      this.holdGreetingEndFrame()
    } finally {
      this.greetingPlayInProgress = false
    }
  }

  async playGoodbye(): Promise<void> {
    this.goodbyePlayInProgress = true
    this.invalidateGoodbyePrime()
    this.silenceAndPause(this.greetingVideo)

    try {
      const src = assets.door.goodbyeVideo
      if (!src) {
        await wait(PLACEHOLDER_VIDEO_MS)
        this.setMode('closed')
        return
      }

      const video = this.goodbyeVideo
      restoreMediaMute(video)
      this.ensureGoodbyeSource(src)
      this.setMode('goodbye')

      await this.waitForStartFrame(video, src)

      const deadline = this.playbackDeadlineMs(video)
      await Promise.race([
        this.playVideo(
          video,
          src,
          this.goodbyeLoaded,
          () => {
            this.goodbyeLoaded = true
          },
          {
            captionsUrl: assets.door.goodbyeCaptions,
            markPrimeSettled: () => {
              this.goodbyePrimeSettled = true
            },
            // Hide goodbye before pause — iOS often snaps a visible frame
            // on pause while data-mode is still 'goodbye'. Do not seek here.
            onBeforeSilence: () => this.setMode('closed'),
          },
        ),
        wait(deadline),
      ])
      this.skipActivePlayback?.()
      this.setMode('closed')
    } finally {
      this.goodbyePlayInProgress = false
    }
  }

  destroy(): void {
    this.clearGhostPlayGuard()
    this.clearCaptionVideo()
    this.setSkipVisible(false)
    this.skipActivePlayback = null
    this.unregisterGreetingSound?.()
    this.unregisterGoodbyeSound?.()
    this.unregisterGreetingSound = null
    this.unregisterGoodbyeSound = null
    this.pauseAllVideos()
    this.greetingVideo.removeAttribute('src')
    this.goodbyeVideo.removeAttribute('src')
  }

  private attachCaptionTrack(
    video: HTMLVideoElement,
    trackUrl: string,
  ): void {
    if (!trackUrl) return
    const track = document.createElement('track')
    track.kind = 'captions'
    track.srclang = 'en'
    track.label = 'English'
    track.src = trackUrl
    track.default = true
    video.appendChild(track)

    const hideNativeCaptions = (): void => {
      for (const textTrack of video.textTracks) {
        textTrack.mode = 'hidden'
      }
    }

    video.textTracks.addEventListener('addtrack', hideNativeCaptions)
    video.addEventListener('loadedmetadata', hideNativeCaptions)
    hideNativeCaptions()
  }

  private setSkipVisible(visible: boolean): void {
    this.onSkipVisibleChange?.(visible)
  }

  private clearCaptionVideo(): void {
    this.onCaptionVideoChange?.(null, null)
  }

  private notifyCaptionVideo(
    video: HTMLVideoElement,
    vttUrl: string | null,
  ): void {
    this.onCaptionVideoChange?.(video, vttUrl)
  }

  private invalidateGreetingPrime(): void {
    this.greetingPrimeGeneration += 1
    this.greetingPrimeSettled = false
  }

  private invalidateGoodbyePrime(): void {
    this.goodbyePrimeGeneration += 1
    this.goodbyePrimeSettled = false
  }

  private ensureGreetingSource(src: string): void {
    if (this.greetingVideo.getAttribute('src') === src) return
    this.greetingVideo.preload = 'auto'
    this.greetingVideo.src = src
    this.greetingVideo.load()
    this.greetingLoaded = true
  }

  private ensureGoodbyeSource(src: string): void {
    if (this.goodbyeVideo.getAttribute('src') === src) return
    this.goodbyeVideo.preload = 'auto'
    this.goodbyeVideo.src = src
    this.goodbyeVideo.load()
    this.goodbyeLoaded = true
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

  /** Mute before pause — on iOS, pause alone often leaves audio running after a late play(). */
  private silenceAndPause(video: HTMLVideoElement): void {
    video.muted = true
    video.pause()
  }

  private clearGhostPlayGuard(): void {
    if (!this.ghostPlayGuard) return
    window.clearTimeout(this.ghostPlayGuard.timer)
    this.ghostPlayGuard.video.removeEventListener(
      'playing',
      this.ghostPlayGuard.onPlaying,
    )
    this.ghostPlayGuard = null
  }

  /**
   * After skip/abort, iOS may fire `playing` from a pending play() that settled late.
   * Re-silence for a short window without blocking the next intentional playback.
   */
  private armGhostPlayGuard(video: HTMLVideoElement): void {
    this.clearGhostPlayGuard()
    const generation = this.playbackGeneration
    const onPlaying = (): void => {
      if (generation !== this.playbackGeneration) return
      this.silenceAndPause(video)
    }
    video.addEventListener('playing', onPlaying)
    const timer = window.setTimeout(() => {
      if (this.ghostPlayGuard?.onPlaying === onPlaying) {
        this.clearGhostPlayGuard()
      }
    }, 2500)
    this.ghostPlayGuard = { video, generation, timer, onPlaying }
  }

  private pauseAllVideos(): void {
    for (const video of [this.greetingVideo, this.goodbyeVideo]) {
      this.silenceAndPause(video)
      video.currentTime = 0
    }
  }

  private playVideo(
    video: HTMLVideoElement,
    src: string,
    alreadyLoaded: boolean,
    onLoaded: () => void,
    options?: {
      onPlaying?: () => void
      captionsUrl?: string
      markPrimeSettled?: () => void
      onBeforeSilence?: () => void
    },
  ): Promise<void> {
    return new Promise((resolve) => {
      this.clearGhostPlayGuard()
      const generation = ++this.playbackGeneration
      let finished = false
      let startWatchdog = 0
      let playbackWatchdog = 0
      let canplayRetryTimer = 0
      let forcedMute = false

      const isStale = (): boolean =>
        finished || generation !== this.playbackGeneration

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
        // Invalidate late play()/retry promises from this session.
        this.playbackGeneration += 1
        cleanup()
        this.skipActivePlayback = null
        this.setSkipVisible(false)
        this.clearCaptionVideo()
        options?.onBeforeSilence?.()
        this.silenceAndPause(video)
        this.armGhostPlayGuard(video)
        resolve()
      }

      this.skipActivePlayback = finish

      const onEnded = () => {
        if (isStale()) return
        finish()
      }

      const onError = () => {
        if (isStale()) return
        console.warn('Door video failed to play:', src)
        finish()
      }

      const armPlaybackWatchdog = () => {
        window.clearTimeout(playbackWatchdog)
        playbackWatchdog = window.setTimeout(() => {
          if (isStale()) return
          console.warn('Door video playback timed out:', src)
          finish()
        }, this.playbackDeadlineMs(video))
      }

      const onPlaying = () => {
        if (isStale()) return
        window.clearTimeout(startWatchdog)
        options?.onPlaying?.()
        this.setSkipVisible(true)
        this.notifyCaptionVideo(video, options?.captionsUrl ?? null)
        armPlaybackWatchdog()
      }

      const playWithMuteFallback = (): void => {
        if (isStale()) return

        options?.markPrimeSettled?.()
        if (!forcedMute) {
          restoreMediaMute(video)
        } else {
          video.muted = true
        }

        const playPromise = video.play()
        if (!playPromise) return

        void playPromise
          .then(() => {
            // Late resolve after skip/finish — kill audio that iOS may have restarted.
            if (isStale()) {
              this.silenceAndPause(video)
            }
          })
          .catch((error: unknown) => {
            if (isStale()) return

            // iOS/Safari often blocks unmuted play after async gaps; muted is allowed.
            if (!forcedMute && !isSoundMuted() && isAutoplayBlocked(error)) {
              forcedMute = true
              video.muted = true
              void video
                .play()
                .then(() => {
                  if (isStale()) {
                    this.silenceAndPause(video)
                    return
                  }
                  // Stay muted — unmuting without a gesture pauses on iOS.
                  // Sound toggle is a user gesture and will sync unmute later.
                })
                .catch(() => {
                  if (isStale()) return
                  scheduleCanplayRetry()
                })
              return
            }

            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              void video
                .play()
                .then(() => {
                  if (isStale()) this.silenceAndPause(video)
                })
                .catch(() => {
                  if (!isStale()) onError()
                })
              return
            }

            scheduleCanplayRetry()
          })
      }

      const scheduleCanplayRetry = () => {
        if (isStale()) return
        window.clearTimeout(canplayRetryTimer)
        video.removeEventListener('canplay', onCanplayRetry)
        canplayRetryTimer = window.setTimeout(() => {
          if (isStale()) return
          onError()
        }, CANPLAY_RETRY_TIMEOUT_MS)
        video.addEventListener('canplay', onCanplayRetry)
      }

      const onCanplayRetry = () => {
        if (isStale()) return
        window.clearTimeout(canplayRetryTimer)
        video.removeEventListener('canplay', onCanplayRetry)
        playWithMuteFallback()
      }

      video.addEventListener('ended', onEnded)
      video.addEventListener('error', onError)
      video.addEventListener('playing', onPlaying)

      startWatchdog = window.setTimeout(() => {
        if (isStale()) return
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

      playWithMuteFallback()
    })
  }
}
