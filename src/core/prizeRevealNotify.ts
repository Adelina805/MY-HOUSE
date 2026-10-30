/**
 * Ensures onPrizeRevealed / recordAward runs exactly once per candy visit,
 * even when detach and grab/idle outro timers race.
 */
export interface PrizeRevealGate<T> {
  /** Returns true the first time a prize is accepted; false if already notified. */
  ensure(prize: T): boolean
  /** Whether ensure has already accepted a prize this visit. */
  readonly notified: boolean
  reset(): void
}

export function createPrizeRevealGate<T>(
  notify: (prize: T) => void,
): PrizeRevealGate<T> {
  let notified = false
  return {
    get notified() {
      return notified
    },
    ensure(prize) {
      if (notified) return false
      notified = true
      notify(prize)
      return true
    },
    reset() {
      notified = false
    },
  }
}
