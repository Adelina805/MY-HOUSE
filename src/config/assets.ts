/**
 * Media paths for MY HOUSE.
 *
 * Drop your files under public/media/… and set the paths below.
 * Leave a string empty to use the built-in CSS placeholder for that slot.
 *
 * Examples once you have art:
 *   doorstep.house: '/media/doorstep/house.jpg'
 *   greeting.video: '/media/greeting/intro.mp4'
 *   candy.bowl:     '/media/candy/bowl.png'
 *   goodbye.video:  '/media/goodbye/closing.mp4'
 */
export const assets = {
  doorstep: {
    /** Full-scene house / front-door image. Empty = CSS facade. */
    house: '',
  },
  greeting: {
    /** Pre-recorded greeting video. Empty = text placeholder. */
    video: '',
  },
  candy: {
    /** Candy bowl image. Empty = CSS bowl shape. */
    bowl: '',
  },
  goodbye: {
    /** Closing video. Empty = text placeholder. */
    video: '',
  },
} as const
