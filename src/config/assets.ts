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
    /** Lined notebook paper (torn edge + tape) for the guestbook note. */
    paperImage: '/media/doorstep/paper.png',
  },
  candy: {
    image: '/media/candy/bowl.png',
  },
  hands: {
    left: '/media/hands/left-hand.png',
    right: '/media/hands/right-hand.png',
    /** Closed fist for knocking. Empty = keep open hand during knock animation. */
    fist: '/media/hands/knock.png',
    /** Both palms cupped — prize reveal only. */
    cupped: '/media/hands/hands.png',
  },
  audio: {
    /** Knock sound. Empty = silent knock animation only. */
    knock: '/media/doorstep/knock.mov',
    /** Paper swish when opening/closing the guestbook. Empty = silent. */
    paper: '/media/doorstep/paper.wav',
    /** Prize announcement sting. Empty = silent announcement. */
    prize: '/media/candy/duolingo-level-complete.mp3',
    /** Bowl rummage loop while the cursor moves/taps. Empty = silent. */
    rummage: '/media/candy/rummage.mp3',
  },
  effects: {
    /** White radial burst behind cupped hands during prize announcement. */
    feature: '/media/effects/feature.png',
  },
} as const
