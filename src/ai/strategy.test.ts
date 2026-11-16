import { describe, expect, it } from 'vitest'
import { computeEconomy } from '../engine/economy'
import { createRng } from '../engine/rng'
import type { GameState, NationId, UnitType, WorldMap } from '../engine/types'
import { forecastAttack } from '../engine/warfare'
import { lineMap, setMilitary, startState } from '../engine/__tests__/fixtures'
import { playWorld } from '../engine/__tests__/strategySim'
import { buildTurnContext, generateBotOrders } from './bot'
import { perceivedPower } from './diplomat'
import { addOpinion, opinionOf } from './opinion'
import { assessStrategy, chooseWarTarget, MIN_ODDS, pickUnit, planAttacks, warLooksWinnable, wantsPeace, type Sight } from './strategy'

const sightOf = (s: GameState, map: WorldMap, id: NationId): Sight => {
  const ctx = buildTurnContext(s, map)
  const nb = ctx.neighbors.get(id) ?? new Set<NationId>()
  return {
    s,
    map,
    id,
    ctx,
    econ: computeEconomy(s, map, id),
    perceived: (x) => perceivedPower(s, map, id, x),
    opinion: (x) => opinionOf(s, map, id, x, { borders: nb.has(x), coalition: ctx.coalition, enemies: ctx.enemies }),
    neighbors: nb,
  }
}

/** Three nations on a line: r0 and r1 border each other, r1 and r2 border each other. Everyone starts on the same footing. */
function world(): { s: GameState; map: WorldMap } {
  const map = lineMap(4)
  const s = startState(map, 'r3')
  s.turn = 10
  for (const id of ['r0', 'r1', 'r2']) {
    const n = s.nations[id]
    n.personality = 'opportunist'
    n.aggression = 0.7
    n.stability = 70
    n.warWeariness = 0
    n.resources.capital = 200
    setMilitary(s, id, { infantry: 6, armor: 2, artillery: 1 })
  }
  return { s, map }
}

describe('the strategic layer gives each bot a posture', () => {
  it('a strong, ambitious bot expands', () => {
    const { s, map } = world()
    s.nations.r0.personality = 'expansionist'
    s.nations.r0.aggression = 0.9
    setMilitary(s, 'r0', { infantry: 14, armor: 6, artillery: 3 })
    const strat = assessStrategy(sightOf(s, map, 'r0'))
    expect(strat.posture).toBe('expand')
    expect(strat.appetite).toBe(1)
  })

  it('a bot that is outgunned in a war defends: no new wars, stricter odds, a bigger reserve, and it wants peace', () => {
    const { s, map } = world()
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = 8
    setMilitary(s, 'r1', { infantry: 20, armor: 8, artillery: 4 })
    const strat = assessStrategy(sightOf(s, map, 'r0'))
    expect(strat.posture).toBe('defend')
    expect(strat.appetite).toBe(0)
    expect(strat.minOdds).toBeGreaterThan(MIN_ODDS[1])
    expect(strat.maxCommit).toBeLessThanOrEqual(0.5)
    expect(strat.peaceDrive).toBeGreaterThan(0.5)
    expect(strat.recruit).toBeGreaterThan(1)
  })

  it('a war-weary or restless bot consolidates instead of starting more wars', () => {
    const { s, map } = world()
    s.nations.r0.warWeariness = 35
    expect(assessStrategy(sightOf(s, map, 'r0')).posture).toBe('consolidate')
    const t = world()
    t.s.nations.r0.stability = 30
    expect(assessStrategy(sightOf(t.s, t.map, 'r0')).posture).toBe('consolidate')
  })

  it('a bot whose land was seized and who can answer wants revenge, one who cannot does not', () => {
    const { s, map } = world()
    addOpinion(s, 'r0', 'r1', 'Seized our land', -8, 0.2)
    const strat = assessStrategy(sightOf(s, map, 'r0'))
    expect(strat.posture).toBe('revenge')
    expect(strat.grudge).toBe('r1')
    setMilitary(s, 'r1', { infantry: 60, armor: 30, artillery: 10 })
    expect(assessStrategy(sightOf(s, map, 'r0')).grudge).toBeNull()
  })

  it('an isolationist keeps to itself; an opportunist waits for trouble', () => {
    const { s, map } = world()
    s.nations.r0.personality = 'turtle'
    expect(assessStrategy(sightOf(s, map, 'r0')).posture).toBe('turtle')
    expect(assessStrategy(sightOf(s, map, 'r1')).posture).toBe('opportunist')
  })

  it('a much stronger neighbor with a quarrel puts a small bot on the defensive even at peace', () => {
    const { s, map } = world()
    setMilitary(s, 'r1', { infantry: 40, armor: 14, artillery: 6 })
    s.casusBelli['r1|r0'] = 99
    const strat = assessStrategy(sightOf(s, map, 'r0'))
    expect(strat.posture).toBe('defend')
  })
})

describe('attacks are planned from real forecasts', () => {
  it('a bot with an overwhelming force attacks, and sends the smallest force that clears the bar', () => {
    const { s, map } = world()
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = 8
    setMilitary(s, 'r0', { infantry: 30, armor: 10, artillery: 6 })
    setMilitary(s, 'r1', { infantry: 2 })
    const sight = sightOf(s, map, 'r0')
    const plan = planAttacks(sight, assessStrategy(sight), new Set(['r1']), null, 1)[0]
    expect(plan).toBeTruthy()
    expect(plan.target).toBe('r1')
    expect(plan.odds).toBeGreaterThanOrEqual(0.9)
    expect(plan.commit).toBe('probe')
  })

  it('never launches an attack it expects to lose: a hopeless front yields no plan', () => {
    const { s, map } = world()
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = 8
    setMilitary(s, 'r0', { infantry: 3 })
    setMilitary(s, 'r1', { infantry: 30, armor: 12, artillery: 6 })
    const sight = sightOf(s, map, 'r0')
    expect(planAttacks(sight, assessStrategy(sight), new Set(['r1']), null, 1)).toEqual([])
  })

  it('across every balance of forces, each plan clears the posture’s bar by the forecast the War Room shows', () => {
    for (const mine of [2, 4, 6, 8, 11, 15, 22]) {
      for (const theirs of [3, 6, 10]) {
        const { s, map } = world()
        s.wars.push('r0|r1')
        s.warStarted['r0|r1'] = 8
        setMilitary(s, 'r0', { infantry: mine, armor: Math.floor(mine / 3) })
        setMilitary(s, 'r1', { infantry: theirs, armor: Math.floor(theirs / 3) })
        const sight = sightOf(s, map, 'r0')
        const strat = assessStrategy(sight)
        for (const plan of planAttacks(sight, strat, new Set(['r1']), null, 3)) {
          const f = forecastAttack(s, map, 'r0', plan.target, plan.commit, plan.stance, 8)!
          expect(f.winChance, `${mine} v ${theirs}`).toBeGreaterThanOrEqual(strat.minOdds - 1e-9)
          expect(plan.odds).toBeCloseTo(f.winChance, 6)
        }
      }
    }
  })

  it('a cracked front is pressed with more readiness than a fresh one, and a bot never plans an attack on a country it cannot reach', () => {
    const { s, map } = world()
    s.wars.push('r0|r1', 'r0|r3')
    setMilitary(s, 'r0', { infantry: 30, armor: 10, artillery: 6 })
    setMilitary(s, 'r1', { infantry: 2 })
    setMilitary(s, 'r3', { infantry: 2 })
    s.regions.r1.line = 0.5
    const sight = sightOf(s, map, 'r0')
    const plans = planAttacks(sight, assessStrategy(sight), new Set(['r1', 'r3']), null, 3)
    // r3 is two countries away on a line with no sea: it cannot be attacked.
    expect(plans.map((p) => p.target)).toEqual(['r1'])
    expect(plans[0].started).toBe(true)
  })

  it('a war is only declared where one could be fought and won', () => {
    const { s, map } = world()
    setMilitary(s, 'r0', { infantry: 30, armor: 10, artillery: 6 })
    setMilitary(s, 'r1', { infantry: 2 })
    let sight = sightOf(s, map, 'r0')
    let strat = assessStrategy(sight)
    expect(warLooksWinnable(sight, strat, 'r1', null)).toBe(true)
    setMilitary(s, 'r1', { infantry: 40, armor: 14, artillery: 6 })
    sight = sightOf(s, map, 'r0')
    strat = assessStrategy(sight)
    expect(warLooksWinnable(sight, strat, 'r1', null)).toBe(false)
  })

  it('does not choose a target it cannot reach across the sea, and takes it once it has a port', () => {
    const map = lineMap(4)
    map.regions.r0.seaLanes = ['r3']
    map.regions.r3.seaLanes = ['r0']
    map.regions.r0.neighbors = []
    map.regions.r1.neighbors = ['r2']
    map.regions.r2.neighbors = ['r1', 'r3']
    map.regions.r3.neighbors = ['r2']
    map.regions.r0.coastal = map.regions.r3.coastal = true
    const s = startState(map, 'r2')
    s.turn = 10
    s.nations.r0.personality = 'expansionist'
    s.nations.r0.aggression = 0.9
    setMilitary(s, 'r0', { infantry: 30, armor: 10, artillery: 6 })
    setMilitary(s, 'r3', { infantry: 2 })
    s.regions.r0.buildings.port = 0
    let sight = sightOf(s, map, 'r0')
    expect(chooseWarTarget(sight, assessStrategy(sight), null)).toBeNull()
    s.regions.r0.buildings.port = 1
    sight = sightOf(s, map, 'r0')
    expect(chooseWarTarget(sight, assessStrategy(sight), null)?.id).toBe('r3')
  })

  it('a bot with a bigger hostile neighbor behind it does not march off against a small one it only just outguns', () => {
    const { s, map } = world()
    s.nations.r1.personality = 'expansionist'
    s.nations.r1.aggression = 0.9
    setMilitary(s, 'r1', { infantry: 10, armor: 3, artillery: 2 })
    setMilitary(s, 'r2', { infantry: 6, armor: 1 })
    setMilitary(s, 'r0', { infantry: 10, armor: 3, artillery: 2 })
    // With an equal r0 behind it, r2 is a fair target for r1.
    let sight = sightOf(s, map, 'r1')
    expect(chooseWarTarget(sight, assessStrategy(sight), null)?.id).toBe('r2')
    // With a bigger, hostile r0 next door, the same attack would leave the door open.
    setMilitary(s, 'r0', { infantry: 20, armor: 8, artillery: 4 })
    addOpinion(s, 'r1', 'r0', 'Border incident', -30, 0.1)
    sight = sightOf(s, map, 'r1')
    expect(chooseWarTarget(sight, assessStrategy(sight), null)).toBeNull()
  })
})

describe('peace', () => {
  it('a bot behind on points asks for peace and would pay for it', () => {
    const { s, map } = world()
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = 8
    s.warScore['r1>r0'] = 25
    const sight = sightOf(s, map, 'r0')
    const w = wantsPeace(sight, assessStrategy(sight), 'r1', createRng(1))
    expect(w.want).toBe(true)
    expect(w.desperate).toBe(true)
    expect(w.net).toBe(-25)
  })

  it('a war that has gone nowhere for over a year is ended, a fresh one is not', () => {
    const { s, map } = world()
    s.turn = 30
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = 10
    s.nations.r0.warWeariness = 14
    const sight = sightOf(s, map, 'r0')
    expect(wantsPeace(sight, assessStrategy(sight), 'r1', createRng(1)).want).toBe(true)
    s.warStarted['r0|r1'] = 28
    expect(wantsPeace(sightOf(s, map, 'r0'), assessStrategy(sightOf(s, map, 'r0')), 'r1', createRng(1)).want).toBe(false)
  })

  it('a bot that is winning big names its terms, an expansionist rarely', () => {
    const { s, map } = world()
    s.wars.push('r0|r1')
    s.warStarted['r0|r1'] = 8
    s.warScore['r0>r1'] = 40
    setMilitary(s, 'r0', { infantry: 12, armor: 4, artillery: 2 })
    const sight = sightOf(s, map, 'r0')
    const strat = assessStrategy(sight)
    let yes = 0
    for (let i = 0; i < 40; i++) if (wantsPeace(sight, strat, 'r1', createRng(i)).want) yes++
    expect(yes).toBeGreaterThan(10)
    s.nations.r0.personality = 'expansionist'
    let rare = 0
    for (let i = 0; i < 40; i++) if (wantsPeace(sightOf(s, map, 'r0'), assessStrategy(sightOf(s, map, 'r0')), 'r1', createRng(i)).want) rare++
    expect(rare).toBeLessThan(yes)
  })
})

describe('units', () => {
  it('a bot on the defensive builds fewer tanks and more guns and robots than one on the attack', () => {
    const { s, map } = world()
    s.nations.r0.techs.push('land_light_tanks', 'land_artillery', 'air_propeller', 'air_bombers')
    const count = (posture: 'expand' | 'defend') => {
      const sight = sightOf(s, map, 'r0')
      const strat = { ...assessStrategy(sight), posture }
      const rng = createRng(7)
      const got: Partial<Record<UnitType, number>> = {}
      for (let i = 0; i < 400; i++) {
        const u = pickUnit(rng.next(), rng, strat, sight, null)
        got[u] = (got[u] ?? 0) + 1
      }
      return got
    }
    const attack = count('expand')
    const defend = count('defend')
    expect(defend.armor ?? 0).toBeLessThan(attack.armor ?? 0)
    expect(defend.artillery ?? 0).toBeGreaterThan(attack.artillery ?? 0)
  })
})

describe('the whole bot', () => {
  it('a bot facing a hopeless front does not attack, and one with a cracked front against a weak enemy does', () => {
    const attacks = (s: GameState, map: WorldMap, id: NationId) => {
      let n = 0
      for (let t = 10; t < 40; t++) {
        const c = { ...s, turn: t, nextEventTurn: 99999 } as GameState
        n += generateBotOrders(c, map, id).filter((o) => o.type === 'attack').length
      }
      return n
    }
    const a = world()
    a.s.wars.push('r0|r1')
    a.s.warStarted['r0|r1'] = 1
    setMilitary(a.s, 'r0', { infantry: 3 })
    setMilitary(a.s, 'r1', { infantry: 30, armor: 12, artillery: 6 })
    expect(attacks(a.s, a.map, 'r0')).toBe(0)

    const b = world()
    b.s.wars.push('r0|r1')
    b.s.warStarted['r0|r1'] = 1
    setMilitary(b.s, 'r0', { infantry: 30, armor: 10, artillery: 6 })
    setMilitary(b.s, 'r1', { infantry: 2 })
    b.s.regions.r1.line = 0.5
    expect(attacks(b.s, b.map, 'r0')).toBeGreaterThan(10)
  })

  it('stays deterministic: the same world gives the same orders', () => {
    const { s, map } = world()
    s.wars.push('r0|r1')
    setMilitary(s, 'r0', { infantry: 30, armor: 10, artillery: 6 })
    setMilitary(s, 'r1', { infantry: 2 })
    const a = JSON.stringify(generateBotOrders(structuredClone(s), map, 'r0'))
    const b = JSON.stringify(generateBotOrders(structuredClone(s), map, 'r0'))
    expect(a).toBe(b)
  })

  it('on the real world, Hard bots rarely launch an attack at poor odds (it was 45% before the strategy layer)', { timeout: 300_000 }, () => {
    const { result } = playWorld({ seed: 5, difficulty: 'hard', months: 20, player: 'china' })
    expect(result.attacks).toBeGreaterThan(8)
    expect(result.oddsLow / result.attacks).toBeLessThan(0.08)
    expect(result.repulsed / result.attacks).toBeLessThan(0.2)
  })
})
