import { describe, expect, it } from 'vitest'
import type { GameState } from '../engine/types'
import { orderNews } from '../ui/livePresent'
import { gameOf, liveRoom, patchAll, type LiveSeat } from './liveHarness'

/** What each screen would toast for the orders it has seen since `from`, computed the way the store does it. */
function newsOf(x: LiveSeat, from: number, before: GameState) {
  let prev: GameState = { ...before, playerId: x.s.me! }
  const out: ReturnType<typeof orderNews> = []
  for (const e of x.orders.slice(from)) {
    out.push(...orderNews(prev, e.state, e.own))
    prev = e.state
  }
  return out
}

describe('live rooms: offers between friends are news on the day', () => {
  it('a friend hears of an offer at once, with a way to answer it, and the sender hears it went', async () => {
    const room = await liveRoom(2)
    const [host, guest] = room.seats
    patchAll(room, (g) => {
      for (const n of Object.values(g.nations)) n.resources.pp = 200
    })
    const hostBefore = structuredClone(gameOf(host))
    const guestBefore = structuredClone(gameOf(guest))
    const hostSeen = host.orders.length
    const guestSeen = guest.orders.length
    host.s.sendCommand({ type: 'propose', nationId: 'r0', target: 'r1', proposal: { kind: 'pact' } })
    await room.run(600)
    const toGuest = newsOf(guest, guestSeen, guestBefore)
    expect(toGuest).toHaveLength(1)
    expect(toGuest[0].tone).toBe('info')
    expect(toGuest[0].open).toBe('r0')
    expect(toGuest[0].text).toMatch(/proposes a non-aggression pact/i)
    const toHost = newsOf(host, hostSeen, hostBefore)
    expect(toHost).toHaveLength(1)
    expect(toHost[0].text).toMatch(/Offer sent to/)

    // The answer comes back to the one who asked, the same day.
    const offer = gameOf(guest).proposals.find((p) => p.from === 'r0' && p.to === 'r1')!
    const hostMid = structuredClone(gameOf(host))
    const hostMidSeen = host.orders.length
    const guestMid = structuredClone(gameOf(guest))
    const guestMidSeen = guest.orders.length
    guest.s.sendCommand({ type: 'respond', nationId: 'r1', proposalId: offer.id, accept: true })
    await room.run(600)
    const answer = newsOf(host, hostMidSeen, hostMid)
    expect(answer).toHaveLength(1)
    expect(answer[0].tone).toBe('success')
    expect(answer[0].text).toMatch(/accepted/)
    // The one who answered is not told their own answer twice over (their Diplomacy desk shows it).
    expect(newsOf(guest, guestMidSeen, guestMid).every((n) => !n.open)).toBe(true)
  })

  it('says nothing for orders that bring no diplomatic news, or across a month end', () => {
    const g = { turn: 3, playerId: 'a', dispatches: [], nations: {} } as unknown as GameState
    expect(orderNews(g, { ...g, dispatches: [] }, true)).toEqual([])
    const later = { ...g, turn: 4, dispatches: [{ kind: 'accepted', from: 'b', to: 'a', proposalKind: 'pact', text: 'x' }] } as unknown as GameState
    expect(orderNews(g, later, false)).toEqual([])
    expect(orderNews(null, later, false)).toEqual([])
  })
})
