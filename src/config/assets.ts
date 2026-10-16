/**
 * Media paths for MY HOUSE.
 *
 * Drop files under public/media/… and set paths below.
 * Leave a string empty to use the built-in CSS placeholder for that slot.
 */
export const assets = {
  /** Shared wall texture behind the whole experience. Empty = scene media includes the wall. */
  wall: '',
  door: {
    /** Closed door still (includes surrounding wall in frame). */
    image: '/media/doorstep/closed.png',
    greetingVideo: '/media/doorstep/hello.mp4',
    goodbyeVideo: '/media/doorstep/goodbye.mp4',
  },
  candy: {
    image: '/media/candy/bowl.png',
  },
  audio: {
    /** Knock sound. Empty = silent knock animation only. */
    knock: '',
  },
} as const
