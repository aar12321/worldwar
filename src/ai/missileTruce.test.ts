import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AI_TRUCE, MW } from '../data/missileWar'
import { DEALINGS } from '../data/relations'
import { PROPOSAL_TURNS } from '../engine/diplomacy'
import { lineMap, setMilitary, startState } from '../engine/__tests__/fixtures'
import { normalizeGame } from '../engine/migrate'
import { exchangeOf, truceAnswer, truceNeed, trucePair, truceWilling } from '../engine/missileWar'
import { validateOrder } from '../engine/orders'
import { resolveTurn } from '../engine/resolveTurn'
import type { GameState, Order, SalvoReport } from '../engine/types'
import { generateBotOrders } from './bot'
import { missileTruceOffers } from './missileTruce'
import { isRivalTruceOffer, rivalTruceOffers } from '../ui/missileWarText'

const map = lineMap(6)

/**
 * r0 is the player, armed (a launch site and a store of cruise missiles), at war with r1, an AI rival on Hard with no missiles and no
 * shield that r0 struck last month: r1 is under fire with nothing to answer with.
 */
function underFire(): GameState {
  const s = startState(map)
  s.settings.difficulty = 'hard'
  s.wars.push('r0|r1')
  s.warStarted['r0|r1'] = s.turn
  s.regions.r0.buildings.factory = 1
  s.nations.r0.arsenal = { cruise: 20 }
  s.nations.r1.personality = 'honorable'
  setMilitary(s, 'r1', { infantry: 6 })
  s.nations.r1.struckBy = { r0: s.turn - 1 }
  return s
}

/** A salvo on record, `from` at `to`, `dead` millions killed. */
function salvo(s: GameState, from: string, to: string, dead: number, turn = s.turn - 1, auto = false): void {
  const r = { id: `x${(s.salvos ?? []).length}`, turn, from, to, region: to, weapon: 'missile', kind: 'cruise', aim: 'country', fired: 4, hit: 2, shield: 0, batteries: 0, patrol: 0, fighters: 0, interceptorsUsed: 0, coverage: 1, dead, line: 0, factories: false, buildings: 0, army: 0, stock: 0, site: false, aircraftLost: 0, ...(auto ? { auto: true } : {}) } as SalvoReport
  ;(s.salvos ??= []).push(r)
}

const offers = (s: GameState, id = 'r1', skill: 0 | 1 | 2 = 2, orders: Order[] = []) => missileTruceOffers(s, id, skill, orders)
const toPlayer = (s: GameState) => offers(s).some((o) => o.type === 'missileTruce' && o.target === 'r0')

const was = { ...AI_TRUCE }
beforeEach(() => {
  // The monthly draw is tested on its own; everywhere else a rival with a reason offers.
  AI_TRUCE.chance = 1
})
afterEach(() => {
  Object.assign(AI_TRUCE, was)
  DEALINGS.on = true
})

describe('what makes a rival offer a missile ceasefire', () => {
  it('under fire with nothing to answer with: it offers the player one, and the offer is valid', () => {
    const s = underFire()
    expect(truceWilling(s, 'r1', 'r0')).toMatchObject({ accepts: true, why: expect.stringMatching(/nothing to answer/) })
    const [o] = offers(s)
    expect(o).toEqual({ type: 'missileTruce', nationId: 'r1', target: 'r0' })
    expect(validateOrder(s, map, o)).toBeNull()
  })

  it('under fire with its interceptor store nearly empty, even with missiles of its own', () => {
    const s = underFire()
    s.nations.r1.arsenal = { cruise: 10 }
    expect(toPlayer(s)).toBe(false)
    s.nations.r1.systems.shield = 2
    s.nations.r1.missileWar = { interceptors: 2 }
    expect(truceWilling(s, 'r1', 'r0').why).toMatch(/interceptor store/)
    expect(toPlayer(s)).toBe(true)
    s.nations.r1.missileWar = { interceptors: 12 }
    expect(toPlayer(s)).toBe(false)
  })

  it('losing the exchange with that enemy lately (the kill ledger of the salvos on record)', () => {
    const s = underFire()
    s.nations.r1.arsenal = { cruise: 10 }
    s.nations.r1.struckBy = { r0: s.turn - 4 }
    salvo(s, 'r0', 'r1', 0.5, s.turn - 4)
    salvo(s, 'r1', 'r0', 0.2, s.turn - 3)
    expect(exchangeOf(s, 'r1', 'r0')).toMatchObject({ dealt: 0.2, taken: 0.5 })
    expect(truceWilling(s, 'r1', 'r0').why).toMatch(/losing the missile exchange/)
    expect(toPlayer(s)).toBe(true)
    // Winning it: no reason.
    salvo(s, 'r1', 'r0', 0.6, s.turn - 3)
    expect(toPlayer(s)).toBe(false)
  })

  it('more lost than dealt in the whole missile war (the older rule), to an enemy it is exchanging fire with', () => {
    const s = underFire()
    s.nations.r1.arsenal = { cruise: 10 }
    s.nations.r1.missileWar = { ledger: { fired: 4, hits: 1, shotDown: 3, killed: 0, lost: 3, lineDealt: 0, lineTaken: 2, sitesHit: 0, stockDestroyed: 0, interceptorsSpent: 0, aircraftLost: 0 } }
    expect(toPlayer(s)).toBe(true)
  })

  it('the world on edge: an enemy holding missiles is offered one even with no exchange between them', () => {
    const s = underFire()
    s.nations.r1.arsenal = { cruise: 10 }
    delete s.nations.r1.struckBy
    expect(toPlayer(s)).toBe(false)
    s.missileTension = truceNeed(s, s.nations.r1)
    expect(toPlayer(s)).toBe(true)
    // An unarmed enemy it is not exchanging fire with is not.
    s.nations.r0.arsenal = {}
    expect(toPlayer(s)).toBe(false)
  })

  it('its temperament moves the tension it needs: a merchant offers where an expansionist holds on', () => {
    const s = underFire()
    s.nations.r1.arsenal = { cruise: 10 }
    s.missileTension = 30
    s.nations.r1.personality = 'trader'
    expect(truceNeed(s, s.nations.r1)).toBe(24)
    expect(toPlayer(s)).toBe(true)
    s.nations.r1.personality = 'expansionist'
    expect(truceNeed(s, s.nations.r1)).toBe(56)
    expect(toPlayer(s)).toBe(false)
    // Switched off, the need is the difficulty's alone.
    AI_TRUCE.on = false
    expect(truceNeed(s, s.nations.r1)).toBe(MW.truceTension[2])
  })

  it('a calm rival that is winning offers nothing', () => {
    const s = underFire()
    s.nations.r1.arsenal = { cruise: 10 }
    salvo(s, 'r1', 'r0', 0.4, s.turn - 3)
    expect(truceWilling(s, 'r1', 'r0').accepts).toBe(false)
    expect(offers(s)).toEqual([])
  })

  it('what it offers is what it would accept: the player offering the same is accepted', () => {
    const s = underFire()
    expect(toPlayer(s)).toBe(true)
    expect(truceAnswer(s, 'r1', 'r0').accepts).toBe(true)
  })
})

describe('when a rival holds back', () => {
  it('never right after it escalated: its own salvo at that enemy this month or last, or a strike ordered this month', () => {
    const s = underFire()
    salvo(s, 'r1', 'r0', 0.01, s.turn - 1)
    expect(toPlayer(s)).toBe(false)
    // Two months ago is not "just".
    s.salvos = []
    salvo(s, 'r1', 'r0', 0.01, s.turn - 2)
    expect(toPlayer(s)).toBe(true)
    // A doctrine's automatic answer is not an escalation.
    s.salvos = []
    salvo(s, 'r1', 'r0', 0.01, s.turn - 1, true)
    expect(toPlayer(s)).toBe(true)
    // A strike, a raid or a warhead ordered this month on that enemy.
    expect(offers(s, 'r1', 2, [{ type: 'strike', nationId: 'r1', target: 'r0', weapon: 'missile', kind: 'cruise', count: 2 }])).toEqual([])
    expect(offers(s, 'r1', 2, [{ type: 'raid', nationId: 'r1', target: 'r0' }])).toEqual([])
    // Or firing on warning.
    expect(offers(s, 'r1', 2, [{ type: 'setDoctrine', nationId: 'r1', doctrine: 'warning' }])).toEqual([])
  })

  it('not while a ceasefire holds, nor while an offer waits either way', () => {
    const s = underFire()
    s.truces = { 'r0|r1': s.turn + 3 }
    expect(toPlayer(s)).toBe(false)
    delete s.truces
    s.proposals.push({ kind: 'truce', id: 'p1', from: 'r0', to: 'r1', created: s.turn, expires: s.turn + PROPOSAL_TURNS })
    expect(toPlayer(s)).toBe(false)
  })

  it('Easy rivals never offer, Normal and Hard do; switched off nobody does; a player is never made to', () => {
    const s = underFire()
    expect(offers(s, 'r1', 0)).toEqual([])
    expect(offers(s, 'r1', 1)).toHaveLength(1)
    expect(offers(s, 'r0', 2)).toEqual([])
    AI_TRUCE.on = false
    expect(offers(s)).toEqual([])
    AI_TRUCE.on = true
    MW.enabled = false
    try {
      expect(offers(s)).toEqual([])
    } finally {
      MW.enabled = true
    }
  })

  it('without the offer path between players (DEALINGS off) a player is not offered one', () => {
    const s = underFire()
    DEALINGS.on = false
    expect(toPlayer(s)).toBe(false)
  })

  it('makes its offer on about the share of months the data says, from its own random stream', () => {
    AI_TRUCE.chance = 0.6
    let made = 0
    for (let t = 2; t < 102; t++) {
      const s = underFire()
      s.turn = t
      s.nations.r1.struckBy = { r0: t - 1 }
      if (toPlayer(s)) made++
      // The same month gives the same answer.
      expect(toPlayer(s)).toBe(toPlayer(s))
    }
    expect(made).toBeGreaterThan(45)
    expect(made).toBeLessThan(75)
  })
})

describe('rate limits on offers to a player', () => {
  it(`one every ${AI_TRUCE.every} months to the same player`, () => {
    const s = underFire()
    s.turn = 10
    s.nations.r1.struckBy = { r0: 9 }
    s.proposalMemory['r1>r0:truce'] = 10 - (AI_TRUCE.every - 1)
    expect(toPlayer(s)).toBe(false)
    s.proposalMemory['r1>r0:truce'] = 10 - AI_TRUCE.every
    expect(toPlayer(s)).toBe(true)
  })

  it(`after a decline, none for ${AI_TRUCE.afterRefusal} months; a lapsed offer counts as declined; the memory is dropped once the wait is over`, () => {
    let s = underFire()
    s.turn = 3
    s.nations.r1.struckBy = { r0: 2 }
    const orders = generateBotOrders(s, map, 'r1')
    expect(orders).toContainEqual({ type: 'missileTruce', nationId: 'r1', target: 'r0' })
    s = resolveTurn(s, map, orders)
    const offer = s.proposals.find((p) => p.kind === 'truce')!
    expect(offer).toMatchObject({ from: 'r1', to: 'r0' })
    expect(s.dispatches.some((d) => d.kind === 'proposal' && d.from === 'r1' && d.to === 'r0' && d.proposalKind === 'truce')).toBe(true)
    // Declined.
    s = resolveTurn(s, map, [{ type: 'respond', nationId: 'r0', proposalId: offer.id, accept: false }])
    expect(s.truceRefused).toEqual({ 'r1>r0': s.turn - 1 })
    expect(trucePair(s, 'r0', 'r1')).toBeNull()
    const declined = s.turn - 1
    for (let t = declined + 1; t < declined + AI_TRUCE.afterRefusal; t++) {
      s.turn = t
      s.nations.r1.struckBy = { r0: t - 1 }
      expect(toPlayer(s), `turn ${t}`).toBe(false)
    }
    s.turn = declined + AI_TRUCE.afterRefusal
    s.nations.r1.struckBy = { r0: s.turn - 1 }
    expect(toPlayer(s)).toBe(true)
    // A lapsed offer is remembered the same way, and the memory is dropped after the wait.
    const t = underFire()
    t.proposals.push({ kind: 'truce', id: 'p9', from: 'r1', to: 'r0', created: t.turn - PROPOSAL_TURNS - 1, expires: t.turn - 1 })
    let u = resolveTurn(t, map, [])
    expect(u.truceRefused?.['r1>r0']).toBe(u.turn)
    for (let i = 0; i <= AI_TRUCE.afterRefusal; i++) u = resolveTurn(u, map, [])
    expect(u.truceRefused).toBeUndefined()
  })

  it('accepted, the ceasefire holds and nothing more is offered', () => {
    let s = underFire()
    s = resolveTurn(s, map, [{ type: 'missileTruce', nationId: 'r1', target: 'r0' }])
    const offer = s.proposals.find((p) => p.kind === 'truce')!
    s = resolveTurn(s, map, [{ type: 'respond', nationId: 'r0', proposalId: offer.id, accept: true }])
    expect(trucePair(s, 'r0', 'r1')).not.toBeNull()
    expect(s.truceRefused).toBeUndefined()
    s.nations.r1.struckBy = { r0: s.turn - 1 }
    expect(toPlayer(s)).toBe(false)
  })

  it('a player declining another player\'s offer is not remembered as a rival\'s refusal', () => {
    let s = underFire()
    s.humans = ['r0', 'r1']
    s.nations.r1.isPlayer = true
    s = resolveTurn(s, map, [{ type: 'missileTruce', nationId: 'r0', target: 'r1' }])
    const offer = s.proposals.find((p) => p.kind === 'truce')!
    s = resolveTurn(s, map, [{ type: 'respond', nationId: 'r1', proposalId: offer.id, accept: false }])
    expect(s.truceRefused).toBeUndefined()
  })
})

describe('between rivals', () => {
  it('offered on the spot, only to a rival that would accept, and made at once', () => {
    let s = underFire()
    // r1 and r2 are both rivals; r2 struck r1 last month and r1 has nothing to answer with.
    s.wars = ['r1|r2']
    s.warStarted = { 'r1|r2': s.turn }
    s.nations.r2.arsenal = { cruise: 10 }
    s.regions.r2.buildings.factory = 1
    s.nations.r2.personality = 'honorable'
    s.nations.r1.struckBy = { r2: s.turn - 1 }
    // r2 is winning and calm: it would refuse, so r1 does not ask.
    expect(offers(s)).toEqual([])
    // r2 is losing the exchange: it would accept, so r1 asks, and it is made at once.
    salvo(s, 'r1', 'r2', 0.5, s.turn - 3)
    expect(offers(s)).toEqual([{ type: 'missileTruce', nationId: 'r1', target: 'r2' }])
    s = resolveTurn(s, map, offers(s))
    expect(trucePair(s, 'r1', 'r2')).not.toBeNull()
    expect(s.proposals).toEqual([])
  })
})

describe('the player hears of it', () => {
  it('a toast names the rival and where to answer, once; the generic dispatch line is not repeated', () => {
    const before = underFire()
    const after = resolveTurn(before, map, [{ type: 'missileTruce', nationId: 'r1', target: 'r0' }])
    const lines = rivalTruceOffers(before, after, 'r0')
    expect(lines).toEqual([expect.stringMatching(new RegExp(`^${after.nations.r1.name} offers you a missile ceasefire.*Diplomacy`))])
    expect(rivalTruceOffers(after, after, 'r0')).toEqual([])
    expect(rivalTruceOffers(before, after, 'r1')).toEqual([])
    const d = after.dispatches.find((x) => x.proposalKind === 'truce')!
    expect(isRivalTruceOffer(after, d, 'r0')).toBe(true)
    // Another player's offer is not a rival's: it keeps the usual line.
    expect(isRivalTruceOffer({ humans: ['r0', 'r1'] }, d, 'r0')).toBe(false)
  })
})

describe('old saves', () => {
  it('a save without the refusal record loads and plays; one with it keeps it', () => {
    const s = underFire()
    const old = JSON.parse(JSON.stringify(s)) as GameState
    delete old.truceRefused
    const loaded = normalizeGame(old, map)
    expect(loaded.truceRefused).toBeUndefined()
    expect(() => resolveTurn(loaded, map, generateBotOrders(loaded, map, 'r1'))).not.toThrow()
    const kept = normalizeGame({ ...JSON.parse(JSON.stringify(s)), truceRefused: { 'r1>r0': s.turn } }, map)
    expect(kept.truceRefused).toEqual({ 'r1>r0': s.turn })
  })
})
