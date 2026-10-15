import './styles/global.css'
import './styles/door.css'
import './styles/candy.css'

import { ExperienceController } from './core/experienceController'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('#app mount point not found')
}

const experience = new ExperienceController(app)
experience.start()
