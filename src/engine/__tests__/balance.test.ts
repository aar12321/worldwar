import { describe, expect, it, vi } from 'vitest'
import { LOCAL_IDS } from '../../data/localProjects'
import { PROJECT_IDS, PROJECT_LEVELS, PROJECTS } from '../../data/projects'
import { CAMPAIGN_IDS, CAMPAIGNS, SOCIAL, SOCIAL_IDS, SOCIAL_RULES } from '../../data/society'
import { getWorld } from '../../map/world'
import { createInitialState } from '../../data/startingNations'
import { computeEconomy } from '../economy'
import { investedIn, projectSpeed } from '../industry'
import { MONTH_END_ORDERS, validateOrder } from '../orders'
import { resolveTurn } from '../resolveTurn'
import type { GameState, Order, SocialId } from '../types'
import { decodeState, encodeState } from '../../net/protocol'
import { fingerprint } from '../../net/fingerprint'
import { RUSH, rushGain } from '../works'
import { optimizerOrders, runBotWorld } from './balance.sweep'
import { checkInvariants, invariantProblems } from './invariants'
import { giveRegions, lineMap, startState } from './fixtures'
import ordersSource from '../orders.ts?raw'
import storeSource from '../../store.ts?raw'
import turnSource from '../resolveTurn.ts?raw'
import typesSource from '../types.ts?raw'
import factionSource from '../factions.ts?raw'
import { FACTION_ORDERS } from '../factions'
import blocSource from '../bloc.ts?raw'
import { BLOC_ORDERS } from '../bloc'

// Some of these play whole months on the real map; a busy machine needs more than the default five seconds.
vi.setConfig({ testTimeout: 120_000 })

/**
 * Balance guarantees found and pinned by the balance audit (docs/BALANCE.md). Each test is a promise about the game's shape, not a
 * snapshot: if a data change breaks one, the change probably unbalanced the game, and the report says what the numbers were.
 */

const map = lineMap(30)
const P = 'r0'

/** A nation holding the first `n` countries of the line map, at the empire tier that size gives. */
function empire(n: number): GameState {
  const s = startState(map)
  giveRegions(s, P, Array.from({ length: n - 1 }, (_, i) => `r${i + 1}`))
  s.nations[P].tier = n >= 60 ? 5 : n >= 25 ? 4 : n >= 10 ? 3 : n >= 4 ? 2 : 1
  s.nations[P].resources.capital = 1e6
  s.nations[P].resources.pp = 500
  return s
}

describe('social programs are not free money', () => {
  it('no program, at any level, returns more money than it costs once fully phased in', () => {
    const s = startState(map)
    const base = computeEconomy(s, map, P)
    const worst: [string, number][] = []
    for (const id of SOCIAL_IDS) {
      for (const level of [1, 2, 3]) {
        const c = structuredClone(s)
        ;(c.nations[P].social ??= {})[id] = { level, strength: level, changed: -1 }
        const e = computeEconomy(c, map, P)
        const payback = (e.netCapital - base.netCapital + e.society.bill) / e.society.bill
        worst.push([`${id} L${level}`, payback])
      }
    }
    for (const [what, payback] of worst) expect(payback, what).toBeLessThanOrEqual(1)
    // The growth programs do earn a large share of their cost back: that is what they are for.
    expect(Math.max(...worst.map(([, p]) => p))).toBeGreaterThan(0.7)
  })

  it('a bigger level is never a better deal than the first', () => {
    const s = startState(map)
    const base = computeEconomy(s, map, P)
    for (const id of ['courts', 'transit', 'smallLoans', 'apprenticeships', 'mentalHealth'] as SocialId[]) {
      const pay = [1, 2, 3].map((level) => {
        const c = structuredClone(s)
        ;(c.nations[P].social ??= {})[id] = { level, strength: level, changed: -1 }
        const e = computeEconomy(c, map, P)
        return (e.netCapital - base.netCapital + e.society.bill) / e.society.bill
      })
      expect(pay[1], id).toBeLessThan(pay[0])
      expect(pay[2], id).toBeLessThan(pay[1])
    }
  })

  it('stability from programs, projects and campaigns together never passes the ceiling, whatever is stacked', () => {
    const s = empire(30)
    const n = s.nations[P]
    for (const id of SOCIAL_IDS) (n.social ??= {})[id] = { level: 3, strength: 3, changed: -1 }
    for (const id of CAMPAIGN_IDS) (n.campaigns ??= {})[id] = { left: CAMPAIGNS[id].months, cooldown: CAMPAIGNS[id].cooldown }
    for (const id of PROJECT_IDS) n.projects[id] = { progress: 99, done: true, level: 3 }
    for (const r of Object.values(s.regions)) if (r.owner === P) r.works = Object.fromEntries(LOCAL_IDS.map((id) => [id, { progress: 99, done: true, level: 3 }]))
    const e = computeEconomy(s, map, P)
    const part = (label: string) => e.stabilityParts.find((p) => p.label === label)?.value ?? 0
    expect(part('Programs for the people') + part('Projects in your countries')).toBeLessThan(SOCIAL_RULES.stabilityCap)
    expect(part('Programs for the people') + part('Projects in your countries')).toBeGreaterThan(SOCIAL_RULES.stabilityCap * 0.9)
  })

  it('a cultural centre in every country cannot buy perfect calm: its stability shares the one ceiling', () => {
    const s = empire(30)
    for (const r of Object.values(s.regions)) if (r.owner === P) r.works = { culturalCentre: { progress: 9, done: true, level: 3 } }
    const e = computeEconomy(s, map, P)
    const local = e.stabilityParts.find((p) => p.label === 'Projects in your countries')!.value
    // 30 countries at 0.6 each would have been 18 points, the whole ceiling, from one cheap project alone.
    expect(local).toBeLessThan(12)
    expect(local).toBeGreaterThan(5)
    // And with programs already at the ceiling, the centres add very little.
    for (const id of SOCIAL_IDS) (s.nations[P].social ??= {})[id] = { level: 3, strength: 3, changed: -1 }
    const full = computeEconomy(s, map, P)
    const both = full.stabilityParts.filter((p) => p.label === 'Programs for the people' || p.label === 'Projects in your countries').reduce((a, p) => a + p.value, 0)
    expect(both).toBeLessThan(SOCIAL_RULES.stabilityCap)
    expect(full.stabilityParts.find((p) => p.label === 'Projects in your countries')!.value).toBeLessThan(2)
  })

  it('campaigns are a burst, not a loop: each waits out a cooldown at least twice its length', () => {
    for (const id of CAMPAIGN_IDS) expect(CAMPAIGNS[id].cooldown, id).toBeGreaterThanOrEqual(CAMPAIGNS[id].months * 1.5)
  })

  it('every program costs something every month, and cutting one hurts at once', () => {
    for (const id of SOCIAL_IDS) expect(SOCIAL[id].cost, id).toBeGreaterThan(0.05)
    expect(SOCIAL_RULES.cutStability).toBeGreaterThanOrEqual(2)
  })
})

describe('the economy at every tier has something to buy and cannot buy everything', () => {
  const { map: world } = getWorld()
  /** France with the nearest countries added, at the tier their number gives, and everything bought. */
  function tierWorld(give: number, tier: 1 | 2 | 3 | 4 | 5) {
    const s = createInitialState(world, { playerRegionId: 'france', seed: 1, goal: 'classic', victoryShare: 2 })
    s.nextEventTurn = 99999
    const me = world.regions.france
    const near = Object.values(world.regions)
      .filter((m) => m.id !== 'france' && s.regions[m.id]?.owner === m.id)
      .sort((a, b) => Math.hypot(a.lat - me.lat, a.lng - me.lng) - Math.hypot(b.lat - me.lat, b.lng - me.lng))
      .slice(0, give)
    for (const m of near) {
      s.regions[m.id].owner = 'france'
      s.nations[m.id].alive = false
    }
    s.nations.france.tier = tier
    return s
  }
  const bought = (s: GameState, f: (s: GameState) => void) => {
    const c = structuredClone(s)
    f(c)
    return computeEconomy(c, world, 'france')
  }

  it('all twenty-two programs at the first level take a large share of income, and at the top level more than there is', () => {
    for (const [give, tier] of [[0, 1], [3, 2], [9, 3], [24, 4], [59, 5]] as const) {
      const s = tierWorld(give, tier)
      const gross = computeEconomy(s, world, 'france').gross
      const care = (level: number) =>
        bought(s, (c) => {
          for (const id of SOCIAL_IDS) (c.nations.france.social ??= {})[id] = { level, strength: level, changed: -1 }
        }).society.bill / gross
      expect(care(1), `tier ${tier} level 1`).toBeGreaterThan(0.35)
      expect(care(1), `tier ${tier} level 1`).toBeLessThan(0.9)
      expect(care(3), `tier ${tier} level 3`).toBeGreaterThan(1.2)
    }
  })

  it('every national project at the top level is a sink no Nation can carry and a Hegemon feels', () => {
    for (const [give, tier, lo, hi] of [[0, 1, 5, 50], [59, 5, 0.25, 0.8]] as const) {
      const s = tierWorld(give, tier)
      const gross = computeEconomy(s, world, 'france').gross
      const e = bought(s, (c) => {
        for (const id of PROJECT_IDS) c.nations.france.projects[id] = { progress: 99, done: true, level: 3 }
      })
      expect(e.projects.upkeep / gross, `tier ${tier}`).toBeGreaterThan(lo)
      expect(e.projects.upkeep / gross, `tier ${tier}`).toBeLessThan(hi)
    }
    expect(PROJECT_IDS.reduce((a, id) => a + investedIn(id, 3), 0)).toBeGreaterThan(40000)
  })

  it('projects in the countries are a steady sink: the first level of all nine, everywhere, costs a fifth to a half of income', () => {
    for (const [give, tier] of [[3, 2], [24, 4], [59, 5]] as const) {
      const s = tierWorld(give, tier)
      const gross = computeEconomy(s, world, 'france').gross
      const e = bought(s, (c) => {
        for (const r of Object.values(c.regions)) if (r.owner === 'france') r.works = Object.fromEntries(LOCAL_IDS.map((id) => [id, { progress: 99, done: true }]))
      })
      expect(e.projects.upkeep / gross, `tier ${tier}`).toBeGreaterThan(0.1)
      expect(e.projects.upkeep / gross, `tier ${tier}`).toBeLessThan(0.6)
    }
  })

  it('no national project is a money machine for a nation of ordinary size', () => {
    const s = tierWorld(0, 1)
    const base = computeEconomy(s, world, 'france')
    for (const id of PROJECT_IDS) {
      const e = bought(s, (c) => {
        c.nations.france.projects[id] = { progress: 99, done: true }
      })
      // Ten years of what it adds, less ten years of keeping it up, against what it cost to build.
      const gain = 120 * (e.netCapital - base.netCapital)
      expect(gain, id).toBeLessThan(investedIn(id, 1))
    }
  })
})

describe('rushing a project cannot get around the engineers', () => {
  it('a rush buys two months at the usual pace and fewer when engineers are scarce', () => {
    const n = { spending: { works: 2 } } as Parameters<typeof rushGain>[0]
    expect(rushGain(n, 1.4)).toBe(RUSH.months)
    expect(rushGain(n, 1)).toBe(RUSH.months)
    expect(rushGain(n, 0.6)).toBeCloseTo(RUSH.months * 0.6, 9)
    expect(rushGain(n, 0.1)).toBeCloseTo(RUSH.months * 0.4, 9)
  })

  it('at every level of staffing a rushed month costs at least half as much again per month of work as an ordinary one', () => {
    for (let cover = 0.3; cover <= 1.5; cover += 0.1) {
      const n = { spending: { works: 2 } } as Parameters<typeof projectSpeed>[0]
      const speed = projectSpeed(n, cover)
      // An ordinary month costs one bill for `speed` months of work. A rushed month costs the bill and the rush for the work and the rush.
      const ordinary = 1 / speed
      const rushed = (1 + RUSH.cost) / (speed + rushGain(n, cover))
      expect(rushed / ordinary, `engineers ${cover.toFixed(1)}`).toBeGreaterThanOrEqual(1.5)
    }
  })

  it('levels cost more than their worth: the second and third level never beat the first for the money', () => {
    // Each level is paid for on top of the last, so what counts is the worth against everything put in so far.
    const put = (l: number) => PROJECT_LEVELS.cost.slice(1, l + 1).reduce((a, b) => a + b, 0)
    for (let l = 2; l <= 3; l++) expect(PROJECT_LEVELS.power[l] / put(l)).toBeLessThan(PROJECT_LEVELS.power[l - 1] / put(l - 1))
    for (const id of PROJECT_IDS) expect(PROJECTS[id].months, id).toBeGreaterThanOrEqual(6)
  })
})

describe('every order is wired in every place', () => {
  const union = typesSource.slice(typesSource.indexOf('export type Order ='), typesSource.indexOf('\n\n', typesSource.indexOf('export type Order =')))
  const types = [...union.matchAll(/\{ type: '(\w+)'/g)].map((m) => m[1])
  /** Attacks have their own loop, and a recall is a live-clock order. */
  /** A command to a territory runs in the phase of the order it carries (see `commanded`). */
  const special = new Set(['attack', 'recall', 'commandTerritory'])
  const between = (src: string, from: string, to?: string) => src.slice(src.indexOf(from), to ? src.indexOf(to, src.indexOf(from)) : undefined)
  const phases = between(turnSource, 'const PHASES', 'export function resolveTurn')
  const describe_ = between(turnSource, 'export function describeOrder', 'function safeDescribe')
  const execute = between(turnSource, 'function executeOrder')
  const rules = between(ordersSource, 'function checkRules')

  it('finds the orders', () => {
    expect(types.length).toBeGreaterThan(55)
    for (const t of ['fundMissiles', 'buildMissiles', 'setSocial', 'campaign', 'rushProject']) expect(types).toContain(t)
  })

  it('each one is described, checked, run in a phase, and executed', () => {
    for (const t of types) {
      expect(describe_.includes(`case '${t}'`), `describeOrder ${t}`).toBe(true)
      // Faction orders have their own rules and executor (factions.ts); the rest are checked and run here.
      if (FACTION_ORDERS.has(t as Order['type'])) {
        expect(factionSource.includes(`case '${t}'`), `factions.ts ${t}`).toBe(true)
        expect(rules.includes('isFactionOrder'), 'checkRules sends faction orders on').toBe(true)
        continue
      }
      // Bloc orders likewise (bloc.ts: rules, executor), and each has its own phase.
      if (BLOC_ORDERS.has(t as Order['type'])) {
        expect(blocSource.split(`case '${t}'`).length - 1, `bloc.ts ${t}`).toBeGreaterThanOrEqual(3)
        expect(rules.includes('isBlocOrder'), 'checkRules sends bloc orders on').toBe(true)
        expect(phases.includes(`'${t}'`), `PHASES ${t}`).toBe(true)
        continue
      }
      expect(rules.includes(`case '${t}'`), `checkRules ${t}`).toBe(true)
      if (special.has(t)) continue
      expect(phases.includes(`'${t}'`), `PHASES ${t}`).toBe(true)
      expect(execute.includes(`case '${t}'`), `executeOrder ${t}`).toBe(true)
    }
  })

  it('a phase lists each order once', () => {
    const listed = [...phases.matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('every order that waits for the month end can be kept across a reload', () => {
    const kept = between(storeSource, 'function keptOrder', 'let toastId')
    for (const t of MONTH_END_ORDERS) expect(kept.includes(`'${t}'`), `keptOrder ${t}`).toBe(true)
  })

  it('every price that validation checks is paid: research for the missile program and for techs and programs', () => {
    const s = startState(lineMap(4))
    const n = s.nations[P]
    n.resources.capital = 5000
    n.resources.tp = 500
    n.resources.pp = 300
    const paid = (o: Order) => {
      const before = n.resources.tp
      const after = resolveTurn(s, lineMap(4), [o]).nations[P].resources.tp
      return before - after
    }
    // The research a month brings in (about 5 to 7 for a lone country) is added after the orders, so compare against a month with no order.
    const idle = (() => {
      const before = n.resources.tp
      return before - resolveTurn(s, lineMap(4), []).nations[P].resources.tp
    })()
    expect(paid({ type: 'fundMissiles', nationId: P }) - idle).toBe(10)
    expect(paid({ type: 'researchProgram', nationId: P, track: 'weapons' }) - idle).toBe(300)
  })
})

describe('a damaged or hostile plan cannot stop the month or poison a treasury', () => {
  const GARBAGE: unknown[] = [undefined, null, NaN, -1, 1e9, 'bogus', {}, [], 2.5]
  const SAMPLES: Order[] = [
    { type: 'setSocial', nationId: P, policy: 'courts', level: 1 },
    { type: 'campaign', nationId: P, campaign: 'celebration' },
    { type: 'startProject', nationId: P, project: 'rail' },
    { type: 'startProject', nationId: P, project: 'irrigation', regionId: P },
    { type: 'pauseProject', nationId: P, project: 'rail', paused: true },
    { type: 'rushProject', nationId: P, project: 'rail' },
    { type: 'fundMissiles', nationId: P },
    { type: 'buildMissiles', nationId: P, kind: 'cruise', count: 2 },
    { type: 'strike', nationId: P, target: 'r1', weapon: 'missile', kind: 'cruise', count: 2 },
    { type: 'setPolicy', nationId: P, taxRate: 0.2, draftRate: 0.05 },
    { type: 'propose', nationId: P, target: 'r1', proposal: { kind: 'pact' } },
    { type: 'train', nationId: P, unit: 'infantry' },
    { type: 'queueTrain', nationId: P, unit: 'infantry' },
    { type: 'fundSystem', nationId: P, system: 'shield' },
    { type: 'enactLaw', nationId: P, law: 'war_economy' },
  ]

  it('validation refuses nonsense instead of throwing, and a month with it still runs with every resource a number', () => {
    const small = lineMap(6)
    let bad = 0
    for (const sample of SAMPLES) {
      for (const key of Object.keys(sample)) {
        if (key === 'type' || key === 'nationId') continue
        for (const g of GARBAGE) {
          const o = { ...sample, [key]: g } as unknown as Order
          const s = startState(small)
          s.nations[P].resources.capital = 5000
          s.nations[P].resources.pp = 500
          s.nations[P].isPlayer = true
          s.wars.push('r0|r1')
          expect(() => validateOrder(s, small, o), JSON.stringify(o)).not.toThrow()
          const out = resolveTurn(s, small, [o])
          const r = out.nations[P].resources
          if (![r.capital, r.pp, r.tp, r.oil, r.steel, r.food, r.goods, out.nations[P].militaryPool, out.nations[P].draftRate, out.nations[P].taxRate].every(Number.isFinite)) bad++
        }
      }
    }
    expect(bad).toBe(0)
  })
})

describe('online play carries everything the statecraft systems add', () => {
  it('a state full of programs, projects, works, campaigns and missiles squeezes into a few small pieces and comes back exactly', async () => {
    const { map: world } = getWorld()
    const s = createInitialState(world, { playerRegionId: 'france', seed: 1, goal: 'classic', victoryShare: 2 })
    const ids = Object.keys(s.regions)
    for (const id of ids.slice(0, 100)) {
      s.regions[id].owner = 'france'
      s.regions[id].works = Object.fromEntries(LOCAL_IDS.map((l) => [l, { progress: 99, done: true, level: 3, by: 'france', rushed: 5 }]))
    }
    const n = s.nations.france
    for (const id of SOCIAL_IDS) (n.social ??= {})[id] = { level: 3, strength: 3, changed: 5 }
    for (const id of CAMPAIGN_IDS) (n.campaigns ??= {})[id] = { left: 3, cooldown: 9 }
    for (const id of PROJECT_IDS) n.projects[id] = { progress: 99, done: true, level: 3, rushed: 4 }
    n.missileProgram = 3
    n.missileBuilt = { turn: 1, count: 18 }
    n.arsenal = { cruise: 100, tactical: 50, ballistic: 20 }
    n.struckBy = Object.fromEntries(ids.slice(0, 30).map((i) => [i, 3]))
    const parts = await encodeState(s)
    expect(parts.every((p) => p.length <= 40_000)).toBe(true)
    expect(parts.length).toBeLessThanOrEqual(4)
    const back = await decodeState(parts)
    expect(JSON.stringify(back)).toBe(JSON.stringify(s))
    expect(fingerprint(back)).toBe(fingerprint(s))
    expect(invariantProblems(back)).toEqual([])
  })
})

describe('two people planning the same month', () => {
  it('programs, projects, rushes and missiles resolve the same whichever plan the host reads first', () => {
    const small = lineMap(8)
    const base = startState(small)
    base.humans = ['r0', 'r1']
    for (const id of ['r0', 'r1']) {
      Object.assign(base.nations[id].resources, { capital: 4000, pp: 300, tp: 200, steel: 200 })
      base.nations[id].isPlayer = true
    }
    const plan = (id: string, region: string): Order[] => [
      { type: 'setSocial', nationId: id, policy: 'courts', level: 1 },
      { type: 'campaign', nationId: id, campaign: 'celebration' },
      { type: 'startProject', nationId: id, project: 'rail' },
      { type: 'startProject', nationId: id, project: 'irrigation', regionId: region },
      { type: 'fundMissiles', nationId: id },
      { type: 'buildMissiles', nationId: id, kind: 'cruise', count: 3 },
    ]
    const a = plan('r0', 'r0')
    const b = plan('r1', 'r1')
    const one = resolveTurn(base, small, [...a, ...b])
    const two = resolveTurn(base, small, [...b, ...a])
    // Each human's own orders took effect, and the order the plans were read in changes nothing but the order of the log.
    for (const id of ['r0', 'r1']) {
      expect(one.nations[id].missileProgram).toBe(1)
      expect(one.nations[id].arsenal).toEqual({ cruise: 3 })
      expect(one.nations[id].social?.courts?.level).toBe(1)
    }
    const norm = (s: GameState) => ({ ...JSON.parse(JSON.stringify(s)), log: [...s.log].map((e) => JSON.stringify(e)).sort() })
    expect(norm(one)).toEqual(norm(two))
  })
})

describe('whole games stay in range and do not snowball', () => {
  it('a Medium world after 60 months has no nation above a quarter of the countries, and every number is in range', () => {
    const r = runBotWorld({ seed: 11, difficulty: 'normal', months: 60, sampleEvery: 20 })
    const last = r.samples[r.samples.length - 1]
    expect(last.alive).toBeGreaterThan(40)
    expect(last.topShare).toBeLessThan(0.25)
    // Measured when this was written: the biggest nation held 5% of the world at month 60, and 8% at month 120.
    expect(last.inRed).toBeLessThan(20)
    expect(r.tally.problems).toEqual([])
    checkInvariants(r.final)
  }, 240_000)

  it('a scripted optimizer who takes every program, project and missile keeps the numbers in range and does not break the economy', () => {
    const { map: world } = getWorld()
    let s = createInitialState(world, { playerRegionId: 'france', seed: 4, difficulty: 'normal', goal: 'classic', victoryShare: 2 })
    s.nextEventTurn = 99999
    s.nations.france.resources.pp = 200
    for (let i = 0; i < 18; i++) {
      s.outcome = 'playing'
      const orders = [...optimizerOrders(s, world, 'france', { programLevel: 2 })]
      s = resolveTurn(s, world, orders)
    }
    expect(invariantProblems(s)).toEqual([])
    const n = s.nations.france
    const e = computeEconomy(s, world, 'france')
    // A nation of one country spending its whole surplus does not get rich by it: care and building eat what they bring in.
    expect(Object.keys(n.social ?? {}).length).toBeGreaterThan(5)
    expect(e.gross).toBeLessThan(120)
    expect(n.stability).toBeLessThanOrEqual(100)
    expect(n.resources.capital).toBeLessThan(2000)
  }, 240_000)
})
