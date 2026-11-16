import { addOpinion } from '../ai/opinion'
import { AREA_NAMES, areaOf } from '../data/areas'
import { CRISIS, HEADLINES } from '../data/crises'
import { SCENARIOS, STANDARD_SCENARIO, TIER_NAMES, scenarioGoalSentence, scenarioOf, type NationRef, type ScenarioDef, type ScenarioGoal, type ScenarioOp, type Who } from '../data/scenarios'
import { tierSpec } from '../data/empire'
import { TECH_BY_ID } from '../data/techTree'
import { JUSTIFY } from '../data/war'
import { declareWar } from './diplomacy'
import { startEpidemic } from './epidemics'
import { addLog, clamp, grantJustification, isAllied, nationNeighborMap, newId, pairKey, regionsOf } from './helpers'
import { militaryPower } from './militaryStats'
import { bindPuppet } from './puppets'
import { createRng } from './rng'
import type { GameState, NationId, WorldMap } from './types'
import { UNIT_TYPES } from './types'
import { conquestGoal, countriesTaken, economicGoal, economicShare, goalProgress, populationShare, worldGross } from './victory'

/** The world's strongest nations other than the player, strongest first: what `$top:n` and `$patron` read. */
interface Roles {
  player: NationId
  neighbors: NationId[]
  top: NationId[]
  patron: NationId | null
}

function rolesOf(s: GameState, map: WorldMap): Roles {
  const player = s.playerId
  const power = new Map<NationId, number>()
  for (const n of Object.values(s.nations)) if (n.alive) power.set(n.id, militaryPower(s, n.id))
  const byPower = (a: NationId, b: NationId) => (power.get(b) ?? 0) - (power.get(a) ?? 0) || (a < b ? -1 : 1)
  const near = nationNeighborMap(s, map).get(player) ?? new Set<NationId>()
  const neighbors = [...near].filter((id) => s.nations[id]?.alive).sort(byPower)
  const top = [...power.keys()].filter((id) => id !== player).sort(byPower)
  // A land border or a short sea lane makes a neighbor. The patron is the strongest nation that is none of those.
  const patron = top.find((id) => !near.has(id)) ?? null
  return { player, neighbors, top, patron }
}

function resolveOne(s: GameState, ref: NationRef, roles: Roles): NationId[] {
  if (typeof ref !== 'string') {
    for (const alt of ref.first) {
      const got = resolveOne(s, alt, roles)
      if (got.length && !got.includes(roles.player)) return got
    }
    return []
  }
  const alive = (id: NationId | undefined | null): id is NationId => !!id && !!s.nations[id]?.alive
  if (ref === '$player') return [roles.player]
  if (ref === '$world') return Object.keys(s.nations).filter((id) => alive(id)).sort()
  if (ref === '$patron') return alive(roles.patron) ? [roles.patron] : []
  if (ref.startsWith('$neighbor:')) {
    const which = ref.slice('$neighbor:'.length)
    const list = roles.neighbors
    const pick = which === 'strongest' ? list[0] : which === '2nd' ? list[1] : which === 'weakest' ? list[list.length - 1] : undefined
    return alive(pick) ? [pick] : []
  }
  if (ref.startsWith('$top:')) {
    const pick = roles.top[Number(ref.slice('$top:'.length)) - 1]
    return alive(pick) ? [pick] : []
  }
  return alive(ref) ? [ref] : []
}

function resolve(s: GameState, who: Who | undefined, roles: Roles): NationId[] {
  if (who === undefined) return []
  const refs: NationRef[] = Array.isArray(who) ? who : [who]
  return [...new Set(refs.flatMap((r) => resolveOne(s, r, roles)))]
}

const first = (s: GameState, who: Who | undefined, roles: Roles) => resolve(s, who, roles)[0] ?? null

/** What a scenario did, op by op: each line names the op and says whether it changed anything. Used by tests and nothing else. */
export interface ScenarioReport {
  id: string
  applied: string[]
  skipped: string[]
}

/**
 * Changes a freshly made world into the scenario's starting situation. Pure data in, deterministic change out: it uses no
 * random numbers except one seeded stream for the allies' answers when a war begins. Standard changes nothing at all.
 */
export function applyScenario(s: GameState, map: WorldMap, scenario: ScenarioDef | string | null | undefined): ScenarioReport {
  const def = typeof scenario === 'string' ? scenarioOf(scenario) : scenario
  if (!def || def.id === STANDARD_SCENARIO) return { id: STANDARD_SCENARIO, applied: [], skipped: [] }
  const report: ScenarioReport = { id: def.id, applied: [], skipped: [] }
  const roles = rolesOf(s, map)
  const rng = createRng(s.seed, 31337)
  s.scenario = { id: def.id, start: s.turn, goal: def.goal }
  if (def.goal.kind === 'world') s.settings.goal = 'world'
  else {
    s.settings.goal = 'classic'
    s.settings.victoryShare = def.goal.kind === 'classic' ? def.goal.victoryShare : 0.4
  }
  def.ops.forEach((op, i) => {
    const label = `${i}:${op.op}`
    if (run(s, map, op, roles, rng)) report.applied.push(label)
    else report.skipped.push(label)
  })
  for (const n of Object.values(s.nations)) {
    n.military.units = { ...n.military.units }
  }
  s.worldGross = worldGross(s, map)
  return report
}

/** Runs one op. False if it found nobody to act on (a country that is gone, a role with no one in it). */
function run(s: GameState, map: WorldMap, op: ScenarioOp, roles: Roles, rng: ReturnType<typeof createRng>): boolean {
  switch (op.op) {
    case 'war': {
      const a = first(s, op.a, roles)
      const b = first(s, op.b, roles)
      if (!a || !b || a === b) return false
      const key = pairKey(a, b)
      // Allies called to arms by an earlier war may already be in this one: then it only needs its dates and score.
      const already = s.wars.includes(key)
      // The aggressor is made out to have a reason, and the world is not left holding a grudge for it: the war is the world's starting situation.
      grantJustification(s, a, b, 'Old quarrel', JUSTIFY.reasonTurns)
      const infamy = s.infamy[a]
      if (!already) s.alliances = s.alliances.filter((k) => k !== key)
      if (!already) declareWar(s, map, a, b, rng)
      if (infamy === undefined) delete s.infamy[a]
      else s.infamy[a] = infamy
      s.warStarted[key] = s.turn - (op.months ?? 0)
      s.warScore[`${a}>${b}`] = clamp(op.lead ?? 0, 0, 100)
      if (!already) s.nations[a].stability = Math.min(100, s.nations[a].stability + 10)
      return true
    }
    case 'alliance': {
      const ids = resolve(s, op.members, roles)
      let did = false
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const key = pairKey(ids[i], ids[j])
          if (s.wars.includes(key) || s.alliances.includes(key)) continue
          s.alliances.push(key)
          delete s.pacts[key]
          did = true
        }
      s.alliances.sort()
      return did
    }
    case 'pact': {
      const ids = resolve(s, op.members, roles)
      let did = false
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const key = pairKey(ids[i], ids[j])
          if (s.wars.includes(key) || s.alliances.includes(key)) continue
          s.pacts[key] = Math.max(s.pacts[key] ?? 0, s.turn + op.months)
          did = true
        }
      return did
    }
    case 'puppet': {
      const master = first(s, op.master, roles)
      if (!master || s.nations[master].overlord) return false
      let did = false
      for (const id of resolve(s, op.puppets, roles)) {
        const p = s.nations[id]
        if (id === master || p.overlord || p.isPlayer || s.wars.includes(pairKey(id, master))) continue
        bindPuppet(s, id, master)
        s.alliances = s.alliances.filter((k) => k !== pairKey(id, master))
        did = true
      }
      return did
    }
    case 'sanction': {
      let did = false
      for (const from of resolve(s, op.from, roles))
        for (const to of resolve(s, op.to, roles)) {
          if (from === to) continue
          s.sanctions.push({ from, to, until: s.turn + op.months })
          addOpinion(s, to, from, 'Imposed sanctions on us', -25, 0.2)
          did = true
        }
      return did
    }
    case 'guarantee': {
      const from = first(s, op.from, roles)
      const to = first(s, op.to, roles)
      if (!from || !to || from === to || isAllied(s, from, to)) return false
      s.guarantees.push({ from, to, until: s.turn + op.months })
      return true
    }
    case 'grudge': {
      const target = first(s, op.target, roles)
      if (!target) return false
      let did = false
      for (const holder of resolve(s, op.holder, roles)) {
        if (holder === target) continue
        addOpinion(s, holder, target, op.label, op.value, 0.15)
        if (op.reason) grantJustification(s, holder, target, op.reason, op.months ?? JUSTIFY.reasonTurns)
        did = true
      }
      return did
    }
    case 'feud': {
      let did = false
      for (const a of resolve(s, op.sideA, roles))
        for (const b of resolve(s, op.sideB, roles)) {
          if (a === b) continue
          addOpinion(s, a, b, op.label, op.value, 0.1)
          addOpinion(s, b, a, op.label, op.value, 0.1)
          did = true
        }
      return did
    }
    case 'treasury':
      return each(s, op.who, roles, (n) => {
        n.resources.capital = n.resources.capital * (op.mult ?? 1) + (op.add ?? 0)
      })
    case 'stability':
      return each(s, op.who, roles, (n) => {
        n.stability = clamp(op.set ?? n.stability + (op.add ?? 0), 0, 100)
      })
    case 'weariness':
      return each(s, op.who, roles, (n) => {
        n.warWeariness = clamp(op.set, 0, 60)
      })
    case 'military':
      return each(s, op.who, roles, (n) => {
        for (const k of UNIT_TYPES) {
          n.military.units[k] *= op.mult ?? 1
          if (n.military.units[k] < 0.5) continue
          if (op.weapons !== undefined) n.military.weapons[k] = Math.max(n.military.weapons[k], op.weapons)
          if (op.drill !== undefined) n.military.drill[k] = Math.max(n.military.drill[k], op.drill)
        }
        n.militaryPool = Math.max(0, n.militaryPool * (op.mult ?? 1))
      })
    case 'stock': {
      const skip = new Set(resolve(s, op.except, roles))
      return each(s, op.who, roles, (n) => {
        if (skip.has(n.id)) return
        n.resources[op.key] = Math.max(0, n.resources[op.key] * (op.mult ?? 1) + (op.add ?? 0))
      })
    }
    case 'techs':
      return each(s, op.who, roles, (n) => {
        for (const id of op.add) {
          const t = TECH_BY_ID[id]
          if (t && !n.techs.includes(id) && t.requires.every((r) => n.techs.includes(r))) n.techs.push(id)
        }
      })
    case 'people':
      return each(s, op.who, roles, (n) => {
        const p = n.people
        if (op.health !== undefined) p.health = clamp(p.health + op.health, 0, 0.98)
        if (op.schooling !== undefined) p.schooling = clamp(p.schooling + op.schooling, 0, 0.98)
        if (op.unemployment !== undefined) p.unemployment = clamp(p.unemployment + op.unemployment, 0.01, 0.45)
      })
    case 'epidemic':
      return each(s, op.who, roles, (n) => startEpidemic(s, n.id, op.severity))
    case 'crisis': {
      const nation = first(s, op.nation, roles)
      const rival = op.rival ? first(s, op.rival, roles) : null
      if (!nation || (op.kind === 'dispute' && (!rival || rival === nation))) return false
      if (s.crises.some((c) => c.nation === nation || c.rival === nation)) return false
      const mr = map.regions[s.nations[nation].capital]
      const area = AREA_NAMES[areaOf(mr?.lat ?? 0, mr?.lng ?? 0)]
      const c = { id: newId(s, 'cr'), kind: op.kind, nation, rival: op.kind === 'dispute' ? rival : null, area, stage: op.stage, next: s.turn + CRISIS.gap, boil: CRISIS.escalate, answered: [] as NationId[] }
      s.crises.push(c)
      const text = HEADLINES[c.kind][c.stage]
        .replace('{area}', c.area)
        .replace('{nation}', s.nations[nation].name)
        .replace('{rival}', c.rival ? s.nations[c.rival].name : '')
      addLog(s, 'news', text, [nation, ...(c.rival ? [c.rival] : [])])
      return true
    }
    case 'rebels':
      return each(s, op.who, roles, (n) => {
        const lands = regionsOf(s, n.id)
        const r = s.regions[lands.find((id) => id !== n.capital) ?? n.capital]
        r.rebels = Math.max(r.rebels, op.strength)
      })
    case 'character':
      return each(s, op.who, roles, (n) => {
        if (n.isPlayer) return
        if (op.personality) n.personality = op.personality
        if (op.aggression !== undefined) n.aggression = clamp(op.aggression, 0.05, 1.1)
        if (op.aggressionMult !== undefined) n.aggression = clamp(n.aggression * op.aggressionMult, 0.05, 1.1)
      })
    case 'market': {
      const p = (s.marketPressure ??= {})
      p[op.resource] = (p[op.resource] ?? 0) + op.pressure
      return true
    }
    case 'missiles':
      return each(s, op.who, roles, (n) => {
        n.arsenal = { ...(n.arsenal ?? {}), ...(op.cruise ? { cruise: (n.arsenal?.cruise ?? 0) + op.cruise } : {}), ...(op.tactical ? { tactical: (n.arsenal?.tactical ?? 0) + op.tactical } : {}) }
        if (op.program !== undefined) n.missileProgram = Math.max(n.missileProgram ?? 0, op.program)
      })
  }
}

function each(s: GameState, who: Who | undefined, roles: Roles, f: (n: GameState['nations'][string]) => void): boolean {
  const ids = resolve(s, who, roles)
  for (const id of ids) f(s.nations[id])
  return ids.length > 0
}

/** The scenario this game runs, if it runs one. */
export const scenarioInPlay = (s: GameState): ScenarioDef | null => (s.scenario ? scenarioOf(s.scenario.id) : null)

/** True when the scenario's goal is its own (survive, grow, out-earn), so the Briefing shows its bars in place of the usual goal card. */
export function ownsGoal(s: GameState): boolean {
  const k = s.scenario?.goal.kind
  return k === 'survive' || k === 'tier' || k === 'economy'
}

/** Months since the scenario began (0 in the first month). */
export const scenarioMonths = (s: GameState): number => (s.scenario ? Math.max(0, s.turn - s.scenario.start) : 0)

/** One line of how close the player is to a scenario's goal. `value` and `goal` fill a progress bar. */
export interface GoalLine {
  label: string
  value: number
  goal: number
  text: string
}

/** Where the player stands against the scenario goal: bars for the Briefing. Empty when the goal is the game's own. */
export function scenarioGoalLines(s: GameState, map: WorldMap, id: NationId = s.playerId): GoalLine[] {
  const g: ScenarioGoal | undefined = s.scenario?.goal
  if (!g) return []
  const months = scenarioMonths(s)
  const left = (deadline: number | undefined) => (deadline ? ` (${Math.max(0, deadline - months)} months left)` : '')
  switch (g.kind) {
    case 'survive':
      return [{ label: 'Months survived', value: Math.min(months, g.months), goal: g.months, text: `${Math.min(months, g.months)} of ${g.months}` }]
    case 'tier': {
      const lines = tierSpec(g.tier).countries
      const have = countriesHeld(s, id)
      return [{ label: `Countries held toward ${TIER_NAMES[g.tier]}`, value: Math.min(have, lines), goal: lines, text: `${have} of ${lines}${left(g.deadline)}` }]
    }
    case 'economy': {
      const share = economicShare(s, map, id)
      return [{ label: 'World output', value: share, goal: g.share, text: `${(share * 100).toFixed(1)}% of ${(g.share * 100).toFixed(1)}%${left(g.deadline)}` }]
    }
    case 'classic': {
      const share = g.victoryShare
      return [
        { label: 'Countries taken', value: countriesTaken(s, id), goal: conquestGoal(share), text: `${countriesTaken(s, id)} of ${conquestGoal(share)}` },
        { label: 'World’s people held', value: populationShare(s, id), goal: share, text: `${Math.round(populationShare(s, id) * 100)}% of ${Math.round(share * 100)}%` },
        { label: 'World’s output', value: economicShare(s, map, id), goal: economicGoal(share), text: `${Math.round(economicShare(s, map, id) * 100)}% of ${Math.round(economicGoal(share) * 100)}%` },
      ]
    }
    case 'world':
      return [{ label: 'Hold the whole world', value: goalProgress(s, map, id), goal: 1, text: `${Math.round(goalProgress(s, map, id) * 100)}%` }]
  }
}

/** Countries that count toward an empire tier, the way tiers count them (half of each puppet's). */
function countriesHeld(s: GameState, id: NationId): number {
  const n = s.nations[id]
  if (!n) return 0
  return Object.values(s.regions).filter((r) => r.owner === id).length + Math.floor(Object.values(s.regions).filter((r) => s.nations[r.owner]?.overlord === id).length / 2)
}

export { SCENARIOS, scenarioGoalSentence }
