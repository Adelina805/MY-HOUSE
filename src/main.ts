import './styles/global.css'
import './styles/door.css'
import './styles/candy.css'
import './styles/splash.css'
import './styles/hands.css'
import './styles/announcement.css'
import './styles/controls.css'
import './styles/guestbook.css'

import { inject } from '@vercel/analytics'

import { frame } from './config/composition'
import { isDevStartAtCandy } from './config/bowlLayout'
import { applyCandyBowlDebug } from './core/candyBowlDebug'
import { ExperienceController } from './core/experienceController'
import { preloadBootImages, waitForNextPaint } from './core/preloadAssets'
import { createSplashScreen, playSplashIntro } from './core/splashScreen'

inject()

// iOS Safari often ignores touch-action for double-tap zoom; block dblclick.
document.addEventListener(
  'dblclick',
  (event) => {
    event.preventDefault()
  },
  { passive: false },
)

const mount = document.querySelector<HTMLDivElement>('#app')
if (!mount) {
  throw new Error('#app mount point not found')
}

function applyFrameTokens(): void {
  const root = document.documentElement
  root.style.setProperty('--frame-color', frame.color)
  root.style.setProperty('--frame-thickness', `${frame.thicknessDesktopPx}px`)
  root.style.setProperty(
    '--frame-thickness-mobile',
    `${frame.thicknessMobilePx}px`,
  )
}

async function boot(app: HTMLDivElement): Promise<void> {
  applyFrameTokens()
  app.classList.add('app--booting')

  const splash = createSplashScreen()
  app.appendChild(splash)

  try {
    await preloadBootImages()
  } catch (error) {
    console.warn('Image preload failed:', error)
  }

  const experience = new ExperienceController(app)
  experience.start()
  applyCandyBowlDebug(app)
  if (isDevStartAtCandy()) {
    experience.devEnterCandyScene()
  }
  await waitForNextPaint()
  app.classList.remove('app--booting')
  experience.showControls()
  await playSplashIntro(splash)
  if (isDevStartAtCandy()) {
    experience.startCandyIdleGoodbyeTimer()
  }
}

void boot(mount)
