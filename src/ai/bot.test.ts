import { describe, expect, it } from 'vitest'
import { createInitialState } from '../data/startingNations'
import { computeEconomy, militaryPower } from '../engine/economy'
import { applyEventChoice } from '../engine/events'
import { enemiesOf } from '../engine/helpers'
import { resolveTurn } from '../engine/resolveTurn'
import { createRng } from '../engine/rng'
import { giveRegions, lineMap, startState } from '../engine/__tests__/fixtures'
import type { Difficulty, GameState, Proposal, ProposalDraft } from '../engine/types'
import { getWorld } from '../map/world'
import { generateAllBotOrders, generateBotOrders } from './bot'
import { evaluateProposal, perceivedPower } from './diplomat'
import { addOpinion, coalitionActive, opinionReport } from './opinion'

const map = lineMap(4)

const proposal = (draft: ProposalDraft, from = 'r0', to = 'r1'): Proposal => ({ ...draft, id: 'p', from, to, created: 1, expires: 3 }) as Proposal

function friendly(s: GameState, amount: number) {
  for (const label of ['Gifts', 'Old friends', 'Shared history']) addOpinion(s, 'r1', 'r0', label, amount / 3)
}

describe('bots answer proposals like people', () => {
  it('accept an alliance from a friend facing a common enemy, refuse one from a nation they hate', () => {
    const s = startState(map)
    s.nations.r1.personality = 'honorable'
    s.wars.push('r0|r2', 'r1|r2')
    friendly(s, 60)
    const yes = evaluateProposal(s, map, 'r1', proposal({ kind: 'alliance' }), createRng(1))
    expect(yes.accept).toBe(true)
    expect(yes.reason).toMatch(/common enemy/)

    const t = startState(map)
    t.nations.r1.personality = 'honorable'
    friendly(t, -90)
    const no = evaluateProposal(t, map, 'r1', proposal({ kind: 'alliance' }), createRng(1))
    expect(no.accept).toBe(false)
    expect(no.reason).toMatch(/trust/)
    expect(no.reason).toMatch(/opinion -/)
  })

  it('take a fair trade and turn down a lowball', () => {
    const s = startState(map)
    s.nations.r1.personality = 'trader'
    s.nations.r1.resources.food = 200
    s.nations.r0.resources.capital = 500
    const fair = evaluateProposal(s, map, 'r1', proposal({ kind: 'trade', terms: { give: { capital: 40 }, receive: { food: 20 }, months: 0 } }), createRng(2))
    expect(fair.accept).toBe(true)
    const lowball = evaluateProposal(s, map, 'r1', proposal({ kind: 'trade', terms: { give: { capital: 2 }, receive: { food: 40 }, months: 0 } }), createRng(2))
    expect(lowball.accept).toBe(false)
    expect(lowball.reason).toMatch(/price is too low/)
  })

  it('refuse to hand over reserves they need', () => {
    const s = startState(map)
    s.nations.r1.resources.food = 10
    const v = evaluateProposal(s, map, 'r1', proposal({ kind: 'trade', terms: { give: { capital: 100 }, receive: { food: 8 }, months: 0 } }), createRng(3))
    expect(v.accept).toBe(false)
    expect(v.reason).toMatch(/cannot spare/)
  })

  it('a weary loser accepts peace, a fresh winner refuses it', () => {
    const s = startState(map)
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = 1
    s.turn = 10
    s.nations.r1.warWeariness = 40
    s.warScore['r0>r1'] = 30
    expect(evaluateProposal(s, map, 'r1', proposal({ kind: 'peace', terms: { cede: [], reparations: 0 } }), createRng(4)).accept).toBe(true)

    const t = startState(map)
    t.wars.push('r0|r1')
    t.warStarted['r0|r1'] = 1
    t.warScore['r1>r0'] = 40
    t.nations.r1.personality = 'expansionist'
    const v = evaluateProposal(t, map, 'r1', proposal({ kind: 'peace', terms: { cede: [], reparations: 0 } }), createRng(4))
    expect(v.accept).toBe(false)
  })
})

describe('bots play fair', () => {
  const { map: world } = getWorld()

  function run(difficulty: Difficulty, seed: number, turns: number, onTurn: (s: GameState) => void) {
    let s = createInitialState(world, { playerRegionId: 'china', seed, victoryShare: 0.6, difficulty })
    for (let i = 0; i < turns && s.outcome === 'playing'; i++) {
      if (s.pendingEvent) s = applyEventChoice(s, world, 0)
      s = resolveTurn(s, world, generateAllBotOrders(s, world))
      onTurn(s)
    }
  }

  it('easy rivals leave the player alone early and never gang up', () => {
    for (const seed of [3, 11]) {
      run('easy', seed, 30, (s) => {
        const wars = enemiesOf(s, s.playerId).filter((e) => !e.startsWith('free-'))
        if (s.turn <= 15) expect(wars, `turn ${s.turn}`).toHaveLength(0)
        expect(wars.length).toBeLessThanOrEqual(1)
      })
    }
  })

  it('send the player at most one new proposal a month and keep the inbox short', () => {
    run('normal', 5, 30, (s) => {
      const inbox = s.proposals.filter((p) => p.to === s.playerId)
      expect(inbox.filter((p) => p.created === s.turn - 1 && p.kind !== 'callToArms').length).toBeLessThanOrEqual(1)
      expect(inbox.filter((p) => p.kind !== 'callToArms').length).toBeLessThanOrEqual(3)
    })
  })

  it('hard rivals earn more than easy ones', () => {
    const easy = createInitialState(world, { playerRegionId: 'china', seed: 1, victoryShare: 0.6, difficulty: 'easy' })
    const hard = createInitialState(world, { playerRegionId: 'china', seed: 1, victoryShare: 0.6, difficulty: 'hard' })
    const bot = 'germany'
    expect(computeEconomy(hard, world, bot).taxIncome).toBeGreaterThan(computeEconomy(easy, world, bot).taxIncome)
    expect(computeEconomy(hard, world, 'china').taxIncome).toBeCloseTo(computeEconomy(easy, world, 'china').taxIncome, 5)
  })
})

describe('bots reason under fog of war', () => {
  it('count visible armies exactly and guess hidden ones within 20%', () => {
    const s = startState(map)
    const truth = militaryPower(s, 'r3')
    const guess = perceivedPower(s, map, 'r0', 'r3')
    expect(guess).toBeGreaterThanOrEqual(truth * 0.8 - 1e-9)
    expect(guess).toBeLessThanOrEqual(truth * 1.2 + 1e-9)
    s.nations.r0.techs.push('air_satellites')
    expect(perceivedPower(s, map, 'r0', 'r3')).toBeCloseTo(truth, 9)
  })

  it('band together against a runaway player', () => {
    const wide = lineMap(10)
    const s = startState(wide)
    s.settings.victoryShare = 0.6
    expect(coalitionActive(s)).toBe(false)
    expect(opinionReport(s, wide, 'r1', 'r0').parts.some((p) => p.label === 'Fears your power')).toBe(false)
    giveRegions(s, 'r0', ['r1', 'r2'])
    expect(coalitionActive(s)).toBe(true)
    expect(opinionReport(s, wide, 'r3', 'r0').parts.some((p) => p.label === 'Fears your power')).toBe(true)
  })
})

describe('bots trade', () => {
  it('a hungry bot asks a well-fed neighbor for food', () => {
    const asks: number[] = []
    for (let turn = 1; turn <= 12; turn++) {
      const s = startState(map)
      s.turn = turn
      const n = s.nations.r1
      n.personality = 'trader'
      n.foodShortage = true
      n.resources.food = 0
      n.resources.capital = 300
      s.nations.r0.resources.food = 500
      const orders = generateBotOrders(s, map, 'r1')
      for (const o of orders) if (o.type === 'propose' && o.proposal.kind === 'trade' && o.target === 'r0' && (o.proposal.terms.receive.food ?? 0) > 0) asks.push(turn)
    }
    expect(asks.length).toBeGreaterThan(0)
  })

  it('generates the same orders for the same seed', () => {
    const { map: world } = getWorld()
    const a = createInitialState(world, { playerRegionId: 'china', seed: 8, victoryShare: 0.6 })
    const b = createInitialState(world, { playerRegionId: 'china', seed: 8, victoryShare: 0.6 })
    expect(JSON.stringify(generateAllBotOrders(a, world))).toBe(JSON.stringify(generateAllBotOrders(b, world)))
    const c = createInitialState(world, { playerRegionId: 'china', seed: 9, victoryShare: 0.6 })
    expect(JSON.stringify(generateAllBotOrders(c, world))).not.toBe(JSON.stringify(generateAllBotOrders(a, world)))
  })
})
