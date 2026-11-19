import { COMMITS, STANCES, WAR, type Commit, type Stance } from '../data/war'
import { UNIT_SPECS } from '../data/unitTypes'
import { attackPool, cleanUnits, compactUnits, SENDABLE, worthOf } from './deploy'
import { forecastPlan, type AttackPlan, type Forecast } from './forecast'
import { atWar, emptyUnits, formatDivisions, maxAttacks, totalUnits } from './helpers'
import { missilesLeft } from './systems'
import { validateOrder } from './orders'
import type { GameState, NationId, Order, RegionId, UnitCounts, UnitType, WorldMap } from './types'
import { UNIT_TYPES } from './types'
import { attackableRegions, canAttackRegion, forecastAttack } from './warfare'

/**
 * AI Battle Command: the planner behind the War Room's advice and the standing auto-command. Everything here is a pure, deterministic
 * search over the same `forecastPlan` the player sees, so what it recommends is exactly what the forecast says is best, not a separate
 * opinion. Levels (data/systems.ts): 1 exact odds, 2 also the best stance, 3 also the best force size and mix, and the standing
 * auto-command.
 */

export type Objective = 'win' | 'losses' | 'fast' | 'defend'

export const OBJECTIVES: Record<Objective, { name: string; blurb: string }> = {
  win: { name: 'Best chance to win', blurb: 'The force that wins most often. Stops adding units once more would not help.' },
  losses: { name: 'Fewest losses', blurb: 'The cheapest force that still wins most of the time (60% or better).' },
  fast: { name: 'Fastest capture', blurb: 'Pushes the Defense Line furthest in one blow, to take the country this month.' },
  defend: { name: 'Keep home safe', blurb: 'The best chance to win while keeping a share of your reserve at home.' },
}

export interface Capabilities {
  level: number
  exact: boolean
  stance: boolean
  composition: boolean
  auto: boolean
}

export const commandLevel = (s: GameState, id: NationId): number => Math.max(0, Math.min(3, Math.round(s.nations[id]?.systems?.ai ?? 0)))

export function capabilities(level: number): Capabilities {
  return { level, exact: level >= 1, stance: level >= 2, composition: level >= 3, auto: level >= 3 }
}

export interface PlanOptions {
  objective: Objective
  /** Share of the reserve to keep at home (0 to 0.9). The `defend` objective defaults to 40%, the others to none. */
  keepHome?: number
  /** Orders already queued this month: their units are spoken for. */
  pending?: Order[]
  /** A live game keeps a home guard back. */
  live?: boolean
  /** A fast search for ranking many targets: bigger steps, fewer runs, the stance left alone. */
  quick?: boolean
  /** Fix the stance instead of searching for it. */
  stance?: Stance
  /** Fewest percent to win to accept a plan, for auto-command. */
  minWin?: number
  /**
   * Let the composition search fire missiles with the attack. Off by default: the player's planner and auto-command never attach
   * missiles to an attack (they are fired from Military, Missile War). An order that names missiles is still accepted by the engine.
   */
  missiles?: boolean
}

export interface PlannedAttack {
  plan: AttackPlan & { units: Partial<UnitCounts> }
  forecast: Forecast
  objective: Objective
  score: number
}

const keepOf = (o: PlanOptions) => Math.max(0, Math.min(0.9, o.keepHome ?? (o.objective === 'defend' ? 0.4 : 0)))

/** How good a forecast is for an objective. Higher is better. A little weight on the power ratio gives a slope to climb while no force wins yet. */
function score(f: Forecast, o: Objective, sentWorth: number): number {
  const ratio = Math.min(2, f.attackerPower / Math.max(0.1, f.defenderPower))
  const size = (o === 'win' || o === 'defend' ? 0.06 : 0.03) * sentWorth
  const lost = worthOf(f.yourLossByUnit)
  switch (o) {
    case 'losses':
      return f.winChance >= 0.6 ? 100 - lost * 3 - sentWorth * 0.2 + f.winChance * 10 : f.winChance * 60 + ratio * 4 - size
    case 'fast':
      return f.captureChance * 100 + f.lineDamage * 4 + f.winChance * 25 + ratio * 3 - size
    default:
      return f.winChance * 100 + ratio * 6 - size
  }
}

const roundHalf = (v: number) => Math.round(v * 2) / 2

/** The best composition for one stance: climb by adding the step of whichever kind helps most, then prune and swap. */
function search(s: GameState, map: WorldMap, id: NationId, target: RegionId, stance: Stance, o: PlanOptions, runs: number): PlannedAttack | null {
  const pool = attackPool(s, id, o.pending ?? [], !!o.live)
  const cap = totalUnits(pool) * (1 - keepOf(o))
  if (cap < WAR.minForce) return null
  const coastal = !!map.regions[target]?.coastal
  const nation = s.nations[id]
  const missilePool = o.missiles ? missilesLeft(nation.military.units.missile, o.pending ?? [], id) : 0
  const kinds = SENDABLE.filter((k) => pool[k] >= 0.1 && (coastal || k !== 'naval'))
  const step = Math.max(0.5, roundHalf(cap / (o.quick ? 8 : 14)))
  const units: Partial<UnitCounts> = {}
  let missiles = 0
  const total = () => totalUnits(cleanUnits(units))
  const evaluate = (u: Partial<UnitCounts>, m: number) => {
    const clean = cleanUnits(u)
    const f = forecastPlan(s, map, id, { target, stance, units: clean, missiles: m }, runs, false)
    return f ? { f, sc: score(f, o.objective, worthOf(clean) + m * 6) } : null
  }
  let best: { u: Partial<UnitCounts>; m: number; f: Forecast; sc: number } | null = null
  let stale = 0
  let curSc = 0
  for (let guard = 0; guard < 40 && total() + 1e-9 < cap; guard++) {
    // Pick the step that gains the most for what it costs to raise (a tank is not worth three riflemen unless it does three times the work).
    let pick: { k: UnitType | 'missile'; r: NonNullable<ReturnType<typeof evaluate>>; eff: number } | null = null
    for (const k of kinds) {
      const room = Math.min(step, pool[k] - (units[k] ?? 0), cap - total())
      if (room < 0.1) continue
      const r = evaluate({ ...units, [k]: (units[k] ?? 0) + room }, missiles)
      if (!r) continue
      const eff = (r.sc - curSc) / Math.max(0.5, worthOf({ [k]: room }))
      if (!pick || eff > pick.eff + 1e-9) pick = { k, r, eff }
    }
    // Missiles are used up: only worth one when they raise the score by more than their weight.
    if (missiles < missilePool && o.objective !== 'losses' && totalUnits(cleanUnits(units)) >= WAR.minForce) {
      const r = evaluate(units, missiles + 1)
      if (r) {
        const eff = (r.sc - curSc) / 6
        if (!pick || eff > pick.eff + 1e-9) pick = { k: 'missile', r, eff }
      }
    }
    if (!pick) break
    curSc = pick.r.sc
    if (pick.k === 'missile') missiles++
    else units[pick.k] = Math.round(((units[pick.k] ?? 0) + Math.min(step, pool[pick.k] - (units[pick.k] ?? 0), cap - total())) * 10) / 10
    if (totalUnits(cleanUnits(units)) >= WAR.minForce && (!best || pick.r.sc > best.sc + 1e-9)) {
      best = { u: { ...units }, m: missiles, f: pick.r.f, sc: pick.r.sc }
      stale = 0
    } else if (++stale >= 4) break
    // Good enough: a sure win ends the climb for objectives that are about winning.
    if (o.objective !== 'fast' && pick.r.f.winChance >= 0.97 && o.objective !== 'losses') break
  }
  if (!best) return null
  // Prune: take a step of any kind back out when the score does not drop (cheaper, same result), then try swapping a step between kinds.
  let cur = best
  for (let pass = 0; pass < 2; pass++) {
    let changed = false
    for (const k of kinds) {
      const have = cur.u[k] ?? 0
      if (have < 0.1) continue
      const less = Math.max(0, Math.round((have - Math.min(step, have)) * 10) / 10)
      const trial = { ...cur.u, [k]: less }
      if (totalUnits(cleanUnits(trial)) < WAR.minForce) continue
      const r = evaluate(trial, cur.m)
      if (r && r.sc >= cur.sc - 1e-9) {
        cur = { u: trial, m: cur.m, f: r.f, sc: r.sc }
        changed = true
      }
    }
    if (!changed) break
  }
  if (!o.quick) {
    for (const a of kinds) {
      for (const b of kinds) {
        if (a === b || (cur.u[a] ?? 0) < step || (cur.u[b] ?? 0) + step > pool[b] + 1e-9) continue
        const trial = { ...cur.u, [a]: Math.round(((cur.u[a] ?? 0) - step) * 10) / 10, [b]: Math.round(((cur.u[b] ?? 0) + step) * 10) / 10 }
        const r = evaluate(trial, cur.m)
        if (r && r.sc > cur.sc + 1e-9) cur = { u: trial, m: cur.m, f: r.f, sc: r.sc }
      }
    }
  }
  const finalUnits = compactUnits(cur.u)
  const plan = { target, stance, units: finalUnits, missiles: cur.m }
  const forecast = forecastPlan(s, map, id, plan, o.quick ? 128 : 512)
  if (!forecast) return null
  return { plan, forecast, objective: o.objective, score: score(forecast, o.objective, worthOf(finalUnits) + cur.m * 6) }
}

/**
 * Level 3: the best force, in size and mix, and the best stance, for an objective. Deterministic (fixed dice, fixed search order).
 * Returns null when nothing can be sent.
 */
export function planAttack(s: GameState, map: WorldMap, id: NationId, target: RegionId, o: PlanOptions): PlannedAttack | null {
  const runs = o.quick ? 24 : 40
  const stances = (o.stance ? [o.stance] : ['assault', 'blitz', 'siege']) as Stance[]
  if (stances.length === 1) return search(s, map, id, target, stances[0], o, runs)
  // Find the mix with the usual stance, then see which stance suits it best, then tune the mix for that stance.
  const first = search(s, map, id, target, 'assault', o, runs)
  if (!first || o.quick) return first
  let bestStance: Stance = 'assault'
  let bestScore = first.score
  for (const st of stances) {
    if (st === 'assault') continue
    const f = forecastPlan(s, map, id, { ...first.plan, stance: st }, 512, false)
    if (!f) continue
    const sc = score(f, o.objective, worthOf(first.plan.units) + (first.plan.missiles ?? 0) * 6)
    if (sc > bestScore + 0.5) {
      bestScore = sc
      bestStance = st
    }
  }
  return bestStance === 'assault' ? first : (search(s, map, id, target, bestStance, o, runs) ?? first)
}

/** The odds of each stance for a plan already chosen, and which suits the objective best. Level 2. */
export function compareStances(s: GameState, map: WorldMap, id: NationId, plan: AttackPlan, objective: Objective = 'win'): { best: Stance; forecasts: Record<Stance, Forecast | null>; scores: Record<Stance, number> } {
  const forecasts = {} as Record<Stance, Forecast | null>
  const scores = {} as Record<Stance, number>
  let best: Stance = 'assault'
  for (const st of Object.keys(STANCES) as Stance[]) {
    const f = forecastPlan(s, map, id, { ...plan, stance: st }, 256, false)
    forecasts[st] = f
    scores[st] = f ? score(f, objective, worthOf(f.sent)) : -999
    if (scores[st] > scores[best] + 0.5) best = st
  }
  return { best, forecasts, scores }
}

const PRESETS: Commit[] = ['probe', 'main', 'allin']

/**
 * The best of the three preset sizes (proportional to what you have) and the stance, for an objective: what the War Room's planner
 * recommends at every level, since the War Room sends one of these. `named` gives the units a preset sends when the caller sends named
 * units (the War Room does), so the plan is judged on exactly the force that would go. With a share to keep at home (`keepHome`, or the
 * `defend` objective), a preset that would send more is skipped.
 */
export function planPreset(s: GameState, map: WorldMap, id: NationId, target: RegionId, o: PlanOptions, named?: (c: Commit) => Partial<UnitCounts>): { commit: Commit; forecast: Forecast; stance: Stance; score: number } | null {
  let best: { commit: Commit; forecast: Forecast; stance: Stance; score: number } | null = null
  const keep = o.keepHome !== undefined || o.objective === 'defend' ? keepOf(o) : 0
  const presets = PRESETS.filter((c) => COMMITS[c].share <= 1 - keep + 1e-9)
  for (const commit of presets.length ? presets : PRESETS.slice(0, 1)) {
    for (const stance of (o.stance ? [o.stance] : ['assault', 'blitz', 'siege']) as Stance[]) {
      const f = forecastPlan(s, map, id, named ? { target, stance, units: named(commit) } : { target, stance, commit }, 128, false)
      if (!f) continue
      const sc = score(f, o.objective, worthOf(f.sent))
      if (!best || sc > best.score + 1e-9) best = { commit, forecast: f, stance, score: sc }
    }
  }
  return best
}

export interface TargetRow {
  target: RegionId
  name: string
  owner: NationId
  ownerName: string
  win: number
  captureChance: number
  yourLosses: number
  theirLosses: number
  lineDamage: number
  line: number
  lineMax: number
  stance: Stance
  /** What taking it is worth: its people, and a capital's weight. */
  value: number
  capital: boolean
  score: number
  gains: string[]
  risks: string[]
  plan: PlannedAttack['plan'] | null
}

/** Every country you could attack this month, ranked by what a good attack on it would gain. Level 1 ranks with the usual size, level 3 with the best force. */
export function rankTargets(s: GameState, map: WorldMap, id: NationId, o: PlanOptions, level: number): TargetRow[] {
  const rows: TargetRow[] = []
  const nation = s.nations[id]
  for (const target of attackableRegions(s, map, id)) {
    const region = s.regions[target]
    const owner = s.nations[region.owner]
    let forecast: Forecast | null = null
    let plan: PlannedAttack['plan'] | null = null
    let stance: Stance = 'assault'
    if (level >= 3) {
      const p = planAttack(s, map, id, target, { ...o, quick: true, stance: o.stance ?? 'assault' })
      if (p) {
        forecast = p.forecast
        plan = p.plan
        stance = p.plan.stance
      }
    } else {
      const p = planPreset(s, map, id, target, { ...o, stance: level >= 2 ? o.stance : 'assault' })
      if (p) {
        forecast = p.forecast
        stance = p.stance
      }
    }
    if (!forecast) continue
    const capital = owner.capital === target
    const value = region.population * (capital ? 1.5 : 1) + (capital ? 20 : 0)
    const gains: string[] = []
    const risks: string[] = []
    if (forecast.captureChance >= 0.3) gains.push(`${Math.round(forecast.captureChance * 100)}% to take it this month`)
    else gains.push(`Defense Line down about ${forecast.lineDamage.toFixed(1)} of ${forecast.lineBefore.toFixed(1)}`)
    if (capital) gains.push('their capital: a fallen capital can end the war')
    gains.push(`${region.population.toFixed(1)} million people`)
    if (forecast.winChance < 0.5) risks.push('likely to fail')
    if (map.regions[target].terrain === 'mountain' || map.regions[target].terrain === 'urban') risks.push(`${map.regions[target].terrain} ground favours the defender`)
    if (canAttackRegion(s, map, id, target).bySea) risks.push('a landing: amphibious penalty and patrols')
    if (forecast.yourLosses >= totalUnits(forecast.sent) * 0.4) risks.push('heavy losses expected')
    if ((nation.warWeariness ?? 0) > 25) risks.push('your people are war-weary')
    const ev = forecast.winChance * (Math.min(1, forecast.lineDamage / Math.max(0.5, forecast.lineBefore)) * 6 + forecast.captureChance * (4 + value * 0.05)) - forecast.yourLosses * 0.35
    rows.push({
      target,
      name: map.regions[target].name,
      owner: owner.id,
      ownerName: owner.name,
      win: forecast.winChance,
      captureChance: forecast.captureChance,
      yourLosses: forecast.yourLosses,
      theirLosses: forecast.theirLosses,
      lineDamage: forecast.lineDamage,
      line: forecast.lineBefore,
      lineMax: forecast.lineMax,
      stance,
      value,
      capital,
      score: ev,
      gains,
      risks,
      plan,
    })
  }
  return rows.sort((a, b) => b.score - a.score || (a.target < b.target ? -1 : 1))
}

export interface Threat {
  enemy: NationId
  region: RegionId
  /** The chance they take it now. */
  chance: number
  /** And if `after` units were away from home attacking. */
  chanceAfter?: number
}

/** Your countries an enemy at war with you could take this month. `away` is a force you mean to send: the home army fights at half strength while it is out. */
export function incomingThreats(s: GameState, map: WorldMap, id: NationId, away?: UnitCounts): Threat[] {
  const out: Threat[] = []
  const enemies = Object.values(s.nations).filter((n) => n.alive && n.id !== id && atWar(s, id, n.id)).map((n) => n.id)
  let after: GameState | null = null
  if (away && enemies.length > 0) {
    after = structuredClone(s)
    const free = totalUnits(after.nations[id].military.units)
    after.nations[id].military.exposed = Math.min(1, after.nations[id].military.exposed + totalUnits(away) / Math.max(0.1, free))
  }
  for (const e of enemies) {
    for (const r of Object.values(s.regions)) {
      if (r.owner !== id || !canAttackRegion(s, map, e, r.id).ok) continue
      const f = forecastAttack(s, map, e, r.id, 'main', 'assault', 16)
      if (!f || f.winChance < 0.15) continue
      const g = after ? forecastAttack(after, map, e, r.id, 'main', 'assault', 16) : null
      out.push({ enemy: e, region: r.id, chance: f.winChance, ...(g ? { chanceAfter: g.winChance } : {}) })
    }
  }
  return out.sort((a, b) => (b.chanceAfter ?? b.chance) - (a.chanceAfter ?? a.chance) || (a.region < b.region ? -1 : 1)).slice(0, 4)
}

export interface Advice {
  tone: 'good' | 'warn' | 'bad' | 'info'
  text: string
}

const unitName = (k: UnitType) => UNIT_SPECS[k].name.toLowerCase()
const listUnits = (u: Partial<UnitCounts>) => UNIT_TYPES.filter((k) => (u[k] ?? 0) >= 0.05).map((k) => `${formatDivisions(u[k]!)} ${unitName(k)}`).join(', ')

/**
 * Specific, written advice for one attack: why this target and force, which stance, what to do first, where the enemy is weak, when to
 * wait, and what at home to watch. Every sentence comes from a number the forecast already computed.
 */
export function advise(s: GameState, map: WorldMap, id: NationId, plan: AttackPlan, level: number, rec?: PlannedAttack | null): Advice[] {
  const out: Advice[] = []
  const f = forecastPlan(s, map, id, plan, 256)
  const nation = s.nations[id]
  const region = s.regions[plan.target]
  const foe = s.nations[region.owner]
  const name = map.regions[plan.target].name
  if (!f) return [{ tone: 'bad', text: 'This attack cannot be made right now.' }]
  const sent = totalUnits(f.sent)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  out.push({
    tone: f.winChance >= 0.7 ? 'good' : f.winChance >= 0.4 ? 'warn' : 'bad',
    text: `${name}${foe.name !== name ? ` (${foe.name})` : ''}: ${pct(f.winChance)} to win with ${formatDivisions(sent)} divisions${f.winChance < 0.4 ? '. Not yet.' : f.winChance >= 0.7 ? '. A good attack.' : '. A coin toss: improve it first.'}`,
  })
  // Missiles are not part of an attack's advice: they are fired from Military, Missile War.
  // Supply and weariness.
  if (nation.oilShortage) out.push({ tone: 'bad', text: 'You are out of oil: tanks, planes and ships fight at a fraction of their strength. Buy oil before sending them.' })
  if (nation.foodShortage) out.push({ tone: 'bad', text: 'Food shortage: your whole army fights 30% weaker. Fix it before attacking.' })
  if ((nation.warWeariness ?? 0) >= 25) out.push({ tone: 'warn', text: `Your people are war-weary (${Math.round(nation.warWeariness)}). Losses tire them further: prefer Siege, which loses fewer lives, or wait for a calmer month.` })
  // Their weakness.
  const stretched = Object.values(s.regions).filter((r) => r.owner === foe.id && r.id !== plan.target && r.attackedTurn === s.turn).length
  if (stretched > 0) out.push({ tone: 'good', text: `${foe.name} is already fighting on ${stretched + 1} fronts this month: only part of its army can stand at ${name}.` })
  if (f.lineBefore < f.lineMax * 0.6) out.push({ tone: 'good', text: `${name}'s Defense Line is cracked (${f.lineBefore.toFixed(1)} of ${f.lineMax.toFixed(1)}) and heals every quiet month: strike while it is weak.` })
  // The recommendation.
  if (rec && level >= 1) {
    const better = rec.forecast.winChance - f.winChance
    if (level >= 3 && Math.abs(better) >= 0.03) {
      out.push({ tone: 'info', text: `Best plan for "${OBJECTIVES[rec.objective].name.toLowerCase()}": ${listUnits(rec.plan.units)} on ${STANCES[rec.plan.stance].name}: ${pct(rec.forecast.winChance)} to win (${better >= 0 ? '+' : ''}${Math.round(better * 100)} points), losing about ${formatDivisions(rec.forecast.yourLosses)}.` })
    }
    if (level >= 2 && rec.plan.stance !== plan.stance) {
      out.push({ tone: 'info', text: `Switch to ${STANCES[rec.plan.stance].name}: ${STANCES[rec.plan.stance].blurb}` })
    }
  }
  // Which units are carrying the fight and which are not worth sending.
  if (plan.units) {
    const u = cleanUnits(plan.units)
    const coastal = map.regions[plan.target].coastal
    if (!coastal && u.naval > 0) out.push({ tone: 'warn', text: `Warships cannot fight inland: leave the ${formatDivisions(u.naval)} at port.` })
    const mixed = f.factors.find((x) => x.id === 'combined')
    if (mixed && mixed.tone === 'neutral' && u.infantry + u.robot > 0 && sent >= 6) out.push({ tone: 'info', text: 'No combined-arms bonus: add tanks and aircraft (each at least an eighth of the force) for +25% power.' })
    const air = f.factors.find((x) => x.id === 'air')
    if (air && air.tone === 'bad' && u.air > 0) out.push({ tone: 'warn', text: 'The enemy rules the air: your bombers fly at 40%. Add fighters or leave the bombers home.' })
    const terr = f.factors.find((x) => x.id === 'terrain')
    if (terr && terr.tone === 'bad' && u.armor > 1) out.push({ tone: 'warn', text: `${map.regions[plan.target].terrain === 'mountain' ? 'Mountains' : 'This ground'} blunt your tanks: infantry and robots do better here.` })
  }
  // When to wait.
  if (f.winChance < 0.4) {
    const hold = rec && rec.forecast.winChance >= 0.5 ? 'A better force is possible: use the recommended plan.' : 'Even your best force is not enough: train more, raise drill and weapons, or let their war with others wear them down.'
    out.push({ tone: 'bad', text: `Wait. ${hold}` })
  }
  // Home defence.
  const away = f.sent
  const threats = incomingThreats(s, map, id, away)
  const worst = threats[0]
  if (worst && (worst.chanceAfter ?? worst.chance) >= 0.35) {
    const foeName = s.nations[worst.enemy]?.name ?? 'An enemy'
    const rise = (worst.chanceAfter ?? worst.chance) - worst.chance
    out.push({
      tone: (worst.chanceAfter ?? worst.chance) >= 0.6 ? 'bad' : 'warn',
      text: `${foeName} could take ${map.regions[worst.region].name} (${pct(worst.chance)}${rise >= 0.04 ? `, ${pct(worst.chanceAfter ?? worst.chance)} while your army is out` : ''}). ${rise >= 0.04 ? 'Send less, or keep your best defenders (infantry, robots) at home.' : 'Keep reinforcements near it.'}`,
    })
  }
  return out
}

export interface WhatIf {
  label: string
  rows: { label: string; now: string; plan: string; better: boolean | null }[]
}

/** The current plan against the recommended one, line by line. */
export function whatIf(current: Forecast, rec: Forecast): WhatIf['rows'] {
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const row = (label: string, a: number, b: number, fmt: (v: number) => string, higherBetter: boolean) => ({ label, now: fmt(a), plan: fmt(b), better: Math.abs(a - b) < (fmt === pct ? 0.005 : 0.05) ? null : higherBetter ? b > a : b < a })
  return [
    row('Chance to win', current.winChance, rec.winChance, pct, true),
    row('Country falls this attack', current.captureChance, rec.captureChance, pct, true),
    row('Defense Line pushed back', current.lineDamage, rec.lineDamage, (v) => v.toFixed(1), true),
    row('Your losses (divisions)', current.yourLosses, rec.yourLosses, (v) => formatDivisions(v), false),
    row('Their losses (divisions)', current.theirLosses, rec.theirLosses, (v) => formatDivisions(v), true),
    row('Divisions sent', totalUnits(current.sent), totalUnits(rec.sent), (v) => formatDivisions(v), false),
  ]
}

export interface AutoSettings {
  on: boolean
  objective: Objective
  /** Most attacks to plan in a month (never more than the nation is allowed). */
  maxAttacks: number
  /** Share of the reserve that must stay home across all of them (0 to 0.9). */
  reserve: number
  /** Least chance to win for an attack to be planned, 0 to 1. */
  minWin: number
}

export const DEFAULT_AUTO: AutoSettings = { on: false, objective: 'win', maxAttacks: 2, reserve: 0.3, minWin: 0.65 }

/**
 * The month's attacks, chosen by the planner within the player's limits: never more attacks than allowed or asked for, never past
 * the share of the reserve that must stay home, nothing below the least chance to win. The orders are ordinary attack orders (named
 * units), valid against the state as it stands, one after another.
 */
export function planMonth(s: GameState, map: WorldMap, id: NationId, auto: AutoSettings, pending: Order[] = [], live = false): { order: Extract<Order, { type: 'attack' }>; planned: PlannedAttack; target: string }[] {
  const out: { order: Extract<Order, { type: 'attack' }>; planned: PlannedAttack; target: string }[] = []
  const n = s.nations[id]
  if (!n?.alive) return out
  const queued = pending.filter((o) => o.type === 'attack' && o.nationId === id).length
  const done = n.military.lastAttackTurn === s.turn ? n.military.attacksThisTurn : 0
  const room = Math.max(0, Math.min(auto.maxAttacks, maxAttacks(s, id) - done - queued))
  const reserveTotal = totalUnits(attackPool(s, id, pending, live))
  const budget = reserveTotal * (1 - Math.max(0, Math.min(0.9, auto.reserve)))
  let spent = 0
  const taken = new Set<RegionId>(pending.filter((o) => o.type === 'attack').map((o) => (o as { target: RegionId }).target))
  const queue: Order[] = [...pending]
  for (let i = 0; i < room; i++) {
    const left = budget - spent
    if (left < WAR.minForce) break
    // Rank what is left to attack with what is left to send.
    const rows = rankTargets(s, map, id, { objective: auto.objective, pending: queue, live, keepHome: Math.max(0, 1 - left / Math.max(0.1, totalUnits(attackPool(s, id, queue, live)))) }, 3).filter((r) => !taken.has(r.target) && r.plan && r.win >= auto.minWin)
    const row = rows[0]
    if (!row) break
    const planned = planAttack(s, map, id, row.target, { objective: auto.objective, pending: queue, live, keepHome: Math.max(0, 1 - left / Math.max(0.1, totalUnits(attackPool(s, id, queue, live)))) })
    if (!planned || planned.forecast.winChance < auto.minWin) {
      taken.add(row.target)
      continue
    }
    const order: Extract<Order, { type: 'attack' }> = { type: 'attack', nationId: id, target: row.target, stance: planned.plan.stance, units: planned.plan.units }
    if (validateOrder(s, map, order, queue)) {
      taken.add(row.target)
      continue
    }
    out.push({ order, planned, target: row.target })
    queue.push(order)
    taken.add(row.target)
    spent += totalUnits(cleanUnits(planned.plan.units))
  }
  return out
}

/** Empty plan helper for callers that build one by hand. */
export const noUnits = () => emptyUnits()
