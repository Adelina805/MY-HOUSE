import { assets } from '../config/assets'

function imageUrlsForBoot(): string[] {
  const urls: string[] = []
  if (assets.wall) urls.push(assets.wall)
  if (assets.splash.background) urls.push(assets.splash.background)
  if (assets.door.wall) urls.push(assets.door.wall)
  if (assets.door.image) urls.push(assets.door.image)
  if (assets.candy.image) urls.push(assets.candy.image)
  urls.push(assets.hands.left, assets.hands.right)
  return [...new Set(urls)]
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      if (typeof img.decode === 'function') {
        void img.decode().then(() => resolve()).catch(() => resolve())
        return
      }
      resolve()
    }
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

/** Decode door/wall (and candy) before first paint so layers appear together. */
export async function preloadBootImages(): Promise<void> {
  const urls = imageUrlsForBoot()
  if (urls.length === 0) return
  await Promise.all(urls.map((url) => loadImage(url)))
}

export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}
