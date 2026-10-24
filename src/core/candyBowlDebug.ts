import { isBowlDebugEnabled } from '../config/bowlBoundaryRuntime'
import {
  applyBowlLayoutToApp,
  clearBowlLayoutTuning,
  readBowlLayoutTuning,
  writeBowlLayoutTuning,
  type BowlLayoutTuning,
} from '../config/bowlLayout'

const BOWL_DEBUG_UI_HIDDEN_KEY = 'my-house:bowlDebugUiHidden'

let respawnCandies: (() => void) | null = null

function isDebugUiHidden(): boolean {
  try {
    return sessionStorage.getItem(BOWL_DEBUG_UI_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function setDebugUiHidden(hidden: boolean): void {
  try {
    sessionStorage.setItem(BOWL_DEBUG_UI_HIDDEN_KEY, hidden ? '1' : '0')
  } catch {
    /* ignore */
  }
  const panel = document.getElementById('bowl-debug-panel')
  const chip = document.getElementById('bowl-debug-chip')
  if (panel) panel.hidden = hidden
  if (chip) chip.hidden = !hidden
}

export function registerCandyRespawn(handler: () => void): void {
  respawnCandies = handler
}

/** Turn on bowl alignment guides + live tuner (dev builds only). */
export function applyCandyBowlDebug(appEl: HTMLElement): void {
  if (!isBowlDebugEnabled()) return

  document.documentElement.classList.add('candy-bowl-debug')
  applyBowlLayoutToApp(appEl)
  mountBowlDebugPanel(appEl)
  setDebugUiHidden(isDebugUiHidden())

  console.info(
    [
      '[candy bowl debug]',
      'Use the panel (below Skip) to tune — Hide collapses the menu; “Bowl debug” chip reopens it (guides stay on).',
      'Skip intro: ?startAt=candy&bowlDebug=1',
      'Reset stored tuning: panel → “Reset defaults”.',
    ].join('\n'),
  )
}

function mountBowlDebugPanel(appEl: HTMLElement): void {
  if (document.getElementById('bowl-debug-panel')) return

  const chip = document.createElement('button')
  chip.type = 'button'
  chip.id = 'bowl-debug-chip'
  chip.className = 'bowl-debug-chip'
  chip.hidden = true
  chip.textContent = 'Bowl debug'
  chip.setAttribute('aria-label', 'Show bowl layout debug panel')
  chip.addEventListener('click', () => setDebugUiHidden(false))
  document.body.appendChild(chip)

  const panel = document.createElement('div')
  panel.id = 'bowl-debug-panel'
  panel.className = 'bowl-debug-panel'
  panel.innerHTML = `
    <div class="bowl-debug-panel__header">
      <p class="bowl-debug-panel__title">Bowl layout (dev)</p>
      <button type="button" class="bowl-debug-panel__hide" data-action="hide-ui">Hide</button>
    </div>
    <p class="bowl-debug-panel__hint">Cyan = objects rect · Yellow = tap oval · Magenta = candy bounds</p>
    <label class="bowl-debug-panel__row">Ellipse radius X <output data-out="radiusX"></output>
      <input type="range" data-key="radiusX" min="0.28" max="0.58" step="0.01" />
    </label>
    <label class="bowl-debug-panel__row">Ellipse radius Y <output data-out="radiusY"></output>
      <input type="range" data-key="radiusY" min="0.22" max="0.58" step="0.01" />
    </label>
    <label class="bowl-debug-panel__row">Objects width (vw) <output data-out="objectsWidthVw"></output>
      <input type="range" data-key="objectsWidthVw" min="70" max="140" step="1" />
    </label>
    <label class="bowl-debug-panel__row">Objects height (vw) <output data-out="objectsHeightVw"></output>
      <input type="range" data-key="objectsHeightVw" min="28" max="85" step="1" />
    </label>
    <label class="bowl-debug-panel__row">Tap oval width (vw) <output data-out="hitWidthVw"></output>
      <input type="range" data-key="hitWidthVw" min="60" max="140" step="1" />
    </label>
    <label class="bowl-debug-panel__row">Tap oval height (vw) <output data-out="hitHeightVw"></output>
      <input type="range" data-key="hitHeightVw" min="24" max="80" step="1" />
    </label>
    <label class="bowl-debug-panel__row">Center Y (%) <output data-out="centerY"></output>
      <input type="range" data-key="centerY" min="38" max="65" step="0.5" />
    </label>
    <div class="bowl-debug-panel__actions">
      <button type="button" data-action="respawn">Respawn candies</button>
      <button type="button" data-action="copy">Copy values</button>
      <button type="button" data-action="reset">Reset defaults</button>
    </div>
    <pre class="bowl-debug-panel__export" aria-live="polite"></pre>
  `
  document.body.appendChild(panel)

  const layout = readBowlLayoutTuning()
  const state = layoutToPanelState(layout)

  const syncOutputs = (): void => {
    for (const input of panel.querySelectorAll<HTMLInputElement>(
      'input[data-key]',
    )) {
      const key = input.dataset.key as keyof PanelState
      const out = panel.querySelector<HTMLOutputElement>(
        `output[data-out="${key}"]`,
      )
      if (out) out.textContent = String(state[key])
    }
    const exportEl = panel.querySelector('.bowl-debug-panel__export')
    if (exportEl) exportEl.textContent = formatExportSnippet(panelStateToLayout(state))
  }

  for (const input of panel.querySelectorAll<HTMLInputElement>(
    'input[data-key]',
  )) {
    const key = input.dataset.key as keyof PanelState
    input.value = String(state[key])
    input.addEventListener('input', () => {
      state[key] = Number(input.value)
      syncOutputs()
      const next = panelStateToLayout(state)
      writeBowlLayoutTuning(next)
      applyBowlLayoutToApp(appEl)
    })
  }
  syncOutputs()

  panel.querySelector('[data-action="respawn"]')?.addEventListener('click', () => {
    respawnCandies?.()
  })

  panel.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    clearBowlLayoutTuning()
    const fresh = readBowlLayoutTuning()
    Object.assign(state, layoutToPanelState(fresh))
    for (const input of panel.querySelectorAll<HTMLInputElement>(
      'input[data-key]',
    )) {
      const key = input.dataset.key as keyof PanelState
      input.value = String(state[key])
    }
    applyBowlLayoutToApp(appEl)
    syncOutputs()
    respawnCandies?.()
  })

  panel.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
    const snippet = formatExportSnippet(panelStateToLayout(state))
    void navigator.clipboard?.writeText(snippet)
    const exportEl = panel.querySelector('.bowl-debug-panel__export')
    if (exportEl) exportEl.textContent = `Copied:\n${snippet}`
  })

  panel
    .querySelector('[data-action="hide-ui"]')
    ?.addEventListener('click', () => setDebugUiHidden(true))
}

type PanelState = {
  radiusX: number
  radiusY: number
  objectsWidthVw: number
  objectsHeightVw: number
  hitWidthVw: number
  hitHeightVw: number
  centerY: number
}

function parseVw(css: string): number {
  const m = css.match(/([\d.]+)vw/)
  return m ? Number(m[1]) : 92
}

function layoutToPanelState(layout: BowlLayoutTuning): PanelState {
  const center = Number.parseFloat(layout.centerY) || 52
  return {
    radiusX: layout.radiusX,
    radiusY: layout.radiusY,
    objectsWidthVw: parseVw(layout.objectsWidth),
    objectsHeightVw: parseVw(layout.objectsHeight),
    hitWidthVw: parseVw(layout.hitWidth),
    hitHeightVw: parseVw(layout.hitHeight),
    centerY: center,
  }
}

function panelStateToLayout(state: PanelState): BowlLayoutTuning {
  return {
    radiusX: state.radiusX,
    radiusY: state.radiusY,
    objectsWidth: `min(${state.objectsWidthVw}vw, 960px)`,
    objectsHeight: `min(${state.objectsHeightVw}vw, 520px)`,
    hitWidth: `min(${state.hitWidthVw}vw, 920px)`,
    hitHeight: `min(${state.hitHeightVw}vw, 480px)`,
    centerY: `${state.centerY}%`,
  }
}

function formatExportSnippet(layout: BowlLayoutTuning): string {
  return [
    '// candyBowl.ts hands.boundary',
    `radiusX: ${layout.radiusX},`,
    `radiusY: ${layout.radiusY},`,
    '',
    '// global.css #app (or bowlLayoutDefaults)',
    `--candy-objects-width: ${layout.objectsWidth};`,
    `--candy-objects-height: ${layout.objectsHeight};`,
    `--candy-bowl-hit-width: ${layout.hitWidth};`,
    `--candy-bowl-hit-height: ${layout.hitHeight};`,
    `--candy-objects-center-y: ${layout.centerY};`,
  ].join('\n')
}

// Re-export for callers that only need CSS sync from URL (legacy).
export function syncBowlDebugTokens(appEl: HTMLElement): void {
  if (!isBowlDebugEnabled()) return
  applyBowlLayoutToApp(appEl)
}
