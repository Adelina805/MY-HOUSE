/**
 * Media paths for MY HOUSE.
 *
 * Drop files under public/media/… and set paths below.
 * Leave a string empty to use the built-in CSS placeholder for that slot.
 */
export const assets = {
  /** Shared wall texture behind the whole experience. Empty = flat neutral fill. */
  wall: '/media/wall.jpg',
  door: {
    /** Closed door image (centered, 2.2:1 height-to-width). */
    image: '/media/door.webp',
    /** Greeting video (plays inside the same door frame). */
    greetingVideo: '',
    /** Goodbye video (same door frame). */
    goodbyeVideo: '',
  },
  candy: {
    /** Optional candy-only backdrop override. Empty = use shared wall only. */
    background: '',
    /** Bowl image. Empty = CSS bowl shape. */
    bowlImage: '',
  },
  audio: {
    /** Knock sound. Empty = silent knock animation only. */
    knock: '',
  },
} as const
