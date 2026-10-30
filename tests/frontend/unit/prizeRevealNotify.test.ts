import { assertEquals } from '@std/assert'
import { createPrizeRevealGate } from '../../../src/core/prizeRevealNotify.ts'

Deno.test('ensure notifies exactly once for the first prize', () => {
  const seen: string[] = []
  const gate = createPrizeRevealGate<string>((prize) => seen.push(prize))

  assertEquals(gate.notified, false)
  assertEquals(gate.ensure('first'), true)
  assertEquals(gate.notified, true)
  assertEquals(gate.ensure('second'), false)
  assertEquals(gate.ensure('first'), false)
  assertEquals(seen, ['first'])
})

Deno.test('reset allows a later visit to notify again', () => {
  const seen: string[] = []
  const gate = createPrizeRevealGate<string>((prize) => seen.push(prize))

  gate.ensure('visit-1')
  gate.reset()
  assertEquals(gate.notified, false)
  assertEquals(gate.ensure('visit-2'), true)
  assertEquals(seen, ['visit-1', 'visit-2'])
})

/**
 * Mirrors the detach → late emitCuppedOutro race: detach forces "revealing"
 * without a prior notify; a pending outro timer then calls ensure again.
 * Recording must still happen exactly once.
 */
Deno.test('detach-then-late-outro race still records exactly once', () => {
  const seen: string[] = []
  const gate = createPrizeRevealGate<{ id: string }>((prize) => seen.push(prize.id))
  const prize = { id: 'padres-baseball' }

  // detachRummageForGoodbye path: force revealing, then ensure
  let state: 'grabbing' | 'revealing' = 'grabbing'
  state = 'revealing'
  gate.ensure(prize)

  // Late grabFinishTimer / beginCuppedOutro timer: emitCuppedOutro when already revealing
  if (state === 'revealing') {
    gate.ensure(prize)
  }

  assertEquals(seen, ['padres-baseball'])
})

Deno.test('normal grab path notifies once when emit runs first', () => {
  const seen: string[] = []
  const gate = createPrizeRevealGate<string>((prize) => seen.push(prize))

  // emitCuppedOutro
  gate.ensure('apple')
  // leaveCandy belt-and-suspenders ensurePrizeRevealed before door transition
  gate.ensure('apple')
  // detach also ensures
  gate.ensure('apple')

  assertEquals(seen, ['apple'])
})
