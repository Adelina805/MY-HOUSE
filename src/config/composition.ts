/**
 * Responsive framing for photographic door and candy scenes.
 * Tune desktop/mobile object-position and hit areas to match Figma crops.
 */
export const frame = {
  color: '#2e2e2e',
  thicknessDesktopPx: 20,
  thicknessMobilePx: 10,
} as const

/**
 * Door layout tokens live in src/styles/door.css on .environment--door.
 * Frame sizing authority: .door__doorway-frame (not the viewport).
 */
export const doorScene = {
  sourceWidth: 1248,
  sourceHeight: 2870,
  objectFit: 'cover' as const,
} as const

export const candyScene = {
  objectFit: 'cover' as const,
  desktopObjectPosition: 'center 55%',
  mobileObjectPosition: 'center 48%',
} as const
