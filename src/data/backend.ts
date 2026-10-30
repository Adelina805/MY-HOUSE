import { createApiClient, parseApiConfig } from './apiClient'
import { createGuestbookRepository } from './guestbookRepository'
import { createVisitorSession, type KeyValueStorage } from './visitorSession'

/*
 * The only module that reads the Supabase settings. Both values are public and end up in the
 * browser bundle; vite.config.ts refuses to build if a secret is put in a VITE_ variable.
 */
const configResult = parseApiConfig({
  url: import.meta.env.VITE_SUPABASE_URL,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
})

if (!configResult.ok) {
  console.warn(`[my-house] Visit tracking and the guestbook are offline: ${configResult.problem}`)
}

const api = createApiClient(configResult.ok ? configResult.config : null, {
  fetch: (input, init) => globalThis.fetch(input, init),
})

function sessionStorageOrNull(): KeyValueStorage | null {
  try {
    const storage = window.sessionStorage
    storage.setItem('my-house:probe', '1')
    storage.removeItem('my-house:probe')
    return storage
  } catch {
    return null
  }
}

export const visitorSession = createVisitorSession({
  api,
  storage: sessionStorageOrNull(),
  scheduler: {
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  },
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  warn: (message) => console.warn(`[my-house] ${message}`),
})

export const guestbookRepository = createGuestbookRepository(api)

let lifecycleBound = false

/** Registers or resumes the visit, and keeps unsent knocks and gifts moving across page events. */
export function startVisitorSession(): void {
  visitorSession.start()
  if (lifecycleBound) return
  lifecycleBound = true

  window.addEventListener('pagehide', () => visitorSession.flush({ keepalive: true }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      visitorSession.flush({ keepalive: true })
    } else {
      visitorSession.start()
    }
  })
  window.addEventListener('online', () => visitorSession.start())
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) visitorSession.start()
  })
}
