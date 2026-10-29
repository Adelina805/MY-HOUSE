import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { assets } from '../config/assets'
import { transitions } from '../config/transitions'
import {
  getGuestbookReferenceNow,
  getGuestbookStats,
  getRecentGuestbookEntries,
} from '../data/guestbookRepository'
import type { GuestbookEntry } from '../data/guestbookTypes'
import { registerMediaElement, restoreMediaMute } from './soundState'

gsap.registerPlugin(Flip)

export interface GuestbookController {
  mount(options: {
    appRoot: HTMLElement
    doorViewport: HTMLElement
    onOpenChange?: (open: boolean) => void
  }): void
  showClosedNote(): void
  /** Close expanded dialog if open; keep the taped note on the door. */
  closeExpanded(): void
  /** Hide note + overlay (e.g. when greeting / intro video starts). */
  reset(): void
  destroy(): void
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function formatVisitorCount(n: number): string {
  return n.toLocaleString('en-US')
}

function formatEntryTime(createdAt: string, now: Date): string {
  const created = new Date(createdAt)
  const diffMs = now.getTime() - created.getTime()
  const diffMin = Math.round(diffMs / 60_000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`

  const diffHours = Math.round(diffMin / 60)
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`
  }

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)

  if (created >= startOfYesterday && created < startOfToday) {
    return 'Yesterday'
  }

  const month = String(created.getMonth() + 1).padStart(2, '0')
  const day = String(created.getDate()).padStart(2, '0')
  const year = created.getFullYear()
  return `${month}/${day}/${year}`
}

function buildEntrySentence(entry: GuestbookEntry): DocumentFragment {
  const frag = document.createDocumentFragment()
  frag.append(
    document.createTextNode(
      `${entry.alias} ${entry.action} a `,
    ),
  )
  const object = document.createElement('strong')
  object.className = 'guestbook-overlay__entry-object'
  object.textContent = entry.objectName
  frag.append(object)
  if (entry.location) {
    frag.append(document.createTextNode(` from ${entry.location}`))
  }
  return frag
}

export function createGuestbookController(): GuestbookController {
  let appRoot: HTMLElement | null = null
  let doorViewport: HTMLElement | null = null
  let noteBtn: HTMLButtonElement | null = null
  let overlay: HTMLElement | null = null
  let dim: HTMLElement | null = null
  let paper: HTMLElement | null = null
  let content: HTMLElement | null = null
  let closeBtn: HTMLButtonElement | null = null
  let listEl: HTMLElement | null = null
  let appearTimer: ReturnType<typeof setTimeout> | null = null
  let paperAudio: HTMLAudioElement | null = null
  let unregisterPaperAudio: (() => void) | null = null
  let onOpenChange: ((open: boolean) => void) | null = null
  let isOpen = false
  let isAnimating = false
  let noteVisible = false
  let previousFocus: HTMLElement | null = null
  let activeTimeline: gsap.core.Timeline | null = null

  const onNoteClick = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    void openGuestbook()
  }

  const onNotePointerDown = (event: Event): void => {
    event.stopPropagation()
  }

  const onDimClick = (): void => {
    void closeGuestbook()
  }

  const onCloseClick = (event: Event): void => {
    event.stopPropagation()
    void closeGuestbook()
  }

  const onPaperClick = (event: Event): void => {
    event.stopPropagation()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      void closeGuestbook()
    }
  }

  function ensurePaperAudio(): HTMLAudioElement | null {
    const src = assets.audio.paper
    if (!src) return null
    if (!paperAudio) {
      paperAudio = new Audio(src)
      unregisterPaperAudio = registerMediaElement(paperAudio)
    }
    return paperAudio
  }

  function playPaperSound(): void {
    const audio = ensurePaperAudio()
    if (!audio) return
    restoreMediaMute(audio)
    audio.currentTime = 0
    void audio.play().catch(() => {})
  }

  function clearAppearTimer(): void {
    if (appearTimer !== null) {
      clearTimeout(appearTimer)
      appearTimer = null
    }
  }

  function killActiveTimeline(): void {
    activeTimeline?.kill()
    activeTimeline = null
    if (noteBtn) gsap.killTweensOf(noteBtn)
    if (paper) gsap.killTweensOf(paper)
    if (dim) gsap.killTweensOf(dim)
    if (content) gsap.killTweensOf(content)
  }

  function renderList(): void {
    if (!listEl) return
    listEl.replaceChildren()
    const now = getGuestbookReferenceNow()
    for (const entry of getRecentGuestbookEntries()) {
      const li = document.createElement('li')
      li.className = 'guestbook-overlay__entry'

      const text = document.createElement('p')
      text.className = 'guestbook-overlay__entry-text'
      text.append(buildEntrySentence(entry))

      const time = document.createElement('p')
      time.className = 'guestbook-overlay__entry-time'
      time.textContent = formatEntryTime(entry.createdAt, now)

      li.append(text, time)
      listEl.append(li)
    }
  }

  function buildOverlay(): HTMLElement {
    const stats = getGuestbookStats()
    const root = document.createElement('div')
    root.className = 'guestbook-overlay'
    root.dataset.open = 'false'
    root.setAttribute('aria-hidden', 'true')

    const dimEl = document.createElement('div')
    dimEl.className = 'guestbook-overlay__dim'
    dimEl.setAttribute('aria-hidden', 'true')

    const paperEl = document.createElement('div')
    paperEl.className = 'guestbook-overlay__paper'
    paperEl.setAttribute('role', 'dialog')
    paperEl.setAttribute('aria-modal', 'true')
    paperEl.setAttribute('aria-labelledby', 'guestbook-dialog-title')
    paperEl.tabIndex = -1

    const art = document.createElement('img')
    art.className = 'guestbook-overlay__art'
    art.src = assets.door.paperImage
    art.alt = ''
    art.draggable = false
    art.setAttribute('aria-hidden', 'true')

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'guestbook-overlay__close'
    close.setAttribute('aria-label', 'Close guestbook')
    close.textContent = '×'

    const contentEl = document.createElement('div')
    contentEl.className = 'guestbook-overlay__content'

    const header = document.createElement('div')
    header.className = 'guestbook-overlay__header'

    const title = document.createElement('h2')
    title.id = 'guestbook-dialog-title'
    title.className = 'guestbook-overlay__title'
    title.textContent = 'See who else came over.'

    const subtitle = document.createElement('p')
    subtitle.className = 'guestbook-overlay__subtitle'
    subtitle.textContent = 'A record of questionable gifts'

    const statsRow = document.createElement('div')
    statsRow.className = 'guestbook-overlay__stats'
    statsRow.setAttribute('role', 'group')
    statsRow.setAttribute('aria-label', 'Guestbook statistics')

    const statItems: Array<{ value: string; label: string }> = [
      {
        value: formatVisitorCount(stats.visitorCount),
        label: 'visitors',
      },
      {
        value: `${stats.uniqueObjectsFound}/${stats.totalObjects}`,
        label: 'objects found',
      },
      {
        value: formatVisitorCount(stats.totalKnocks),
        label: 'door knocks',
      },
    ]

    for (const item of statItems) {
      const stat = document.createElement('div')
      stat.className = 'guestbook-overlay__stat'
      const value = document.createElement('span')
      value.className = 'guestbook-overlay__stat-value'
      value.textContent = item.value
      const label = document.createElement('span')
      label.className = 'guestbook-overlay__stat-label'
      label.textContent = item.label
      stat.append(value, label)
      statsRow.append(stat)
    }

    header.append(title, subtitle, statsRow)

    const sectionTitle = document.createElement('h3')
    sectionTitle.className = 'guestbook-overlay__section-title'
    sectionTitle.textContent = 'Recent visitors'

    const list = document.createElement('ul')
    list.className = 'guestbook-overlay__list'
    list.setAttribute('tabindex', '0')
    list.setAttribute('aria-label', 'Recent visitors')

    contentEl.append(header, sectionTitle, list)
    paperEl.append(art, close, contentEl)
    root.append(dimEl, paperEl)

    dim = dimEl
    paper = paperEl
    content = contentEl
    closeBtn = close
    listEl = list

    dimEl.addEventListener('click', onDimClick)
    close.addEventListener('click', onCloseClick)
    paperEl.addEventListener('click', onPaperClick)

    return root
  }

  function buildNote(): HTMLButtonElement {
    const stats = getGuestbookStats()
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'guestbook-note'
    btn.dataset.visible = 'false'
    btn.dataset.open = 'false'
    btn.setAttribute('aria-label', 'Open guestbook. See who else came over.')
    btn.setAttribute('aria-expanded', 'false')
    btn.setAttribute('aria-haspopup', 'dialog')

    const art = document.createElement('img')
    art.className = 'guestbook-note__art'
    art.src = assets.door.paperImage
    art.alt = ''
    art.draggable = false
    art.setAttribute('aria-hidden', 'true')

    const copy = document.createElement('span')
    copy.className = 'guestbook-note__copy'
    copy.setAttribute('aria-hidden', 'true')

    const title = document.createElement('span')
    title.className = 'guestbook-note__title'
    title.textContent = 'See who else\ncame over.'

    const visitor = document.createElement('span')
    visitor.className = 'guestbook-note__visitor'
    visitor.textContent = `You're visitor #${formatVisitorCount(stats.visitorCount)}`

    copy.append(title, visitor)
    btn.append(art, copy)
    btn.addEventListener('click', onNoteClick)
    btn.addEventListener('pointerdown', onNotePointerDown)
    return btn
  }

  async function openGuestbook(): Promise<void> {
    if (!noteBtn || !overlay || !paper || !dim || !content || !closeBtn) return
    if (!noteVisible || isOpen || isAnimating) return

    isAnimating = true
    playPaperSound()
    previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : noteBtn

    const reduced = prefersReducedMotion()
    const duration = reduced ? 0.2 : transitions.guestbookOpenDuration
    const dimOpacity = transitions.guestbookDimOpacity

    noteBtn.dataset.open = 'true'
    noteBtn.setAttribute('aria-expanded', 'true')
    overlay.dataset.open = 'true'
    overlay.setAttribute('aria-hidden', 'false')
    isOpen = true
    onOpenChange?.(true)

    killActiveTimeline()
    gsap.set(dim, { opacity: 0 })
    // Content stays hidden while the paper shell Flips so text is never scaled.
    gsap.set(content, { opacity: 0 })

    if (reduced) {
      gsap.set(paper, {
        clearProps:
          'transform,width,height,top,left,right,bottom,margin,position,scale,x,y',
      })
      gsap.set(paper, { opacity: 1 })
      const tl = gsap.timeline({
        onComplete: () => {
          isAnimating = false
          activeTimeline = null
          closeBtn?.focus()
        },
      })
      activeTimeline = tl
      tl.to(dim, { opacity: dimOpacity, duration, ease: 'power2.out' }, 0)
      tl.to(
        content,
        { opacity: 1, duration: duration * 0.7, ease: 'power2.out' },
        duration * 0.25,
      )
      return
    }

    const noteRect = noteBtn.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()

    // Place square paper shell over the closed note, then Flip to CSS layout size.
    gsap.set(paper, {
      position: 'absolute',
      top: noteRect.top - overlayRect.top,
      left: noteRect.left - overlayRect.left,
      width: noteRect.width,
      height: noteRect.height,
      marginTop: 0,
      opacity: 1,
      scale: 1,
      x: 0,
      y: 0,
      transformOrigin: 'center center',
    })

    const state = Flip.getState(paper)

    gsap.set(paper, {
      clearProps: 'top,left,width,height,marginTop,position,scale,x,y',
    })

    const tl = gsap.timeline({
      onComplete: () => {
        isAnimating = false
        activeTimeline = null
        clearPaperLayoutProps(1)
        closeBtn?.focus()
      },
    })
    activeTimeline = tl

    tl.add(
      Flip.from(state, {
        duration,
        ease: 'power2.inOut',
        absolute: true,
      }),
      0,
    )
    tl.to(dim, { opacity: dimOpacity, duration, ease: 'power2.out' }, 0)
    tl.to(
      content,
      { opacity: 1, duration: duration * 0.4, ease: 'power2.out' },
      duration * 0.6,
    )
  }

  async function closeGuestbook(): Promise<void> {
    if (!noteBtn || !overlay || !paper || !dim || !content) return
    if (!isOpen || isAnimating) return

    isAnimating = true
    playPaperSound()

    const reduced = prefersReducedMotion()
    const duration = reduced ? 0.2 : transitions.guestbookCloseDuration

    killActiveTimeline()

    if (reduced) {
      const tl = gsap.timeline({
        onComplete: () => {
          finishClose()
        },
      })
      activeTimeline = tl
      tl.to(content, { opacity: 0, duration: duration * 0.5, ease: 'power2.in' }, 0)
      tl.to(dim, { opacity: 0, duration, ease: 'power2.in' }, 0)
      tl.to(paper, { opacity: 0, duration, ease: 'power2.in' }, 0)
      return
    }

    const noteRect = noteBtn.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()

    const tl = gsap.timeline({
      onComplete: () => {
        finishClose()
      },
    })
    activeTimeline = tl

    tl.to(content, { opacity: 0, duration: duration * 0.35, ease: 'power2.in' }, 0)
    tl.to(dim, { opacity: 0, duration, ease: 'power2.inOut' }, 0)

    const state = Flip.getState(paper)
    gsap.set(paper, {
      position: 'absolute',
      top: noteRect.top - overlayRect.top,
      left: noteRect.left - overlayRect.left,
      width: noteRect.width,
      height: noteRect.height,
      marginTop: 0,
    })

    tl.add(
      Flip.from(state, {
        duration,
        ease: 'power2.inOut',
        absolute: true,
      }),
      duration * 0.1,
    )
  }

  function clearPaperLayoutProps(opacity = 0): void {
    if (!paper) return
    gsap.set(paper, {
      clearProps:
        'transform,width,height,top,left,right,bottom,margin,position,scale,x,y',
      opacity,
    })
  }

  function finishClose(): void {
    if (!noteBtn || !overlay || !paper) return

    isOpen = false
    isAnimating = false
    activeTimeline = null
    noteBtn.dataset.open = 'false'
    noteBtn.setAttribute('aria-expanded', 'false')
    overlay.dataset.open = 'false'
    overlay.setAttribute('aria-hidden', 'true')

    clearPaperLayoutProps(0)
    gsap.set(dim, { opacity: 0 })
    gsap.set(content, { opacity: 0 })

    onOpenChange?.(false)

    const focusTarget = previousFocus ?? noteBtn
    previousFocus = null
    if (noteVisible) {
      focusTarget.focus({ preventScroll: true })
    }
  }

  function hideNoteImmediate(): void {
    clearAppearTimer()
    if (!noteBtn) return
    gsap.killTweensOf(noteBtn)
    noteVisible = false
    noteBtn.dataset.visible = 'false'
    noteBtn.dataset.open = 'false'
    noteBtn.setAttribute('aria-expanded', 'false')
    gsap.set(noteBtn, { opacity: 0, scale: 1, y: 0 })
  }

  return {
    mount({ appRoot: app, doorViewport: viewport, onOpenChange: openCb }) {
      appRoot = app
      doorViewport = viewport
      onOpenChange = openCb ?? null

      noteBtn = buildNote()
      doorViewport.appendChild(noteBtn)

      overlay = buildOverlay()
      overlay.style.setProperty(
        '--guestbook-dim-opacity',
        String(transitions.guestbookDimOpacity),
      )
      appRoot.appendChild(overlay)
      renderList()

      window.addEventListener('keydown', onKeyDown)
    },

    showClosedNote() {
      if (!noteBtn) return
      clearAppearTimer()
      killActiveTimeline()

      if (isOpen) {
        finishClose()
      }

      noteVisible = true
      noteBtn.dataset.visible = 'true'
      noteBtn.dataset.open = 'false'
      noteBtn.setAttribute('aria-expanded', 'false')

      const reduced = prefersReducedMotion()
      const duration = reduced ? 0.2 : transitions.guestbookNoteAppearDuration

      gsap.set(noteBtn, {
        opacity: 0,
        scale: reduced ? 1 : 0.94,
        y: reduced ? 0 : -8,
      })

      appearTimer = setTimeout(() => {
        appearTimer = null
        if (!noteBtn || !noteVisible) return
        gsap.to(noteBtn, {
          opacity: 1,
          scale: 1,
          y: 0,
          duration,
          ease: 'power2.out',
          onComplete: () => {
            if (!noteBtn) return
            // Keep opacity; drop scale/y so CSS hover transform can apply.
            gsap.set(noteBtn, { clearProps: 'transform,scale,y' })
            noteBtn.style.opacity = '1'
          },
        })
      }, transitions.guestbookNoteAppearDelayMs)
    },

    closeExpanded() {
      clearAppearTimer()
      killActiveTimeline()
      if (!isOpen) {
        // Ensure taped note stays visible after a visit restart.
        if (noteVisible && noteBtn) {
          noteBtn.dataset.open = 'false'
          noteBtn.setAttribute('aria-expanded', 'false')
          noteBtn.dataset.visible = 'true'
          noteBtn.style.opacity = '1'
        }
        return
      }

      isOpen = false
      isAnimating = false
      if (overlay) {
        overlay.dataset.open = 'false'
        overlay.setAttribute('aria-hidden', 'true')
      }
      clearPaperLayoutProps(0)
      if (dim) gsap.set(dim, { opacity: 0 })
      if (content) gsap.set(content, { opacity: 0 })
      if (noteBtn) {
        noteBtn.dataset.open = 'false'
        noteBtn.setAttribute('aria-expanded', 'false')
      }
      onOpenChange?.(false)
      previousFocus = null
    },

    reset() {
      clearAppearTimer()
      killActiveTimeline()
      if (isOpen) {
        isOpen = false
        isAnimating = false
        if (overlay) {
          overlay.dataset.open = 'false'
          overlay.setAttribute('aria-hidden', 'true')
        }
        clearPaperLayoutProps(0)
        if (dim) gsap.set(dim, { opacity: 0 })
        if (content) gsap.set(content, { opacity: 0 })
        onOpenChange?.(false)
      }
      hideNoteImmediate()
      previousFocus = null
    },

    destroy() {
      this.reset()
      window.removeEventListener('keydown', onKeyDown)
      noteBtn?.removeEventListener('click', onNoteClick)
      noteBtn?.removeEventListener('pointerdown', onNotePointerDown)
      dim?.removeEventListener('click', onDimClick)
      closeBtn?.removeEventListener('click', onCloseClick)
      paper?.removeEventListener('click', onPaperClick)
      noteBtn?.remove()
      overlay?.remove()
      unregisterPaperAudio?.()
      unregisterPaperAudio = null
      paperAudio = null
      noteBtn = null
      overlay = null
      dim = null
      paper = null
      content = null
      closeBtn = null
      listEl = null
      appRoot = null
      doorViewport = null
      onOpenChange = null
    },
  }
}
