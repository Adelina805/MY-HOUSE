import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { assets } from '../config/assets'
import { transitions } from '../config/transitions'
import type { PublicVisitor } from '../data/apiContract'
import { guestbookRepository, visitorSession } from '../data/backend'
import type { GuestbookEntry, GuestbookStats } from '../data/guestbookRepository'
import { ensureAudioUnlocked, playSfx } from './soundState'

gsap.registerPlugin(Flip)

/** Reopening after this long fetches the newest entries and totals again. */
const GUESTBOOK_STALE_MS = 60_000
/** get-guestbook may serve a first page up to 5 s old (HTTP and per-instance cache). */
const FIRST_PAGE_CACHE_MS = 6000
const STAT_PLACEHOLDER = '–'

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

/** "an apple", "a USB flash drive", "some tacos". */
function articleForObject(name: string): 'a' | 'an' | 'some' {
  const trimmed = name.trim()
  if (/[^s]s$/i.test(trimmed) && !/\bof\b/i.test(trimmed)) return 'some'
  // Initialisms are read letter by letter: "an MRI", "a USB".
  if (/^[A-Z]{2,}\b/.test(trimmed)) return /^[AEFHILMNORSX]/.test(trimmed) ? 'an' : 'a'
  return /^[aeiou]/i.test(trimmed) ? 'an' : 'a'
}

/** Varies the wording between entries while keeping each gift's sentence stable across loads. */
function entryAction(awardId: string): 'received' | 'got' {
  return Number.parseInt(awardId.slice(-1), 16) % 2 === 0 ? 'received' : 'got'
}

function buildEntrySentence(entry: GuestbookEntry): DocumentFragment {
  const frag = document.createDocumentFragment()
  frag.append(
    document.createTextNode(
      `${entryAction(entry.awardId)} ${articleForObject(entry.objectName)} `,
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
  let onOpenChange: ((open: boolean) => void) | null = null
  let isOpen = false
  let isAnimating = false
  let noteVisible = false
  let previousFocus: HTMLElement | null = null
  let activeTimeline: gsap.core.Timeline | null = null

  let noteVisitorEl: HTMLElement | null = null
  let statValueEls: HTMLElement[] = []
  let statusEl: HTMLLIElement | null = null
  let stats: GuestbookStats | null = null
  let entries: GuestbookEntry[] = []
  const entryIds = new Set<string>()
  let nextCursor: string | null = null
  let loadedAt = 0
  let awardRecordedSinceLoad = false
  let lastAwardRecordedAt = Number.NEGATIVE_INFINITY
  let loading: 'first' | 'more' | null = null
  let loadError: 'first' | 'more' | 'cursor' | null = null
  /** Bumped by each first-page load so slower, older responses are ignored. */
  let generation = 0
  let unsubscribeVisitor: (() => void) | null = null
  let unsubscribeAwards: (() => void) | null = null

  const onListScroll = (): void => {
    maybeLoadMore()
  }

  const onRetryClick = (event: Event): void => {
    event.stopPropagation()
    if (loadError === 'more') {
      void loadMore()
    } else {
      void loadFirstPage()
    }
  }

  const onAwardRecorded = (): void => {
    awardRecordedSinceLoad = true
    lastAwardRecordedAt = Date.now()
  }

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

  function playPaperSound(): void {
    ensureAudioUnlocked()
    playSfx('paper')
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

  function buildEntry(entry: GuestbookEntry, now: Date): HTMLLIElement {
    const li = document.createElement('li')
    li.className = 'guestbook-overlay__entry'

    const visitor = document.createElement('p')
    visitor.className = 'guestbook-overlay__entry-visitor'
    visitor.textContent = entry.alias

    const time = document.createElement('p')
    time.className = 'guestbook-overlay__entry-time'
    time.textContent = formatEntryTime(entry.awardedAt, now)

    const text = document.createElement('p')
    text.className = 'guestbook-overlay__entry-text'
    text.append(buildEntrySentence(entry))

    li.append(visitor, time, text)
    return li
  }

  function renderNoteVisitor(visitor: PublicVisitor | null): void {
    if (!noteVisitorEl) return
    noteVisitorEl.textContent = visitor
      ? `You're visitor #${formatVisitorCount(visitor.visitorNumber)}`
      : ''
  }

  function renderStats(): void {
    const values = stats
      ? [stats.visitorCount, stats.giftsGiven, stats.doorKnocks].map(formatVisitorCount)
      : [STAT_PLACEHOLDER, STAT_PLACEHOLDER, STAT_PLACEHOLDER]
    statValueEls.forEach((el, index) => {
      el.textContent = values[index] ?? STAT_PLACEHOLDER
    })
  }

  function statusCopy(): { text: string; retry: boolean } | null {
    if (loading === 'more') return { text: 'loading…', retry: false }
    if (loadError === 'more' || loadError === 'cursor') {
      return { text: "couldn't load older visitors.", retry: true }
    }
    if (entries.length > 0) return null
    if (loading === 'first') return { text: 'loading…', retry: false }
    if (loadError === 'first') return { text: "couldn't reach the guestbook.", retry: true }
    if (loadedAt > 0) return { text: 'no gifts given yet.', retry: false }
    return null
  }

  /** Loading, empty and error messages share one row at the end of the list. */
  function renderStatus(): void {
    if (!listEl) return
    listEl.setAttribute('aria-busy', loading === null ? 'false' : 'true')
    const copy = statusCopy()
    if (!copy) {
      statusEl?.remove()
      statusEl = null
      return
    }
    statusEl ??= document.createElement('li')
    statusEl.className = 'guestbook-overlay__status'
    const text = document.createElement('p')
    text.className = 'guestbook-overlay__status-text'
    text.textContent = copy.text
    statusEl.replaceChildren(text)
    if (copy.retry) {
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'guestbook-overlay__retry'
      retry.textContent = 'try again'
      retry.addEventListener('click', onRetryClick)
      statusEl.append(retry)
    }
    listEl.append(statusEl)
  }

  function appendEntries(page: GuestbookEntry[]): void {
    if (!listEl) return
    const now = new Date()
    for (const entry of page) {
      if (entryIds.has(entry.awardId)) continue
      entryIds.add(entry.awardId)
      entries.push(entry)
      listEl.insertBefore(buildEntry(entry, now), statusEl)
    }
  }

  async function loadFirstPage(): Promise<void> {
    const current = ++generation
    const startedAt = Date.now()
    loading = 'first'
    loadError = null
    renderStatus()
    const result = await guestbookRepository.loadPage(null)
    if (current !== generation) return
    loading = null
    if (!result.ok) {
      // Keep showing earlier results rather than replacing real data with an error.
      if (entries.length === 0) loadError = 'first'
      renderStatus()
      return
    }
    stats = result.page.stats
    nextCursor = result.page.nextCursor
    loadedAt = Date.now()
    // A cached page requested soon after a gift may not include it yet.
    awardRecordedSinceLoad = startedAt - lastAwardRecordedAt < FIRST_PAGE_CACHE_MS
    entries = []
    entryIds.clear()
    statusEl = null
    listEl?.replaceChildren()
    appendEntries(result.page.entries)
    if (listEl) listEl.scrollTop = 0
    renderStats()
    renderStatus()
    maybeLoadMore()
  }

  async function loadMore(): Promise<void> {
    const cursor = nextCursor
    if (!cursor || loading !== null) return
    const current = generation
    loading = 'more'
    loadError = null
    renderStatus()
    const result = await guestbookRepository.loadPage(cursor)
    if (current !== generation) return
    loading = null
    if (!result.ok) {
      // A rejected cursor means starting over from the newest entries.
      loadError = result.reason === 'invalid_cursor' ? 'cursor' : 'more'
      renderStatus()
      return
    }
    nextCursor = result.page.nextCursor
    appendEntries(result.page.entries)
    renderStatus()
    maybeLoadMore()
  }

  /** Fetches older entries once the visitor scrolls within a screen of the end. */
  function maybeLoadMore(): void {
    if (!isOpen || !listEl || !nextCursor || loading !== null || loadError !== null) return
    const remaining = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight
    if (remaining <= Math.max(listEl.clientHeight, 120)) void loadMore()
  }

  function refreshIfStale(): void {
    if (loading === 'first') return
    const stale =
      loadedAt === 0 ||
      awardRecordedSinceLoad ||
      Date.now() - loadedAt > GUESTBOOK_STALE_MS
    if (stale) {
      void loadFirstPage()
    } else {
      maybeLoadMore()
    }
  }

  function buildOverlay(): HTMLElement {
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

    const statLabels = ['visitors', 'gifts given', 'door knocks']

    statValueEls = []
    for (const statLabel of statLabels) {
      const stat = document.createElement('div')
      stat.className = 'guestbook-overlay__stat'
      const value = document.createElement('span')
      value.className = 'guestbook-overlay__stat-value'
      value.textContent = STAT_PLACEHOLDER
      const label = document.createElement('span')
      label.className = 'guestbook-overlay__stat-label'
      label.textContent = statLabel
      stat.append(value, label)
      statsRow.append(stat)
      statValueEls.push(value)
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
    list.addEventListener('scroll', onListScroll, { passive: true })

    return root
  }

  function buildNote(): HTMLButtonElement {
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
    noteVisitorEl = visitor

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
    refreshIfStale()

    killActiveTimeline()
    gsap.set(dim, { opacity: 0 })
    // Content and close stay hidden while the paper shell Flips so UI is never scaled.
    gsap.set([content, closeBtn], { opacity: 0 })

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
        [content, closeBtn],
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
      [content, closeBtn],
      { opacity: 1, duration: duration * 0.4, ease: 'power2.out' },
      duration * 0.6,
    )
  }

  async function closeGuestbook(): Promise<void> {
    if (!noteBtn || !overlay || !paper || !dim || !content || !closeBtn) return
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
      tl.to(
        [content, closeBtn],
        { opacity: 0, duration: duration * 0.5, ease: 'power2.in' },
        0,
      )
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

    tl.to(
      [content, closeBtn],
      { opacity: 0, duration: duration * 0.35, ease: 'power2.in' },
      0,
    )
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
    gsap.set([content, closeBtn], { opacity: 0 })

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
      renderStats()
      renderStatus()
      unsubscribeVisitor = visitorSession.subscribeVisitor(renderNoteVisitor)
      unsubscribeAwards = visitorSession.onAwardRecorded(onAwardRecorded)

      window.addEventListener('keydown', onKeyDown)
    },

    showClosedNote() {
      if (!noteBtn) return
      clearAppearTimer()
      killActiveTimeline()
      refreshIfStale()

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
      if (closeBtn) gsap.set(closeBtn, { opacity: 0 })
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
        if (closeBtn) gsap.set(closeBtn, { opacity: 0 })
        onOpenChange?.(false)
      }
      hideNoteImmediate()
      previousFocus = null
    },

    destroy() {
      this.reset()
      generation += 1
      unsubscribeVisitor?.()
      unsubscribeVisitor = null
      unsubscribeAwards?.()
      unsubscribeAwards = null
      listEl?.removeEventListener('scroll', onListScroll)
      window.removeEventListener('keydown', onKeyDown)
      noteBtn?.removeEventListener('click', onNoteClick)
      noteBtn?.removeEventListener('pointerdown', onNotePointerDown)
      dim?.removeEventListener('click', onDimClick)
      closeBtn?.removeEventListener('click', onCloseClick)
      paper?.removeEventListener('click', onPaperClick)
      noteBtn?.remove()
      overlay?.remove()
      noteBtn = null
      overlay = null
      dim = null
      paper = null
      content = null
      closeBtn = null
      listEl = null
      statusEl = null
      noteVisitorEl = null
      statValueEls = []
      appRoot = null
      doorViewport = null
      onOpenChange = null
    },
  }
}
