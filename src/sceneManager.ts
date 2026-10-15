import gsap from 'gsap'
import type { Scene, SceneFactory, SceneId } from './scenes/types'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export class SceneManager {
  private readonly host: HTMLElement
  private readonly factories: Map<SceneId, SceneFactory>
  private current: Scene | null = null
  private root: HTMLElement | null = null
  private isTransitioning = false
  private activeId: SceneId | null = null

  constructor(host: HTMLElement, factories: Record<SceneId, SceneFactory>) {
    this.host = host
    this.factories = new Map(
      Object.entries(factories) as [SceneId, SceneFactory][],
    )
  }

  start(id: SceneId): void {
    void this.transitionTo(id, true)
  }

  transitionTo(id: SceneId, immediate = false): void {
    if (this.isTransitioning) return
    if (this.activeId === id && this.current) return

    const factory = this.factories.get(id)
    if (!factory) {
      console.warn(`Unknown scene: ${id}`)
      return
    }

    this.isTransitioning = true
    const duration = prefersReducedMotion() || immediate ? 0 : 0.35

    const mountNext = () => {
      this.current?.unmount()
      this.current = null
      this.root?.remove()

      const root = document.createElement('div')
      root.className = 'scene-root'
      root.style.opacity = '0'
      this.host.appendChild(root)
      this.root = root

      const scene = factory((nextId) => this.transitionTo(nextId))
      scene.mount(root)
      this.current = scene
      this.activeId = id

      gsap.to(root, {
        opacity: 1,
        duration,
        ease: 'power1.out',
        onComplete: () => {
          this.isTransitioning = false
        },
      })
    }

    if (this.root && duration > 0) {
      gsap.to(this.root, {
        opacity: 0,
        duration,
        ease: 'power1.in',
        onComplete: mountNext,
      })
    } else {
      mountNext()
    }
  }
}
