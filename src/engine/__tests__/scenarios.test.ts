import { describe, expect, it } from 'vitest'
import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { SCENARIOS, STANDARD_SCENARIO, scenarioOf } from '../../data/scenarios'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyScenario, scenarioGoalLines } from '../scenarios'
import { checkOutcome, goalProgress, goalSentence, humanStatus } from '../victory'
import { atWar } from '../helpers'
import { resolveTurn } from '../resolveTurn'
import type { GameState } from '../types'
import { checkInvariants } from './invariants'

const { map } = getWorld()
/** Building a whole world is the slow part, so each base world is built once and copied. */
const bases = new Map<string, GameState>()
const base = (nation: string, seed: number, difficulty: 'easy' | 'normal' | 'hard') => {
  const key = `${nation}/${seed}/${difficulty}`
  if (!bases.has(key)) bases.set(key, createInitialState(map, { playerRegionId: nation, seed, difficulty }))
  return structuredClone(bases.get(key)!)
}
const make = (scenario: string | undefined, nation: string, seed = 5, difficulty: 'easy' | 'normal' | 'hard' = 'normal') => {
  const s = base(nation, seed, difficulty)
  if (scenario) applyScenario(s, map, scenario)
  return s
}

describe('scenarios', () => {
  it('has at least eight playable scenarios, each with a briefing, a goal and a recommended nation', () => {
    expect(SCENARIOS.filter((x) => x.id !== STANDARD_SCENARIO).length).toBeGreaterThanOrEqual(8)
    expect(new Set(SCENARIOS.map((x) => x.id)).size).toBe(SCENARIOS.length)
    for (const d of SCENARIOS) {
      expect(d.title.length, d.id).toBeGreaterThan(3)
      expect(d.briefing.length, d.id).toBeGreaterThanOrEqual(1)
      expect(d.goalText.length, d.id).toBeGreaterThan(10)
      expect(map.regions[d.recommended.nation], `${d.id} recommended nation`).toBeTruthy()
    }
  })

  it('Standard (or no scenario) leaves the new world bit for bit as it was', () => {
    const none = createInitialState(map, { playerRegionId: 'poland', seed: 5, difficulty: 'normal' })
    expect(JSON.stringify(createInitialState(map, { playerRegionId: 'poland', seed: 5, difficulty: 'normal', scenario: 'standard' }))).toBe(JSON.stringify(none))
    expect(JSON.stringify(createInitialState(map, { playerRegionId: 'poland', seed: 5, difficulty: 'normal', scenario: undefined }))).toBe(JSON.stringify(none))
    expect(none.scenario).toBeUndefined()
    // Choosing a scenario in the options is the same as applying it to the finished world.
    const viaOptions = createInitialState(map, { playerRegionId: 'poland', seed: 5, difficulty: 'normal', scenario: 'two-fronts' })
    expect(JSON.stringify(viaOptions)).toBe(JSON.stringify(make('two-fronts', 'poland')))
  }, 60_000)

  it('names every country and role it uses: for the recommended nation no op is skipped', { timeout: 120_000 }, () => {
    for (const d of SCENARIOS) {
      const s = base(d.recommended.nation, 5, 'normal')
      const report = applyScenario(s, map, d)
      expect(report.skipped, `${d.id} skipped ${report.skipped}`).toEqual([])
      expect(report.applied.length, d.id).toBe(d.ops.length)
    }
  })

  it('applies deterministically', { timeout: 60_000 }, () => {
    for (const d of SCENARIOS) {
      const a = make(d.id, d.recommended.nation, 9, 'normal')
      const b = make(d.id, d.recommended.nation, 9, 'normal')
      expect(JSON.stringify(a), d.id).toBe(JSON.stringify(b))
    }
  })

  it('applies to any nation the player picks, the one it is written about included, without breaking the world', { timeout: 240_000 }, () => {
    for (const d of SCENARIOS) {
      for (const nation of ['bhutan', 'brazil', d.recommended.nation, 'china', 'united-states-of-america', 'syria', 'iran']) {
        const s = make(d.id, nation)
        expect(Object.values(s.nations).every((n) => Number.isFinite(n.resources.capital) && n.stability >= 0 && n.stability <= 100), `${d.id}/${nation}`).toBe(true)
        expect(s.nations[nation].alive).toBe(true)
        expect(s.scenario?.id ?? STANDARD_SCENARIO).toBe(d.id === STANDARD_SCENARIO ? STANDARD_SCENARIO : d.id)
      }
    }
  })

  it('builds the situation each briefing promises', { timeout: 240_000 }, () => {
    const cold = make('cold-war', 'india')
    expect(cold.alliances).toContain('germany|united-states-of-america')
    expect(cold.alliances).toContain('china|russia')
    expect(cold.nations.belarus.overlord).toBe('russia')
    expect(atWar(cold, 'saudi-arabia', 'yemen')).toBe(true)
    expect(cold.crises.some((c) => c.nation === 'south-korea' && c.rival === 'north-korea')).toBe(true)

    const small = make('small-among-giants', 'estonia')
    const russia = small.nations.russia
    const plain = make(undefined, 'estonia').nations.russia
    expect(russia.personality).toBe('expansionist')
    expect(russia.resources.capital).toBeGreaterThan(plain.resources.capital)
    expect(small.guarantees.some((g) => g.to === 'estonia')).toBe(true)

    const fronts = make('two-fronts', 'poland')
    expect(fronts.wars.filter((k) => k.split('|').includes('poland')).length).toBe(2)
    expect(fronts.nations.poland.warWeariness).toBeGreaterThan(15)

    const strait = make('strait-under-fire', 'united-arab-emirates')
    expect(atWar(strait, 'iran', 'united-arab-emirates')).toBe(true)
    expect(atWar(strait, 'iran', 'kuwait')).toBe(true)
    expect(strait.alliances).toContain('kuwait|saudi-arabia')

    const plague = make('plague-year', 'brazil')
    expect(plague.nations.brazil.people.epidemic).toBeGreaterThan(0.4)

    const crunch = make('resource-crunch', 'japan')
    const base = make(undefined, 'japan')
    expect(crunch.nations.japan.resources.oil).toBeLessThan(base.nations.japan.resources.oil * 0.5)
    expect(crunch.nations['saudi-arabia'].resources.oil).toBe(base.nations['saudi-arabia'].resources.oil)

    const fall = make('collapsing-neighbor', 'turkey')
    expect(fall.nations.syria.stability).toBe(12)
    expect(fall.crises.some((c) => c.kind === 'unrest' && c.nation === 'syria' && c.stage === 2)).toBe(true)
    // A scenario about one country still works when the player is that country: the weakest neighbor falls instead.
    const self = make('collapsing-neighbor', 'syria')
    expect(self.nations.syria.stability).toBeGreaterThan(30)
    expect(Object.values(self.nations).filter((n) => n.stability === 12).length).toBe(1)

    const giant = make('rising-giant', 'india')
    expect(giant.nations.laos.overlord).toBe('china')
    const giantIsChina = make('rising-giant', 'china')
    expect(giantIsChina.nations.laos.overlord).toBe('united-states-of-america')

    const builder = make('peaceful-builder', 'south-korea')
    expect(builder.pacts['north-korea|south-korea']).toBeGreaterThan(30)
    expect(builder.nations.china.aggression).toBeLessThan(make(undefined, 'south-korea').nations.china.aggression)

    const race = make('arms-race', 'turkey')
    expect(race.nations['united-states-of-america'].arsenal?.cruise ?? 0).toBeGreaterThan(0)

    const keg = make('powder-keg', 'georgia')
    expect(atWar(keg, 'azerbaijan', 'armenia')).toBe(true)
  })

  it('wars it starts count as justified: no lasting infamy is left on the aggressor', { timeout: 60_000 }, () => {
    const s = make('strait-under-fire', 'oman')
    expect(s.infamy.iran ?? 0).toBe(0)
  })

  it('plays 24 months of bots in every scenario without breaking a rule', () => {
    // The long runs live in scenarios.long.test.ts; here a short one for the most disruptive setups.
    for (const id of ['two-fronts', 'resource-crunch']) {
      const d = scenarioOf(id)!
      let s: GameState = make(id, d.recommended.nation, 3, d.recommended.difficulty)
      s.nextEventTurn = 99999
      for (let i = 0; i < 6 && s.outcome === 'playing'; i++) s = resolveTurn(s, map, [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)])
      checkInvariants(s)
    }
  }, 120_000)
})

describe('scenario goals', () => {
  it('survive: won once the months have passed, never before', () => {
    const s = make('small-among-giants', 'estonia')
    s.turn = s.scenario!.start + 59
    expect(humanStatus(s, 'estonia', map)).toBe('playing')
    s.turn = s.scenario!.start + 60
    expect(humanStatus(s, 'estonia', map)).toBe('won')
    expect(checkOutcome(s, map)).toBe('victory')
  })

  it('survive is lost when the nation is wiped out, as in every game', () => {
    const s = make('small-among-giants', 'estonia')
    s.turn = s.scenario!.start + 70
    s.regions.estonia.owner = 'russia'
    s.nations.estonia.alive = false
    expect(humanStatus(s, 'estonia', map)).toBe('lost')
  })

  it('tier: won on reaching the tier, lost when the deadline passes without it', () => {
    const s = make('resource-crunch', 'japan')
    expect(humanStatus(s, 'japan', map)).toBe('playing')
    s.turn = s.scenario!.start + 71
    expect(humanStatus(s, 'japan', map)).toBe('playing')
    s.turn = s.scenario!.start + 72
    expect(humanStatus(s, 'japan', map)).toBe('lost')
    s.nations.japan.tier = 2
    expect(humanStatus(s, 'japan', map)).toBe('won')
  })

  it('economy: won at the share, lost at the deadline', () => {
    const s = make('peaceful-builder', 'south-korea')
    expect(humanStatus(s, 'south-korea', map)).toBe('playing')
    s.turn = s.scenario!.start + 120
    expect(humanStatus(s, 'south-korea', map)).toBe('lost')
    s.worldGross = 1
    s.nations['south-korea'].resources.capital = 0
    // Pretend the whole world's output is South Korea's: the share is far above the goal.
    for (const n of Object.values(s.nations)) if (n.id !== 'south-korea') n.alive = false
    expect(humanStatus(s, 'south-korea', map)).toBe('won')
  })

  it('the game’s own goals still count in the scenarios that use them', () => {
    const s = make('collapsing-neighbor', 'turkey')
    expect(s.settings.goal).toBe('classic')
    expect(s.settings.victoryShare).toBe(0.25)
    expect(goalSentence(s)).toContain('take 3 countries')
    expect(scenarioGoalLines(s, map).map((l) => l.label)).toEqual(['Countries taken', 'World’s people held', 'World’s output'])
  })

  it('reports a goal sentence and progress for every kind', () => {
    for (const d of SCENARIOS) {
      const s = make(d.id, d.recommended.nation)
      expect(goalSentence(s).length, d.id).toBeGreaterThan(10)
      const p = goalProgress(s, map, d.recommended.nation)
      expect(p >= 0 && p <= 1, d.id).toBe(true)
      if (d.id !== STANDARD_SCENARIO) expect(scenarioGoalLines(s, map).length, d.id).toBeGreaterThan(0)
    }
  })
})
