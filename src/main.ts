import './styles/global.css'
import './styles/scenes.css'
import './styles/doorstep.css'

import { SceneManager } from './sceneManager'
import { createCandyScene } from './scenes/candy/candyScene'
import { createDoorstepScene } from './scenes/doorstep/doorstepScene'
import { createGoodbyeScene } from './scenes/goodbye/goodbyeScene'
import { createGreetingScene } from './scenes/greeting/greetingScene'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('#app mount point not found')
}

const manager = new SceneManager(app, {
  doorstep: createDoorstepScene,
  greeting: createGreetingScene,
  candy: createCandyScene,
  goodbye: createGoodbyeScene,
})

manager.start('doorstep')
