import { describe, expect, it } from 'vitest'
import { storedOpinion } from '../../ai/opinion'
import { EVENTS } from '../../data/events'
import { COSTS, PROPOSAL_COSTS } from '../../data/unitTypes'
import { computeEconomy } from '../economy'
import { applyEventChoice, effectAmount } from '../events'
import { atWar, hasPact, isAllied } from '../helpers'
import { orderCost, validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import type { GameState, Order, Proposal, ProposalDraft } from '../types'
import { netWarScore } from '../warscore'
import { giveRegions, lineMap, startState } from './fixtures'

const map = lineMap(5)
const P = 'r0'

function base(): GameState {
  const s = startState(map)
  const n = s.nations[P]
  n.resources.capital = 500
  n.resources.pp = 100
  n.resources.tp = 200
  n.militaryPool = 30
  return s
}

const armyOf = (s: GameState, owner: string) => Object.values(s.armies).find((a) => a.owner === owner)!

function incoming(s: GameState, from: string, draft: ProposalDraft): Proposal {
  const p = { ...draft, id: `p-${from}-${draft.kind}`, from, to: P, created: s.turn, expires: s.turn + 2 } as Proposal
  s.proposals.push(p)
  return p
}

interface Row {
  name: string
  setup?: (s: GameState) => void
  order: (s: GameState) => Order
  check: (next: GameState, prev: GameState) => void
}

const ROWS: Row[] = [
  {
    name: 'setPolicy',
    order: () => ({ type: 'setPolicy', nationId: P, taxRate: 0.3, draftRate: 0.1 }),
    check: (n) => {
      expect(n.nations[P].taxRate).toBe(0.3)
      expect(n.nations[P].draftRate).toBe(0.1)
    },
  },
  {
    name: 'build',
    order: () => ({ type: 'build', nationId: P, regionId: P, building: 'barracks' }),
    check: (n, p) => expect(n.regions[P].buildings.barracks).toBe(p.regions[P].buildings.barracks + 1),
  },
  {
    name: 'build depot',
    order: () => ({ type: 'build', nationId: P, regionId: P, building: 'depot' }),
    check: (n) => expect(n.regions[P].buildings.depot).toBe(1),
  },
  {
    name: 'recruit',
    order: () => ({ type: 'recruit', nationId: P, regionId: P, unit: 'infantry' }),
    check: (n, p) => expect(armyOf(n, P).units.infantry).toBeGreaterThan(armyOf(p, P).units.infantry + 0.5),
  },
  {
    name: 'research',
    order: () => ({ type: 'research', nationId: P, techId: 'infra_farming' }),
    check: (n) => expect(n.nations[P].techs).toContain('infra_farming'),
  },
  {
    name: 'move',
    setup: (s) => giveRegions(s, P, ['r1']),
    order: (s) => ({ type: 'move', nationId: P, armyId: armyOf(s, P).id, to: 'r1' }),
    check: (n) => expect(armyOf(n, P).location).toBe('r1'),
  },
  {
    name: 'attack',
    setup: (s) => {
      s.wars.push('r0|r1')
      armyOf(s, P).units.infantry = 60
    },
    order: (s) => ({ type: 'attack', nationId: P, armyId: armyOf(s, P).id, target: 'r1' }),
    check: (n) => {
      expect(n.battles.some((b) => b.regionId === 'r1' && b.attacker.nationId === P)).toBe(true)
      expect(n.regions.r1.owner).toBe(P)
    },
  },
  {
    name: 'assignGeneral',
    setup: (s) => {
      armyOf(s, P).generalId = null
    },
    order: (s) => ({ type: 'assignGeneral', nationId: P, armyId: armyOf(s, P).id, generalId: s.nations[P].generals[0].id }),
    check: (n) => expect(armyOf(n, P).generalId).toBe(n.nations[P].generals[0].id),
  },
  {
    name: 'declareWar',
    order: () => ({ type: 'declareWar', nationId: P, target: 'r1' }),
    check: (n) => {
      expect(atWar(n, P, 'r1')).toBe(true)
      expect(storedOpinion(n, 'r1', P).some((m) => m.label === 'Declared war on us')).toBe(true)
    },
  },
  {
    name: 'propose pact',
    order: () => ({ type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'pact' } }),
    check: (n) => {
      expect(n.dispatches.some((d) => d.proposalKind === 'pact' && d.from === 'r1' && d.to === P)).toBe(true)
      expect(n.proposalMemory[`${P}>r1:pact`]).toBe(1)
    },
  },
  {
    name: 'propose alliance',
    order: () => ({ type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'alliance' } }),
    check: (n) => expect(n.dispatches.some((d) => d.proposalKind === 'alliance' && d.from === 'r1')).toBe(true),
  },
  {
    name: 'propose trade',
    order: () => ({ type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'trade', terms: { give: { capital: 30 }, receive: { food: 5 }, months: 0 } } }),
    check: (n) => expect(n.dispatches.some((d) => d.proposalKind === 'trade' && d.from === 'r1')).toBe(true),
  },
  {
    name: 'propose peace',
    setup: (s) => {
      s.wars.push('r0|r1')
    },
    order: () => ({ type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'peace', terms: { cede: [], reparations: 0 } } }),
    check: (n) => expect(n.dispatches.some((d) => d.proposalKind === 'peace' && d.from === 'r1')).toBe(true),
  },
  {
    name: 'propose callToArms',
    setup: (s) => {
      s.alliances.push('r0|r2')
      s.wars.push('r0|r1')
    },
    order: () => ({ type: 'propose', nationId: P, target: 'r2', proposal: { kind: 'callToArms', enemy: 'r1' } }),
    check: (n) => {
      const d = n.dispatches.find((x) => x.proposalKind === 'callToArms' && x.from === 'r2')
      expect(d).toBeDefined()
      expect(atWar(n, 'r2', 'r1')).toBe(d!.kind === 'accepted')
    },
  },
  {
    name: 'respond accept',
    setup: (s) => {
      incoming(s, 'r1', { kind: 'pact' })
    },
    order: () => ({ type: 'respond', nationId: P, proposalId: 'p-r1-pact', accept: true }),
    check: (n) => {
      expect(hasPact(n, P, 'r1')).toBe(true)
      expect(n.proposals).toHaveLength(0)
    },
  },
  {
    name: 'respond decline',
    setup: (s) => {
      incoming(s, 'r1', { kind: 'alliance' })
    },
    order: () => ({ type: 'respond', nationId: P, proposalId: 'p-r1-alliance', accept: false }),
    check: (n) => {
      expect(isAllied(n, P, 'r1')).toBe(false)
      expect(n.proposals).toHaveLength(0)
      expect(storedOpinion(n, 'r1', P).some((m) => m.label === 'Spurned our alliance')).toBe(true)
    },
  },
  {
    name: 'cancelDeal',
    setup: (s) => {
      s.deals.push({ id: 'd1', kind: 'trade', from: P, to: 'r1', give: { capital: 5 }, receive: { food: 2 }, until: 10 })
    },
    order: () => ({ type: 'cancelDeal', nationId: P, dealId: 'd1' }),
    check: (n) => {
      expect(n.deals).toHaveLength(0)
      expect(storedOpinion(n, 'r1', P).some((m) => m.label === 'Broke a trade deal')).toBe(true)
    },
  },
  {
    name: 'leaveAlliance',
    setup: (s) => {
      s.alliances.push('r0|r1')
    },
    order: () => ({ type: 'leaveAlliance', nationId: P, target: 'r1' }),
    check: (n) => {
      expect(isAllied(n, P, 'r1')).toBe(false)
      expect(storedOpinion(n, 'r1', P).some((m) => m.label === 'Abandoned our alliance')).toBe(true)
    },
  },
  {
    name: 'spy sabotage',
    order: () => ({ type: 'spy', nationId: P, target: 'r1', mission: 'sabotage' }),
    check: (n) => expect(n.regions.r1.sabotaged > 0 || (n.casusBelli['r1|r0'] ?? 0) > 0).toBe(true),
  },
  {
    name: 'spy stealVision',
    order: () => ({ type: 'spy', nationId: P, target: 'r1', mission: 'stealVision' }),
    check: (n) => expect(Object.keys(n.nations[P].vision).length > 0 || (n.casusBelli['r1|r0'] ?? 0) > 0).toBe(true),
  },
  {
    name: 'enactLaw',
    order: () => ({ type: 'enactLaw', nationId: P, law: 'martial_law' }),
    check: (n) => expect(n.nations[P].laws).toContain('martial_law'),
  },
  {
    name: 'repealLaw',
    setup: (s) => {
      s.nations[P].laws = ['martial_law']
    },
    order: () => ({ type: 'repealLaw', nationId: P, law: 'martial_law' }),
    check: (n) => expect(n.nations[P].laws).not.toContain('martial_law'),
  },
  {
    name: 'suppressRebels',
    setup: (s) => {
      s.regions[P].rebels = 4
    },
    order: () => ({ type: 'suppressRebels', nationId: P, regionId: P }),
    check: (n) => expect(n.regions[P].rebels).toBeLessThanOrEqual(2),
  },
]

const COVERED: Order['type'][] = ['setPolicy', 'build', 'recruit', 'research', 'move', 'attack', 'assignGeneral', 'declareWar', 'propose', 'respond', 'cancelDeal', 'leaveAlliance', 'spy', 'enactLaw', 'repealLaw', 'suppressRebels']

describe('every order type', () => {
  it('has at least one row', () => {
    const s = base()
    const types = new Set(ROWS.map((r) => r.order(s).type))
    for (const t of COVERED) expect(types.has(t), t).toBe(true)
  })

  for (const row of ROWS) {
    it(`${row.name}: validates, charges once, and changes the state`, () => {
      const s = base()
      row.setup?.(s)
      const order = row.order(s)
      expect(validateOrder(s, map, order)).toBeNull()
      const cost = orderCost(s, order)
      const next = resolveTurn(s, map, [order])
      const idle = resolveTurn(s, map, [])
      const spent = (k: 'capital' | 'pp' | 'tp') => idle.nations[P].resources[k] - next.nations[P].resources[k]
      // Upkeep and income from the order itself shift the totals slightly, so allow a small margin.
      if (cost.capital) expect(spent('capital')).toBeGreaterThanOrEqual(cost.capital - 0.01)
      if (cost.capital) expect(spent('capital')).toBeLessThan(cost.capital + 3)
      if (cost.pp) expect(spent('pp')).toBeCloseTo(cost.pp, 5)
      if (cost.tp) expect(spent('tp')).toBeCloseTo(cost.tp, 5)
      if (cost.manpower) expect(idle.nations[P].militaryPool - next.nations[P].militaryPool).toBeGreaterThan(cost.manpower * 0.5)
      row.check(next, s)
    })
  }

  it('rejects orders the nation cannot afford', () => {
    const s = base()
    s.nations[P].resources.pp = 3
    s.nations[P].resources.capital = 5
    expect(validateOrder(s, map, { type: 'declareWar', nationId: P, target: 'r1' })).toMatch(/Political/)
    expect(validateOrder(s, map, { type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'alliance' } })).toMatch(/Political/)
    expect(validateOrder(s, map, { type: 'build', nationId: P, regionId: P, building: 'factory' })).toMatch(/Capital/)
    expect(validateOrder(s, map, { type: 'spy', nationId: P, target: 'r1', mission: 'sabotage' })).toMatch(/Capital/)
  })

  it('a duplicate proposal in the same month is charged and sent only once', () => {
    const s = base()
    const o: Order = { type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'pact' } }
    const next = resolveTurn(s, map, [o, o])
    const idle = resolveTurn(s, map, [])
    expect(idle.nations[P].resources.pp - next.nations[P].resources.pp).toBeCloseTo(PROPOSAL_COSTS.pact, 5)
    expect(next.dispatches.filter((d) => d.proposalKind === 'pact' && d.from === 'r1')).toHaveLength(1)
  })

  it('a second answer to the same proposal is refused', () => {
    const s = base()
    incoming(s, 'r1', { kind: 'pact' })
    const yes: Order = { type: 'respond', nationId: P, proposalId: 'p-r1-pact', accept: true }
    expect(validateOrder(s, map, { ...yes, accept: false }, [yes])).toBe('Already answered')
  })

  it('allies cannot declare war on each other, and a depot is one per region', () => {
    const s = base()
    s.alliances.push('r0|r1')
    expect(validateOrder(s, map, { type: 'declareWar', nationId: P, target: 'r1' })).toBe('You are allied')
    const depot: Order = { type: 'build', nationId: P, regionId: P, building: 'depot' }
    expect(validateOrder(s, map, depot, [depot])).toBe('Already built here')
  })

  it('leaving an alliance costs PP', () => {
    const s = base()
    s.alliances.push('r0|r1')
    expect(orderCost(s, { type: 'leaveAlliance', nationId: P, target: 'r1' }).pp).toBe(COSTS.leaveAlliance)
  })
})

describe('accepted proposals', () => {
  it('peace cedes regions without razing them and starts reparations', () => {
    const s = base()
    giveRegions(s, P, ['r1'])
    s.regions.r1.buildings.factory = 3
    s.wars.push('r0|r2')
    incoming(s, 'r2', { kind: 'peace', terms: { cede: ['r1'], reparations: 5 } })
    const next = resolveTurn(s, map, [{ type: 'respond', nationId: P, proposalId: 'p-r2-peace', accept: true }])
    expect(atWar(next, P, 'r2')).toBe(false)
    expect(hasPact(next, P, 'r2')).toBe(true)
    expect(next.regions.r1.owner).toBe('r2')
    expect(next.regions.r1.buildings.factory).toBe(3)
    const deal = next.deals.find((d) => d.kind === 'reparations')!
    expect(deal.from).toBe(P)
    expect(deal.to).toBe('r2')
    expect(deal.give.capital).toBe(5)
  })

  it('an alliance shares vision and calls the ally to arms', () => {
    const s = base()
    incoming(s, 'r1', { kind: 'alliance' })
    const next = resolveTurn(s, map, [{ type: 'respond', nationId: P, proposalId: 'p-r1-alliance', accept: true }])
    expect(isAllied(next, P, 'r1')).toBe(true)
    next.nations.r2.resources.pp = 100
    const war = resolveTurn(next, map, [{ type: 'declareWar', nationId: 'r2', target: 'r1' }])
    const call = war.proposals.find((p) => p.kind === 'callToArms' && p.to === P)
    expect(call).toBeDefined()
    const joined = resolveTurn(war, map, [{ type: 'respond', nationId: P, proposalId: call!.id, accept: true }])
    expect(atWar(joined, P, 'r2')).toBe(true)
  })

  it('a one-off trade moves the goods both ways', () => {
    const s = base()
    s.nations.r1.resources.food = 100
    incoming(s, 'r1', { kind: 'trade', terms: { give: { food: 10 }, receive: { capital: 20 }, months: 0 } })
    const id = 'p-r1-trade'
    const yes = resolveTurn(s, map, [{ type: 'respond', nationId: P, proposalId: id, accept: true }])
    const no = resolveTurn(s, map, [{ type: 'respond', nationId: P, proposalId: id, accept: false }])
    expect(no.nations[P].resources.capital - yes.nations[P].resources.capital).toBeCloseTo(20, 1)
    expect(yes.nations[P].resources.food - no.nations[P].resources.food).toBeCloseTo(10, 1)
  })

  it('a monthly trade pays immediately, then every month until it ends', () => {
    const s = base()
    s.nations.r1.resources.food = 200
    incoming(s, 'r1', { kind: 'trade', terms: { give: { food: 5 }, receive: { capital: 6 }, months: 3 } })
    let next = resolveTurn(s, map, [{ type: 'respond', nationId: P, proposalId: 'p-r1-trade', accept: true }])
    expect(next.deals).toHaveLength(1)
    next = resolveTurn(next, map, [])
    expect(next.deals).toHaveLength(1)
    next = resolveTurn(next, map, [])
    expect(next.deals).toHaveLength(0)
    expect(next.dispatches.some((d) => d.kind === 'completed')).toBe(true)
    expect(storedOpinion(next, 'r1', P).some((m) => m.label === 'Honored our deal')).toBe(true)
  })

  it('a deal the payer cannot cover is broken with a grudge', () => {
    const s = base()
    s.deals.push({ id: 'd1', kind: 'trade', from: 'r1', to: P, give: { food: 400 }, receive: { capital: 1 }, until: 12 })
    s.nations.r1.resources.food = 0
    const next = resolveTurn(s, map, [])
    expect(next.deals).toHaveLength(0)
    expect(next.dispatches.some((d) => d.kind === 'broken' && d.from === 'r1')).toBe(true)
  })

  it('the payer of reparations cannot cancel them, but the receiver can forgive them', () => {
    const s = base()
    s.deals.push({ id: 'd1', kind: 'reparations', from: P, to: 'r1', give: { capital: 5 }, receive: {}, until: 12 })
    expect(validateOrder(s, map, { type: 'cancelDeal', nationId: P, dealId: 'd1' })).toBe('Reparations are binding')
    expect(validateOrder(s, map, { type: 'cancelDeal', nationId: 'r1', dealId: 'd1' })).toBeNull()
  })
})

describe('proposal lifecycle and war score', () => {
  it('a proposal to the player waits until it expires, then lapses', () => {
    const s = base()
    s.nations.r1.resources.pp = 100
    let next = resolveTurn(s, map, [{ type: 'propose', nationId: 'r1', target: P, proposal: { kind: 'pact' } }])
    expect(next.proposals).toHaveLength(1)
    next = resolveTurn(next, map, [])
    next = resolveTurn(next, map, [])
    expect(next.proposals).toHaveLength(1)
    next = resolveTurn(next, map, [])
    expect(next.proposals).toHaveLength(0)
  })

  it('an unanswered call to arms costs the ally opinion', () => {
    const s = base()
    s.alliances.push('r0|r1')
    s.wars.push('r1|r2')
    const p = incoming(s, 'r1', { kind: 'callToArms', enemy: 'r2' })
    p.expires = s.turn
    const next = resolveTurn(s, map, [])
    expect(next.proposals).toHaveLength(0)
    expect(storedOpinion(next, 'r1', P).some((m) => m.label === 'Ignored our call to arms')).toBe(true)
  })

  it('battles earn war score that pays for peace demands', () => {
    const s = base()
    s.wars.push('r0|r1')
    giveRegions(s, 'r1', ['r2', 'r3'])
    armyOf(s, P).units.infantry = 60
    expect(validateOrder(s, map, { type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'peace', terms: { cede: ['r2'], reparations: 0 } } })).toMatch(/war score/)
    const next = resolveTurn(s, map, [{ type: 'attack', nationId: P, armyId: armyOf(s, P).id, target: 'r1' }])
    expect(netWarScore(next, P, 'r1')).toBeGreaterThan(10)
  })

  it('armies that hold position entrench, and acting resets it', () => {
    const s = base()
    let next = resolveTurn(s, map, [])
    next = resolveTurn(next, map, [])
    expect(armyOf(next, P).entrenched).toBe(2)
    giveRegions(next, P, ['r1'])
    next = resolveTurn(next, map, [{ type: 'move', nationId: P, armyId: armyOf(next, P).id, to: 'r1' }])
    expect(armyOf(next, P).entrenched).toBe(0)
  })
})

describe('every event choice', () => {
  for (const def of EVENTS)
    for (const index of [0, 1] as const) {
      const option = def.options[index]
      it(`${def.id}: ${option.label}`, () => {
        const s = base()
        giveRegions(s, P, ['r1'])
        const n = s.nations[P]
        n.stability = 50
        n.warWeariness = 30
        n.resources.food = 100
        s.regions.r1.buildings.factory = 2
        s.casusBelli['r2|r0'] = 50
        s.nations.r2.resources.capital = 100
        s.nations.r2.resources.food = 100
        s.pendingEvent = { eventId: def.id, turn: s.turn, rivalId: 'r2', regionId: 'r1' }
        const workforce = computeEconomy(s, map, P).workforce
        const next = applyEventChoice(s, map, index)
        const m = next.nations[P]
        expect(next.pendingEvent).toBeNull()
        expect(next.log.some((l) => l.text.includes(`you chose "${option.label}"`))).toBe(true)
        for (const e of option.effects) {
          switch (e.type) {
            case 'resource':
              expect(Math.sign(m.resources[e.key] - n.resources[e.key])).toBe(Math.sign(effectAmount(e, workforce)))
              break
            case 'rivalResource': {
              const v = effectAmount({ type: 'resource', key: e.key, amount: e.amount, perWorkforce: e.perWorkforce }, workforce)
              expect(Math.sign(next.nations.r2.resources[e.key] - s.nations.r2.resources[e.key])).toBe(Math.sign(v))
              break
            }
            case 'stability':
              expect(Math.sign(m.stability - n.stability)).toBe(Math.sign(e.amount))
              break
            case 'militaryPool':
              expect(Math.sign(m.militaryPool - n.militaryPool)).toBe(-Math.sign(e.fraction))
              break
            case 'armyAttrition':
              expect(armyOf(next, P).units.infantry).toBeLessThan(armyOf(s, P).units.infantry)
              break
            case 'unlockRandomTech':
              expect(m.techs.length).toBe(n.techs.length + 1)
              break
            case 'casusBelliForRival':
              expect(next.casusBelli['r2|r0']).toBe(s.turn + e.turns)
              break
            case 'clearCasusBelli':
              expect(next.casusBelli['r2|r0']).toBeUndefined()
              break
            case 'spawnRebels':
              expect(next.regions.r1.rebels).toBeGreaterThan(0)
              break
            case 'loseBuilding':
              expect(next.regions.r1.buildings[e.building]).toBe(s.regions.r1.buildings[e.building] - 1)
              break
            case 'addBuilding':
              expect(next.regions.r1.buildings[e.building]).toBe(s.regions.r1.buildings[e.building] + 1)
              break
            case 'popLoss':
              expect(next.regions.r1.population).toBeLessThan(s.regions.r1.population)
              break
            case 'warWeariness':
              expect(Math.sign(m.warWeariness - n.warWeariness)).toBe(Math.sign(e.amount))
              break
            case 'opinion':
              expect(storedOpinion(next, 'r2', P).find((x) => x.label === e.label)?.value).toBe(e.amount)
              break
            case 'embargo':
              expect(m.embargoedUntil).toBe(s.turn + e.turns - 1)
              break
          }
        }
      })
    }
})
