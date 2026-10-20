import gsap from 'gsap'
import { candyBowlConfig as config } from '../../config/candyBowl'

export type CandyInteractionState = 'idle' | 'plunging' | 'rummaging'

export interface CandyRummageOptions {
  overlay: HTMLElement
  leftHand: HTMLImageElement
  rightHand: HTMLImageElement
  getBowlTarget: () => HTMLElement | null
  getObjectsRoot: () => HTMLElement | null
}

export interface CandyRummageController {
  bind(): void
  dispose(): void
  reset(): void
  getState(): CandyInteractionState
}

interface BowlObject {
  el: HTMLElement
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

function clampToBowlEllipse(
  point: { x: number; y: number },
  bowlRect: DOMRect,
  overlayRect: DOMRect,
  boundary: { radiusX: number; radiusY: number },
): { x: number; y: number } {
  const cx = bowlRect.left - overlayRect.left + bowlRect.width / 2
  const cy = bowlRect.top - overlayRect.top + bowlRect.height / 2
  const rx = bowlRect.width * boundary.radiusX
  const ry = bowlRect.height * boundary.radiusY
  const dx = point.x - cx
  const dy = point.y - cy
  if (rx <= 0 || ry <= 0) return { x: cx, y: cy }
  const norm = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
  if (norm <= 1) return point
  const scale = 1 / Math.sqrt(norm)
  return { x: cx + dx * scale, y: cy + dy * scale }
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
  const { overlay, leftHand, rightHand, getBowlTarget, getObjectsRoot } =
    options

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

  const reduced = prefersReducedMotion()

  const onPointerDown = (event: PointerEvent): void => {
    const bowl = getBowlTarget()
    if (!bowl || state !== 'idle') return
    if (!pointInElement(event.clientX, event.clientY, bowl)) return

    event.preventDefault()
    beginPlunge()
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

    const overlayRect = overlay.getBoundingClientRect()
    const bowlRect = bowl.getBoundingClientRect()
    const raw = overlayPoint(clientX, clientY, overlay)
    const mid = clampToBowlEllipse(
      raw,
      bowlRect,
      overlayRect,
      config.hands.boundary,
    )

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
    const root = getObjectsRoot()
    if (!root || objects.length === 0) return

    const rootRect = root.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    const handX = mid.x - (rootRect.left - overlayRect.left)
    const handY = mid.y - (rootRect.top - overlayRect.top)

    const radius = bowlRect.width * config.objects.interactionRadius
    const strength =
      config.objects.pushStrength * (1 + Math.min(handSpeed * 8, 1.5))

    for (const obj of objects) {
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
    const root = getObjectsRoot()
    if (!root) return
    root.replaceChildren()
    objects = []

    const cfg = config.objects
    for (let i = 0; i < cfg.count; i += 1) {
      const el = document.createElement('div')
      const isCircle = Math.random() > 0.5
      el.className = `candy__object candy__object--${isCircle ? 'circle' : 'square'}`

      const shade =
        cfg.shadeMin + Math.random() * (cfg.shadeMax - cfg.shadeMin)
      const size =
        cfg.sizeMinPx + Math.random() * (cfg.sizeMaxPx - cfg.sizeMinPx)
      el.style.width = `${size}px`
      el.style.height = `${size}px`
      el.style.backgroundColor = `rgb(${Math.round(shade * 255)}, ${Math.round(shade * 255)}, ${Math.round(shade * 255)})`

      const angle = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * 0.42
      const x = 0.5 + Math.cos(angle) * r * 0.95
      const y = 0.5 + Math.sin(angle) * r * 0.82

      el.style.left = `${x * 100}%`
      el.style.top = `${y * 100}%`

      root.appendChild(el)
      objects.push({ el, x, y, baseX: x, baseY: y, size })
    }
  }

  function clearHands(): void {
    stopFollowLoop()
    clearPlungeFallback()
    killPlunge()
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
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('mousemove', onMouseMove, { passive: true })
      window.addEventListener('resize', onViewportChange, { passive: true })
      window.visualViewport?.addEventListener('resize', onViewportChange)
    },

    dispose(): void {
      if (!bound) return
      bound = false
      const bowl = getBowlTarget()
      bowl?.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('resize', onViewportChange)
      window.visualViewport?.removeEventListener('resize', onViewportChange)
      clearHands()
      objects = []
      state = 'idle'
      lastMid = null
    },

    reset(): void {
      this.dispose()
      const root = getObjectsRoot()
      root?.replaceChildren()
      state = 'idle'
    },

    getState(): CandyInteractionState {
      return state
    },
  }
}
