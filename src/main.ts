import './styles/global.css'
import './styles/door.css'
import './styles/candy.css'

import { inject } from '@vercel/analytics'

import { ExperienceController } from './core/experienceController'
import { preloadBootImages, waitForNextPaint } from './core/preloadAssets'

inject()

const mount = document.querySelector<HTMLDivElement>('#app')
if (!mount) {
  throw new Error('#app mount point not found')
}

async function boot(app: HTMLDivElement): Promise<void> {
  app.classList.add('app--booting')

  try {
    await preloadBootImages()
  } catch (error) {
    console.warn('Image preload failed:', error)
  }

  const experience = new ExperienceController(app)
  experience.start()
  await waitForNextPaint()
  app.classList.remove('app--booting')
}

void boot(mount)
