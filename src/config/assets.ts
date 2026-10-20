/**
 * Media paths for MY HOUSE.
 *
 * Drop files under public/media/… and set paths below.
 * Leave a string empty to use the built-in CSS placeholder for that slot.
 */
export const assets = {
  /** Shared wall texture behind the whole experience. Empty = scene media includes the wall. */
  wall: '',
  splash: {
    /** Full-bleed intro background. Shown once on page load, then fades to the door. */
    background: '/media/doorstep/blue-seaweed.png',
  },
  door: {
    /** Texture behind the doorway. Empty = solid --door-scene-bg. */
    wall: '/media/doorstep/wall.jpg',
    /** Closed door still (includes surrounding wall in frame). */
    image: '/media/doorstep/closed.png',
    greetingVideo: '/media/doorstep/hello.mp4',
    goodbyeVideo: '/media/doorstep/goodbye.mp4',
    greetingCaptions: '/captions/hello.vtt',
    goodbyeCaptions: '/captions/goodbye.vtt',
  },
  candy: {
    image: '/media/candy/bowl.png',
  },
  hands: {
    left: '/media/hands/left-hand.png',
    right: '/media/hands/right-hand.png',
  },
  audio: {
    /** Knock sound. Empty = silent knock animation only. */
    knock: '',
  },
} as const
