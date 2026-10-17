import { assets } from '../../config/assets'

const PLACEHOLDER_VIDEO_MS = 400
const VIDEO_READY_TIMEOUT_MS = 8000

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
  }

  /** Call synchronously from the knock click so iOS keeps user activation for playback. */
  primeGreetingPlayback(): void {
    const src = assets.door.greetingVideo
    if (!src) return

    this.ensureGreetingSource(src)
    this.setMode('greeting-loading')
    const playPromise = this.greetingVideo.play()
    if (playPromise) {
      playPromise
        .then(() => {
          this.greetingVideo.pause()
          this.greetingVideo.currentTime = 0
        })
        .catch(() => {})
    }
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

    this.ensureGreetingSource(src)
    this.setMode('greeting-loading')

    await this.waitForStartFrame(this.greetingVideo, src)
    this.setMode('greeting')

    await this.playVideo(this.greetingVideo, src, this.greetingLoaded, () => {
      this.greetingLoaded = true
    })
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

    await this.playVideo(this.goodbyeVideo, src, this.goodbyeLoaded, () => {
      this.goodbyeLoaded = true
    })
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
    this.greetingLoaded = true
  }

  private waitForStartFrame(
    video: HTMLVideoElement,
    src: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
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
  ): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        video.removeEventListener('ended', onEnded)
        video.removeEventListener('error', onError)
        video.pause()
        resolve()
      }

      const onEnded = () => finish()
      const onError = () => {
        console.warn('Door video failed to play:', src)
        finish()
      }

      video.addEventListener('ended', onEnded)
      video.addEventListener('error', onError)

      if (video.getAttribute('src') !== src) {
        video.src = src
        onLoaded()
      } else if (!alreadyLoaded) {
        onLoaded()
      }

      if (video.currentTime > 0.05) {
        video.currentTime = 0
      }

      const startPlayback = () => {
        const playPromise = video.play()
        if (!playPromise) return
        playPromise.catch(() => {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            void video.play().catch(() => onError())
            return
          }
          const retry = () => {
            video.removeEventListener('canplay', retry)
            void video.play().catch(() => onError())
          }
          video.addEventListener('canplay', retry)
        })
      }

      startPlayback()
    })
  }
}
