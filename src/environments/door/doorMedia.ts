import { assets } from '../../config/assets'

const PLACEHOLDER_VIDEO_MS = 400

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export type DoorMediaMode = 'closed' | 'greeting' | 'goodbye'

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

    this.greetingVideo.playsInline = true
    this.goodbyeVideo.playsInline = true
    this.greetingVideo.preload = 'none'
    this.goodbyeVideo.preload = 'none'
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

  async playGreeting(): Promise<void> {
    this.pauseAllVideos()
    this.setMode('greeting')

    const src = assets.door.greetingVideo
    if (!src) {
      await wait(PLACEHOLDER_VIDEO_MS)
      this.setMode('closed')
      return
    }

    await this.playVideo(this.greetingVideo, src, this.greetingLoaded, () => {
      this.greetingLoaded = true
    })
    this.setMode('closed')
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

      if (!alreadyLoaded || video.getAttribute('src') !== src) {
        video.src = src
        onLoaded()
      }

      video.currentTime = 0
      const playPromise = video.play()
      if (playPromise) {
        playPromise.catch(() => {
          onError()
        })
      }
    })
  }
}
