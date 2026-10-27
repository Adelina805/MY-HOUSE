import gsap from 'gsap'
import { getBowlBoundaryRadii } from '../../config/bowlBoundaryRuntime'
import { candyBowlConfig as config } from '../../config/candyBowl'
import {
  clearSessionPrize,
  fallbackPrize,
  getSessionPrize,
  prizeFromBowlObjectStyle,
  setSessionPrize,
  type Prize,
} from '../../config/prizeCatalog'
import type { CuppedRevealElements } from '../../core/handsOverlay'

export type CandyInteractionState =
  | 'idle'
  | 'plunging'
  | 'rummaging'
  | 'grabbing'
  | 'revealing'

export interface CandyRummageOptions {
  overlay: HTMLElement
  leftHand: HTMLImageElement
  rightHand: HTMLImageElement
  cuppedReveal: CuppedRevealElements
  getBowlTarget: () => HTMLElement | null
  getObjectsRoot: () => HTMLElement | null
  getObjectsFrontRoot: () => HTMLElement | null
  onPrizeRevealed?: (prize: Prize) => void
  /** Fired when the visitor first plunges into the bowl (cancels idle auto-goodbye). */
  onPlungeStart?: () => void
}

export interface CandyRummageController {
  bind(): void
  dispose(): void
  reset(): void
  respawnObjects(): void
  getState(): CandyInteractionState
  beginPlungeFromKeyboard(): void
  tryGrabFromKeyboard(): void
  /** Stop rummage input and candy objects; keep cupped hands + prize visible. */
  detachRummageForGoodbye(): void
  isCuppedRevealActive(): boolean
  dismissCuppedReveal(): void
  /** Lock cupped hands visible after GSAP reveal (clears inline transform conflicts). */
  commitCuppedReveal(): void
  /** Idle / auto-goodbye path — cupped outro with fallback prize, then `onPrizeRevealed`. */
  beginCuppedOutroForGoodbye(): boolean
}

type ObjectLayer = 'behind' | 'front'

interface BowlObject {
  el: HTMLElement
  layer: ObjectLayer
  x: number
  y: number
  baseX: number
  baseY: number
  size: number
}

interface RummagePose {
  scale: number
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function overlayPoint(
  clientX: number,
  clientY: number,
  overlay: HTMLElement,
): { x: number; y: number } {
  const rect = overlay.getBoundingClientRect()
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function fingertipInOverlay(
  hand: HTMLElement,
  overlay: HTMLElement,
  ratios: { x: number; y: number },
): { x: number; y: number } {
  const handRect = hand.getBoundingClientRect()
  const overlayRect = overlay.getBoundingClientRect()
  return {
    x: handRect.left - overlayRect.left + handRect.width * ratios.x,
    y: handRect.top - overlayRect.top + handRect.height * ratios.y,
  }
}

function xyForFingertipTarget(
  hand: HTMLElement,
  overlay: HTMLElement,
  ratios: { x: number; y: number },
  target: { x: number; y: number },
): { x: number; y: number } {
  const currentX = Number(gsap.getProperty(hand, 'x')) || 0
  const currentY = Number(gsap.getProperty(hand, 'y')) || 0
  const tip = fingertipInOverlay(hand, overlay, ratios)
  return {
    x: currentX + (target.x - tip.x),
    y: currentY + (target.y - tip.y),
  }
}

function separationForHand(hand: HTMLElement): {
  left: { x: number; y: number }
  right: { x: number; y: number }
} {
  const w = hand.offsetWidth || 200
  const h = hand.offsetHeight || w * 1.15
  const halfGap = Math.max(
    w * config.hands.separationHandWidthScale,
    config.hands.separationMinPx,
  )
  const y =
    h * config.hands.separationHeightScale +
    config.hands.separationYOffsetPx
  return {
    left: { x: -halfGap, y },
    right: { x: halfGap, y },
  }
}

function clampNormalizedToEllipse(
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
): { x: number; y: number } {
  const cx = 0.5
  const cy = 0.5
  const dx = x - cx
  const dy = y - cy
  if (radiusX <= 0 || radiusY <= 0) return { x: cx, y: cy }
  const norm =
    (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY)
  if (norm <= 1) return { x, y }
  const scale = 1 / Math.sqrt(norm)
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function clampObjectInBowl(
  x: number,
  y: number,
  sizePx: number,
  rootWidth: number,
  rootHeight: number,
): { x: number; y: number } {
  const { radiusX, radiusY } = getBowlBoundaryRadii()
  const marginX = sizePx / 2 / rootWidth
  const marginY = sizePx / 2 / rootHeight
  return clampNormalizedToEllipse(
    x,
    y,
    Math.max(radiusX - marginX, 0.08),
    Math.max(radiusY - marginY, 0.08),
  )
}

function readGsapHandState(hand: HTMLElement): {
  x: number
  y: number
  scale: number
  rotation: number
} {
  return {
    x: Number(gsap.getProperty(hand, 'x')) || 0,
    y: Number(gsap.getProperty(hand, 'y')) || 0,
    scale: Number(gsap.getProperty(hand, 'scale')) || 1,
    rotation: Number(gsap.getProperty(hand, 'rotation')) || 0,
  }
}

function paintHand(
  hand: HTMLElement,
  origin: string,
  x: number,
  y: number,
  rotation: number,
  scale: number,
): void {
  hand.style.transformOrigin = origin
  hand.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg) scale(${scale})`
}

function releaseGsapHand(hand: HTMLElement): void {
  gsap.killTweensOf(hand)
  gsap.set(hand, { clearProps: 'transform,x,y,scale,rotation' })
}

function readHandTranslate(hand: HTMLElement): { x: number; y: number } {
  const tr = getComputedStyle(hand).transform
  if (!tr || tr === 'none') return { x: 0, y: 0 }
  const m = new DOMMatrixReadOnly(tr)
  return { x: m.m41, y: m.m42 }
}

function readHandRotation(hand: HTMLElement): number {
  const tr = getComputedStyle(hand).transform
  if (!tr || tr === 'none') return 0
  const m = new DOMMatrixReadOnly(tr)
  return Math.atan2(m.m12, m.m11) * (180 / Math.PI)
}

function translateForFingertipTarget(
  hand: HTMLElement,
  overlay: HTMLElement,
  ratios: { x: number; y: number },
  target: { x: number; y: number },
): { x: number; y: number } {
  const current = readHandTranslate(hand)
  const tip = fingertipInOverlay(hand, overlay, ratios)
  return {
    x: current.x + (target.x - tip.x),
    y: current.y + (target.y - tip.y),
  }
}

export function createCandyRummageController(
  options: CandyRummageOptions,
): CandyRummageController {
  const {
    overlay,
    leftHand,
    rightHand,
    cuppedReveal,
    getBowlTarget,
    getObjectsRoot,
    getObjectsFrontRoot,
    onPrizeRevealed,
    onPlungeStart,
  } = options

  function rootForLayer(layer: ObjectLayer): HTMLElement | null {
    return layer === 'front' ? getObjectsFrontRoot() : getObjectsRoot()
  }

  function clearObjectLayers(): void {
    getObjectsRoot()?.replaceChildren()
    getObjectsFrontRoot()?.replaceChildren()
  }

  let state: CandyInteractionState = 'idle'
  let bound = false
  let plungeTimeline: gsap.core.Timeline | null = null
  let plungeFallbackTimer: ReturnType<typeof setTimeout> | null = null
  let objects: BowlObject[] = []
  let leftRotateBase = 16
  let rightRotateBase = -16
  let leftOrigin = '62% 22%'
  let rightOrigin = '38% 22%'

  let pose: RummagePose | null = null
  let followActive = false
  let followRaf = 0
  let pointerClient: { x: number; y: number } | null = null

  let lastMid: { x: number; y: number } | null = null
  let lastMoveTime = 0
  let handSpeed = 0
  let rummagingStartedAt = 0
  let grabTimeline: gsap.core.Timeline | null = null
  let grabRevealTimer: ReturnType<typeof setTimeout> | null = null
  let grabFinishTimer: ReturnType<typeof setTimeout> | null = null
  let grabStarted = false

  const reduced = prefersReducedMotion()

  const onPointerDown = (event: PointerEvent): void => {
    const bowl = getBowlTarget()
    if (!bowl || state !== 'idle') return
    if (!pointInElement(event.clientX, event.clientY, bowl)) return

    event.preventDefault()
    beginPlunge()
  }

  const onPointerDownAnywhere = (event: PointerEvent): void => {
    if (state !== 'rummaging') return
    if (event.button !== 0) return
    pointerClient = { x: event.clientX, y: event.clientY }

    const bowl = getBowlTarget()
    if (
      bowl &&
      canGrab() &&
      pointInElement(event.clientX, event.clientY, bowl)
    ) {
      event.preventDefault()
      beginGrab(event.clientX, event.clientY)
      return
    }

    applyFollow(event.clientX, event.clientY)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (state === 'idle') {
      event.preventDefault()
      beginPlunge()
      return
    }
    if (state === 'rummaging' && canGrab()) {
      event.preventDefault()
      const bowl = getBowlTarget()
      if (!bowl) return
      const rect = bowl.getBoundingClientRect()
      beginGrab(rect.left + rect.width / 2, rect.top + rect.height / 2)
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    pointerClient = { x: event.clientX, y: event.clientY }
    if (state === 'rummaging') {
      applyFollow(event.clientX, event.clientY)
    }
  }

  const onMouseMove = (event: MouseEvent): void => {
    pointerClient = { x: event.clientX, y: event.clientY }
    if (state === 'rummaging') {
      applyFollow(event.clientX, event.clientY)
    }
  }

  const onViewportChange = (): void => {
    if (state !== 'rummaging' || !pointerClient) return
    applyFollow(pointerClient.x, pointerClient.y)
  }

  function pointInElement(
    clientX: number,
    clientY: number,
    el: HTMLElement,
  ): boolean {
    const r = el.getBoundingClientRect()
    return (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    )
  }

  function readBaseRotations(): void {
    const styles = getComputedStyle(overlay)
    leftRotateBase =
      parseFloat(styles.getPropertyValue('--hands-left-rotate')) || 16
    rightRotateBase =
      parseFloat(styles.getPropertyValue('--hands-right-rotate')) || -16
    leftOrigin = `${config.hands.fingertip.left.x * 100}% ${config.hands.fingertip.left.y * 100}%`
    rightOrigin = `${config.hands.fingertip.right.x * 100}% ${config.hands.fingertip.right.y * 100}%`
  }

  function prepareHandsForControl(): void {
    readBaseRotations()
    leftHand.classList.add('hands-overlay__hand--rummaging')
    rightHand.classList.add('hands-overlay__hand--rummaging')
    overlay.classList.add('hands-overlay--candy-rummage')

    gsap.set(leftHand, {
      rotation: leftRotateBase,
      transformOrigin: leftOrigin,
      force3D: true,
    })
    gsap.set(rightHand, {
      rotation: rightRotateBase,
      transformOrigin: rightOrigin,
      force3D: true,
    })
  }

  function bowlCenterInOverlay(): { x: number; y: number } {
    const bowl = getBowlTarget()
    const overlayRect = overlay.getBoundingClientRect()
    if (!bowl) {
      return { x: overlayRect.width / 2, y: overlayRect.height * 0.45 }
    }
    const bowlRect = bowl.getBoundingClientRect()
    return {
      x: bowlRect.left - overlayRect.left + bowlRect.width / 2,
      y: bowlRect.top - overlayRect.top + bowlRect.height / 2,
    }
  }

  function handoffHandsToInlineTracking(): RummagePose {
    const left = readGsapHandState(leftHand)
    const right = readGsapHandState(rightHand)
    const scale = left.scale

    releaseGsapHand(leftHand)
    releaseGsapHand(rightHand)

    paintHand(
      leftHand,
      leftOrigin,
      left.x,
      left.y,
      leftRotateBase,
      scale,
    )
    paintHand(
      rightHand,
      rightOrigin,
      right.x,
      right.y,
      rightRotateBase,
      scale,
    )

    return { scale }
  }

  function startFollowLoop(): void {
    if (followRaf) return
    const tick = (): void => {
      if (!followActive || state !== 'rummaging' || !pointerClient) {
        followRaf = 0
        return
      }
      applyFollow(pointerClient.x, pointerClient.y)
      followRaf = requestAnimationFrame(tick)
    }
    followRaf = requestAnimationFrame(tick)
  }

  function stopFollowLoop(): void {
    if (followRaf) {
      cancelAnimationFrame(followRaf)
      followRaf = 0
    }
    followActive = false
  }

  function clearPlungeFallback(): void {
    if (plungeFallbackTimer !== null) {
      clearTimeout(plungeFallbackTimer)
      plungeFallbackTimer = null
    }
  }

  function beginPlunge(): void {
    const bowl = getBowlTarget()
    if (!bowl) return

    state = 'plunging'
    onPlungeStart?.()
    prepareHandsForControl()
    killPlunge()
    clearPlungeFallback()

    const center = bowlCenterInOverlay()
    const sep = separationForHand(leftHand)
    const leftTarget = {
      x: center.x + sep.left.x,
      y: center.y + sep.left.y,
    }
    const rightTarget = {
      x: center.x + sep.right.x,
      y: center.y + sep.right.y,
    }

    const leftEnd = xyForFingertipTarget(
      leftHand,
      overlay,
      config.hands.fingertip.left,
      leftTarget,
    )
    const rightEnd = xyForFingertipTarget(
      rightHand,
      overlay,
      config.hands.fingertip.right,
      rightTarget,
    )

    const finish = (): void => {
      clearPlungeFallback()
      finishPlunge(center)
    }

    plungeFallbackTimer = setTimeout(() => {
      plungeFallbackTimer = null
      if (state === 'plunging') finish()
    }, (config.plunge.duration + 0.25) * 1000)

    if (reduced) {
      gsap.set(leftHand, { ...leftEnd, scale: config.plunge.scaleSettle })
      gsap.set(rightHand, { ...rightEnd, scale: config.plunge.scaleSettle })
      finish()
      return
    }

    const duration = config.plunge.duration
    const tl = gsap.timeline({
      onComplete: () => {
        if (plungeTimeline === tl) plungeTimeline = null
        finish()
      },
    })
    plungeTimeline = tl

    tl.to(
      leftHand,
      {
        x: leftEnd.x,
        y: leftEnd.y,
        scale: config.plunge.scale,
        duration: duration * 0.72,
        ease: config.plunge.ease,
      },
      0,
    )
      .to(
        rightHand,
        {
          x: rightEnd.x,
          y: rightEnd.y,
          scale: config.plunge.scale,
          duration: duration * 0.72,
          ease: config.plunge.ease,
        },
        0,
      )
      .to(
        leftHand,
        {
          scale: config.plunge.impactScale,
          y: leftEnd.y + 6 * config.plunge.inwardPull,
          duration: config.plunge.bounceDuration,
          ease: 'power2.in',
        },
        '>',
      )
      .to(
        rightHand,
        {
          scale: config.plunge.impactScale,
          y: rightEnd.y + 6 * config.plunge.inwardPull,
          duration: config.plunge.bounceDuration,
          ease: 'power2.in',
        },
        '<',
      )
      .to(
        leftHand,
        {
          scale: config.plunge.scaleSettle,
          y: leftEnd.y,
          duration: config.plunge.bounceDuration,
          ease: config.plunge.bounceEase,
        },
        '>',
      )
      .to(
        rightHand,
        {
          scale: config.plunge.scaleSettle,
          y: rightEnd.y,
          duration: config.plunge.bounceDuration,
          ease: config.plunge.bounceEase,
        },
        '<',
      )
  }

  function finishPlunge(center: { x: number; y: number }): void {
    if (state === 'rummaging') return
    if (state !== 'plunging') return

    if (plungeTimeline) {
      plungeTimeline.kill()
      plungeTimeline = null
    }
    gsap.killTweensOf([leftHand, rightHand])

    state = 'rummaging'
    rummagingStartedAt = performance.now()
    pose = handoffHandsToInlineTracking()
    followActive = true
    lastMid = { ...center }
    lastMoveTime = performance.now()
    handSpeed = 0

    const overlayRect = overlay.getBoundingClientRect()
    pointerClient = {
      x: overlayRect.left + center.x,
      y: overlayRect.top + center.y,
    }

    applyFollow(pointerClient.x, pointerClient.y)
    startFollowLoop()
  }

  function applyFollow(clientX: number, clientY: number): void {
    if (!pose) return
    const bowl = getBowlTarget()
    if (!bowl) return

    const bowlRect = bowl.getBoundingClientRect()
    const mid = overlayPoint(clientX, clientY, overlay)

    const now = performance.now()
    let wobbleDir = 1
    if (lastMid) {
      const dt = Math.max(now - lastMoveTime, 1)
      const dist = Math.hypot(mid.x - lastMid.x, mid.y - lastMid.y)
      handSpeed = dist / dt
      wobbleDir = mid.x >= lastMid.x ? 1 : -1
    }
    lastMid = mid
    lastMoveTime = now

    const wobble =
      Math.min(
        handSpeed * config.hands.rotationFromSpeed * 1000,
        config.hands.maxRotationWobble,
      ) * wobbleDir

    const sep = separationForHand(leftHand)
    const leftTip = { x: mid.x + sep.left.x, y: mid.y + sep.left.y }
    const rightTip = { x: mid.x + sep.right.x, y: mid.y + sep.right.y }
    const leftXY = translateForFingertipTarget(
      leftHand,
      overlay,
      config.hands.fingertip.left,
      leftTip,
    )
    const rightXY = translateForFingertipTarget(
      rightHand,
      overlay,
      config.hands.fingertip.right,
      rightTip,
    )

    paintHand(
      leftHand,
      leftOrigin,
      leftXY.x,
      leftXY.y,
      leftRotateBase + wobble * 0.6,
      pose.scale,
    )
    paintHand(
      rightHand,
      rightOrigin,
      rightXY.x,
      rightXY.y,
      rightRotateBase - wobble * 0.6,
      pose.scale,
    )

    reactObjectsAtMid(mid, bowlRect)
  }

  function reactObjectsAtMid(
    mid: { x: number; y: number },
    bowlRect: DOMRect,
  ): void {
    if (objects.length === 0) return

    const behindRoot = getObjectsRoot()
    const behindRect = behindRoot?.getBoundingClientRect()
    if (!behindRect) return

    const overlayRect = overlay.getBoundingClientRect()
    const handX = mid.x - (behindRect.left - overlayRect.left)
    const handY = mid.y - (behindRect.top - overlayRect.top)

    const radius = bowlRect.width * config.objects.interactionRadius
    const strength =
      config.objects.pushStrength * (1 + Math.min(handSpeed * 8, 1.5))

    for (const obj of objects) {
      const layerRoot = rootForLayer(obj.layer)
      const rootRect = layerRoot?.getBoundingClientRect() ?? behindRect

      const ox = obj.x * rootRect.width
      const oy = obj.y * rootRect.height
      const dx = ox - handX
      const dy = oy - handY
      const dist = Math.hypot(dx, dy)
      if (dist > radius || dist < 0.001) continue

      const falloff = 1 - dist / radius
      const push = strength * falloff * falloff
      const nx = dx / dist
      const ny = dy / dist

      obj.x += (nx * push) / rootRect.width
      obj.y += (ny * push) / rootRect.height

      const clamped = clampObjectInBowl(
        obj.x,
        obj.y,
        obj.size,
        rootRect.width,
        rootRect.height,
      )
      obj.x = clamped.x
      obj.y = clamped.y

      const rotDelta =
        (nx * handSpeed * config.objects.rotationStrength * 1200 +
          (Math.random() - 0.5) * 0.02) *
        falloff

      const bounce = 1 + config.objects.bounceAmount * falloff * push * 0.08
      const tx = obj.x * rootRect.width
      const ty = obj.y * rootRect.height

      gsap.to(obj.el, {
        x: tx,
        y: ty,
        xPercent: -50,
        yPercent: -50,
        rotation: `+=${rotDelta * 45}`,
        scale: bounce,
        duration: reduced ? 0.08 : 0.12,
        ease: 'power2.out',
        overwrite: 'auto',
        onComplete: () => {
          gsap.to(obj.el, {
            scale: 1,
            duration: reduced ? 0.1 : config.objects.settleDuration,
            ease: config.objects.settleEase,
          })
        },
      })
    }
  }

  function spawnObjects(): void {
    const behindRoot = getObjectsRoot()
    if (!behindRoot) return
    clearObjectLayers()
    objects = []

    const cfg = config.objects
    const layoutRect = behindRoot.getBoundingClientRect()
    for (let i = 0; i < cfg.count; i += 1) {
      const layer: ObjectLayer =
        Math.random() < cfg.frontLayerChance ? 'front' : 'behind'
      const root = rootForLayer(layer)
      if (!root) continue

      const el = document.createElement('div')
      const isCircle = Math.random() > 0.5
      el.className = `candy__object candy__object--${isCircle ? 'circle' : 'square'}`

      const hue =
        cfg.blueHueMin + Math.random() * (cfg.blueHueMax - cfg.blueHueMin)
      const sat =
        cfg.blueSatMin + Math.random() * (cfg.blueSatMax - cfg.blueSatMin)
      const light =
        cfg.blueLightMin +
        Math.random() * (cfg.blueLightMax - cfg.blueLightMin)
      const size =
        cfg.sizeMinPx + Math.random() * (cfg.sizeMaxPx - cfg.sizeMinPx)
      el.style.width = `${size}px`
      el.style.height = `${size}px`
      el.style.backgroundColor = `hsl(${hue} ${sat}% ${light}%)`

      const angle = Math.random() * Math.PI * 2
      const r = 0.1 + Math.random() * 0.38
      const placed = clampObjectInBowl(
        0.5 + Math.cos(angle) * r,
        0.5 + Math.sin(angle) * r * 0.9,
        size,
        layoutRect.width,
        layoutRect.height,
      )

      root.appendChild(el)
      gsap.set(el, {
        x: placed.x * layoutRect.width,
        y: placed.y * layoutRect.height,
        xPercent: -50,
        yPercent: -50,
      })
      objects.push({
        el,
        layer,
        x: placed.x,
        y: placed.y,
        baseX: placed.x,
        baseY: placed.y,
        size,
      })
    }
  }

  function canGrab(): boolean {
    if (grabStarted || state !== 'rummaging') return false
    const elapsed = (performance.now() - rummagingStartedAt) / 1000
    return elapsed >= config.reveal.minRummageBeforeGrabSec
  }

  function prizeAtMid(mid: { x: number; y: number }): Prize {
    if (getSessionPrize()) return getSessionPrize()!

    const behindRoot = getObjectsRoot()
    const behindRect = behindRoot?.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    if (!behindRect || objects.length === 0) {
      const prize = fallbackPrize()
      setSessionPrize(prize)
      return prize
    }

    const handX = mid.x - (behindRect.left - overlayRect.left)
    const handY = mid.y - (behindRect.top - overlayRect.top)

    let best: BowlObject | null = null
    let bestDist = Infinity
    for (const obj of objects) {
      const layerRoot = rootForLayer(obj.layer)
      const rootRect = layerRoot?.getBoundingClientRect() ?? behindRect
      const ox = obj.x * rootRect.width
      const oy = obj.y * rootRect.height
      const dist = Math.hypot(ox - handX, oy - handY)
      if (dist < bestDist) {
        bestDist = dist
        best = obj
      }
    }

    if (!best) {
      const prize = fallbackPrize()
      setSessionPrize(prize)
      return prize
    }

    const bg = best.el.style.backgroundColor || '#e53935'
    const shape = best.el.classList.contains('candy__object--circle')
      ? 'circle'
      : 'square'
    const index = objects.indexOf(best)
    const prize = prizeFromBowlObjectStyle(bg, shape, index)
    setSessionPrize(prize)
    return prize
  }

  function applyPrizeToElement(prize: Prize): void {
    const { prize: prizeEl, prizeVisual } = cuppedReveal
    prizeEl.classList.toggle(
      'hands-overlay__prize--circle',
      prize.shape === 'circle',
    )
    prizeVisual.style.backgroundColor = prize.placeholderColor
    prizeEl.setAttribute('aria-hidden', 'false')
  }

  let cuppedDismissed = false

  function clearGrabTimers(): void {
    if (grabRevealTimer !== null) {
      clearTimeout(grabRevealTimer)
      grabRevealTimer = null
    }
    if (grabFinishTimer !== null) {
      clearTimeout(grabFinishTimer)
      grabFinishTimer = null
    }
  }

  function clearCuppedReveal(): void {
    clearGrabTimers()
    if (grabTimeline) {
      grabTimeline.kill()
      grabTimeline = null
    }
    const { root, motion, prize, prizeVisual } = cuppedReveal
    gsap.killTweensOf([motion, prizeVisual])
    gsap.set(motion, { clearProps: 'opacity,transform' })
    gsap.set(prizeVisual, { clearProps: 'opacity,transform' })
    motion.style.opacity = ''
    prizeVisual.style.opacity = ''
    prizeVisual.style.transform = ''
    prizeVisual.style.backgroundColor = ''
    root.hidden = true
    root.setAttribute('aria-hidden', 'true')
    prize.setAttribute('aria-hidden', 'true')
    overlay.classList.remove('hands-overlay--prize-reveal')
    overlay.classList.remove('hands-overlay--cupped-persist')
    overlay.classList.remove('hands-overlay--cupped-shown')
    leftHand.style.opacity = ''
    rightHand.style.opacity = ''
    cuppedDismissed = false
  }

  function commitCuppedReveal(): void {
    const { root, motion, prizeVisual } = cuppedReveal
    gsap.killTweensOf([motion, prizeVisual])
    gsap.set(motion, { clearProps: 'opacity,transform' })
    gsap.set(prizeVisual, { clearProps: 'opacity,transform' })
    root.hidden = false
    root.removeAttribute('hidden')
    root.setAttribute('aria-hidden', 'false')
    motion.style.opacity = ''
    motion.style.transform = ''
    prizeVisual.style.opacity = ''
    prizeVisual.style.transform = ''
    overlay.classList.add('hands-overlay--cupped-shown')
    overlay.classList.remove('hands-overlay--candy-rummage')
    // Force visible even if a stale GSAP inline style is present.
    motion.style.setProperty('opacity', '1')
    motion.style.setProperty('transform', 'translate3d(0, 0, 0)')
    prizeVisual.style.setProperty('opacity', '1')
    prizeVisual.style.setProperty('transform', 'scale(1)')
    const committedPrize = getSessionPrize()
    if (committedPrize) {
      applyPrizeToElement(committedPrize)
    }
  }

  function emitCuppedOutro(prize: Prize): void {
    if (state === 'revealing') return
    clearGrabTimers()
    if (grabTimeline) {
      grabTimeline.kill()
      grabTimeline = null
    }
    grabStarted = true
    state = 'revealing'
    leftHand.style.opacity = '0'
    rightHand.style.opacity = '0'
    leftHand.style.visibility = 'hidden'
    rightHand.style.visibility = 'hidden'
    commitCuppedReveal()
    onPrizeRevealed?.(prize)
  }

  function finishGrabReveal(prize: Prize): void {
    emitCuppedOutro(prize)
  }

  function beginCuppedOutroForGoodbye(): boolean {
    if (state === 'grabbing' || state === 'revealing' || isCuppedRevealActive()) {
      return false
    }

    grabStarted = true
    stopFollowLoop()
    clearPlungeFallback()
    killPlunge()
    clearGrabTimers()
    if (grabTimeline) {
      grabTimeline.kill()
      grabTimeline = null
    }

    const prize = getSessionPrize() ?? fallbackPrize()
    if (!getSessionPrize()) {
      setSessionPrize(prize)
    }
    applyPrizeToElement(prize)

    const { root } = cuppedReveal
    root.hidden = false
    root.removeAttribute('hidden')
    root.setAttribute('aria-hidden', 'false')
    cuppedDismissed = false
    overlay.classList.add('hands-overlay--prize-reveal')
    overlay.classList.add('hands-overlay--cupped-persist')
    overlay.classList.remove('hands-overlay--cupped-shown')
    overlay.style.setProperty(
      '--cupped-rise-start',
      `${config.reveal.cuppedRisePx * 0.5}px`,
    )

    const fadeDur = reduced ? 0.05 : 0.2
    gsap.to([leftHand, rightHand], {
      opacity: 0,
      duration: fadeDur,
      ease: 'power1.out',
    })

    const delayMs = reduced
      ? 0
      : Math.max(config.reveal.cuppedFadeIn * 1000 * 0.85, 120)
    grabRevealTimer = setTimeout(() => {
      grabRevealTimer = null
      emitCuppedOutro(prize)
    }, delayMs)

    return true
  }

  function isCuppedRevealActive(): boolean {
    return (
      !cuppedDismissed &&
      !cuppedReveal.root.hidden &&
      overlay.classList.contains('hands-overlay--prize-reveal') &&
      overlay.classList.contains('hands-overlay--cupped-shown')
    )
  }

  function dismissCuppedReveal(): void {
    if (!isCuppedRevealActive()) return
    cuppedDismissed = true
    const idleFadeDur = reduced ? 0.12 : 0.35
    const cuppedCssFadeMs = reduced ? 120 : 280

    gsap.killTweensOf([leftHand, rightHand])
    leftHand.style.visibility = 'hidden'
    rightHand.style.visibility = 'hidden'
    overlay.classList.remove('hands-overlay--cupped-shown')

    window.setTimeout(() => {
      clearCuppedReveal()
      clearRummageHands()
      leftHand.style.visibility = 'visible'
      rightHand.style.visibility = 'visible'
      gsap.set([leftHand, rightHand], { opacity: 0 })
      gsap.to([leftHand, rightHand], {
        opacity: 1,
        duration: idleFadeDur,
        ease: 'power2.out',
        onComplete: () => {
          gsap.set([leftHand, rightHand], { clearProps: 'opacity' })
        },
      })
    }, cuppedCssFadeMs)
  }

  function scatterObjectsFrom(mid: { x: number; y: number }): void {
    const behindRoot = getObjectsRoot()
    const behindRect = behindRoot?.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    if (!behindRect) return

    const handX = mid.x - (behindRect.left - overlayRect.left)
    const handY = mid.y - (behindRect.top - overlayRect.top)
    const scatterDur = reduced ? 0.05 : config.reveal.scatterDuration

    for (const obj of objects) {
      const layerRoot = rootForLayer(obj.layer)
      const rootRect = layerRoot?.getBoundingClientRect() ?? behindRect
      const ox = obj.x * rootRect.width
      const oy = obj.y * rootRect.height
      const dx = ox - handX
      const dy = oy - handY
      const dist = Math.hypot(dx, dy) || 1
      const push = 0.12 + Math.min(dist / rootRect.width, 0.2)
      const nx = dx / dist
      const ny = dy / dist
      obj.x += (nx * push)
      obj.y += (ny * push * 0.9)
      const clamped = clampObjectInBowl(
        obj.x,
        obj.y,
        obj.size,
        rootRect.width,
        rootRect.height,
      )
      obj.x = clamped.x
      obj.y = clamped.y
      const tx = obj.x * rootRect.width
      const ty = obj.y * rootRect.height
      gsap.to(obj.el, {
        x: tx,
        y: ty,
        xPercent: -50,
        yPercent: -50,
        rotation: `+=${(Math.random() - 0.5) * 90}`,
        opacity: 0.35,
        duration: scatterDur,
        ease: 'power2.out',
        overwrite: 'auto',
      })
    }
  }

  function beginGrab(clientX: number, clientY: number): void {
    if (!canGrab() || !pose) return
    grabStarted = true
    state = 'grabbing'
    stopFollowLoop()

    const mid = overlayPoint(clientX, clientY, overlay)
    const prize = prizeAtMid(mid)
    applyPrizeToElement(prize)

    const grabMid = lastMid ?? bowlCenterInOverlay()
    const scale = pose.scale
    const leftStart = readHandTranslate(leftHand)
    const rightStart = readHandTranslate(rightHand)
    const leftRotStart = readHandRotation(leftHand)
    const rightRotStart = readHandRotation(rightHand)

    const pinch = 6
    const leftTipTarget = {
      x: grabMid.x - pinch,
      y: grabMid.y + 4,
    }
    const rightTipTarget = {
      x: grabMid.x + pinch,
      y: grabMid.y + 4,
    }
    const leftEnd = translateForFingertipTarget(
      leftHand,
      overlay,
      config.hands.fingertip.left,
      leftTipTarget,
    )
    const rightEnd = translateForFingertipTarget(
      rightHand,
      overlay,
      config.hands.fingertip.right,
      rightTipTarget,
    )
    const leftRotEnd = 10
    const rightRotEnd = -10

    const { root } = cuppedReveal
    root.hidden = false
    root.removeAttribute('hidden')
    root.setAttribute('aria-hidden', 'false')
    cuppedDismissed = false
    overlay.classList.add('hands-overlay--prize-reveal')
    overlay.classList.add('hands-overlay--cupped-persist')

    const revealCfg = config.reveal
    const grabDur = reduced ? 0.08 : revealCfg.grabDuration

    if (reduced) {
      paintHand(leftHand, leftOrigin, leftEnd.x, leftEnd.y, leftRotEnd, scale)
      paintHand(
        rightHand,
        rightOrigin,
        rightEnd.x,
        rightEnd.y,
        rightRotEnd,
        scale,
      )
      leftHand.style.opacity = '0'
      rightHand.style.opacity = '0'
      scatterObjectsFrom(grabMid)
      finishGrabReveal(prize)
      return
    }

    const handAnim = {
      lx: leftStart.x,
      ly: leftStart.y,
      lr: leftRotStart,
      rx: rightStart.x,
      ry: rightStart.y,
      rr: rightRotStart,
      handFade: 1,
    }

    overlay.style.setProperty(
      '--cupped-rise-start',
      `${revealCfg.cuppedRisePx * 0.5}px`,
    )
    overlay.classList.remove('hands-overlay--cupped-shown')

    scatterObjectsFrom(grabMid)

    const cuppedIn = grabDur * 0.5
    const revealDelayMs = Math.max(cuppedIn * 1000, 80)
    const finishDelayMs = Math.max((grabDur + revealCfg.cuppedFadeIn) * 1000, 160)

    clearGrabTimers()
    grabRevealTimer = setTimeout(() => {
      grabRevealTimer = null
      if (state !== 'grabbing' && state !== 'revealing') return
      commitCuppedReveal()
    }, revealDelayMs)
    grabFinishTimer = setTimeout(() => {
      grabFinishTimer = null
      finishGrabReveal(prize)
    }, finishDelayMs)

    const tl = gsap.timeline({
      onComplete: () => {
        finishGrabReveal(prize)
      },
    })
    grabTimeline = tl

    tl.to(
      handAnim,
      {
        lx: leftEnd.x,
        ly: leftEnd.y,
        lr: leftRotEnd,
        rx: rightEnd.x,
        ry: rightEnd.y,
        rr: rightRotEnd,
        duration: grabDur,
        ease: revealCfg.grabEase,
        onUpdate: () => {
          paintHand(leftHand, leftOrigin, handAnim.lx, handAnim.ly, handAnim.lr, scale)
          paintHand(
            rightHand,
            rightOrigin,
            handAnim.rx,
            handAnim.ry,
            handAnim.rr,
            scale,
          )
        },
      },
      0,
    )
      .to(
        handAnim,
        {
          handFade: 0,
          duration: revealCfg.cuppedFadeIn,
          ease: 'power1.out',
          onUpdate: () => {
            leftHand.style.opacity = String(handAnim.handFade)
            rightHand.style.opacity = String(handAnim.handFade)
          },
        },
        grabDur * 0.45,
      )

  }

  function clearRummageHands(): void {
    stopFollowLoop()
    clearPlungeFallback()
    killPlunge()
    grabStarted = false
    rummagingStartedAt = 0
    gsap.killTweensOf([leftHand, rightHand])
    leftHand.classList.remove('hands-overlay__hand--rummaging')
    rightHand.classList.remove('hands-overlay__hand--rummaging')
    overlay.classList.remove('hands-overlay--candy-rummage')
    releaseGsapHand(leftHand)
    releaseGsapHand(rightHand)
    leftHand.style.transform = ''
    leftHand.style.transformOrigin = ''
    rightHand.style.transform = ''
    rightHand.style.transformOrigin = ''
    pose = null
    pointerClient = null
  }

  function clearHands(): void {
    clearRummageHands()
    clearCuppedReveal()
  }

  function unbindListeners(): void {
    if (!bound) return
    bound = false
    const bowl = getBowlTarget()
    bowl?.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerdown', onPointerDownAnywhere)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('resize', onViewportChange)
    window.visualViewport?.removeEventListener('resize', onViewportChange)
    window.removeEventListener('keydown', onKeyDown)
  }

  function killPlunge(): void {
    if (plungeTimeline) {
      plungeTimeline.kill()
      plungeTimeline = null
    }
    gsap.killTweensOf([leftHand, rightHand])
  }

  return {
    bind(): void {
      if (bound) return
      bound = true
      spawnObjects()
      const bowl = getBowlTarget()
      bowl?.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('pointerdown', onPointerDownAnywhere)
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('mousemove', onMouseMove, { passive: true })
      window.addEventListener('resize', onViewportChange, { passive: true })
      window.visualViewport?.addEventListener('resize', onViewportChange)
      window.addEventListener('keydown', onKeyDown)
    },

    dispose(): void {
      unbindListeners()
      clearHands()
      clearObjectLayers()
      objects = []
      state = 'idle'
      lastMid = null
      clearSessionPrize()
      leftHand.style.visibility = ''
      rightHand.style.visibility = ''
    },

    detachRummageForGoodbye(): void {
      unbindListeners()
      clearRummageHands()
      clearObjectLayers()
      objects = []
      lastMid = null
      if (state === 'grabbing' && grabTimeline) {
        grabTimeline.kill()
        grabTimeline = null
        commitCuppedReveal()
      }
      if (state !== 'revealing') {
        state = 'revealing'
      }
      leftHand.style.visibility = 'hidden'
      rightHand.style.visibility = 'hidden'
    },

    reset(): void {
      this.dispose()
      clearObjectLayers()
      state = 'idle'
      clearSessionPrize()
    },

    respawnObjects(): void {
      if (!bound) return
      spawnObjects()
    },

    getState(): CandyInteractionState {
      return state
    },

    beginPlungeFromKeyboard(): void {
      if (state !== 'idle') return
      beginPlunge()
    },

    tryGrabFromKeyboard(): void {
      if (!canGrab()) return
      const bowl = getBowlTarget()
      if (!bowl) return
      const rect = bowl.getBoundingClientRect()
      beginGrab(rect.left + rect.width / 2, rect.top + rect.height / 2)
    },

    isCuppedRevealActive(): boolean {
      return isCuppedRevealActive()
    },

    dismissCuppedReveal(): void {
      dismissCuppedReveal()
    },

    commitCuppedReveal(): void {
      commitCuppedReveal()
    },

    beginCuppedOutroForGoodbye(): boolean {
      return beginCuppedOutroForGoodbye()
    },
  }
}
