export type SceneId = 'doorstep' | 'greeting' | 'candy' | 'goodbye'

export type GoToScene = (id: SceneId) => void

export interface Scene {
  readonly id: SceneId
  mount(container: HTMLElement): void
  unmount(): void
}

export type SceneFactory = (goTo: GoToScene) => Scene
