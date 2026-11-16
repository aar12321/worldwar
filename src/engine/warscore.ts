import { MW } from '../data/missileWar'
import { PUPPET } from '../data/puppets'
import { DIPLOMACY } from '../data/unitTypes'
import { EMPIRE } from '../data/war'
import { regionWorkforce } from './economy'
import { clamp, pairKey, totalUnits } from './helpers'
import { militaryPower } from './militaryStats'
import { liberationProblem } from './puppets'
import { territoryProblem, territoryValue } from './territories'
import type { BattleReport, GameState, NationId, PeaceTerms, RegionId, WorldMap } from './types'

export const WARSCORE = {
  battleWin: 3,
  perLossInflicted: 0.6,
  /** Land held that was the enemy's: points for each country, and for the enemy's capital instead of a plain one. */
  capture: 8,
  capitalCapture: 14,
  max: 100,
  /** Most a single battle's casualties can add, so a fight over a thin garrison that refills cannot be farmed. */
  battleCap: 20,
  /** Share of what each side has earned that fades every month: a victory two years ago is not a lead today. */
  decay: 0.05,
  /**
   * The score follows the war (docs/WARSCORE_STATUS.md): earnings fade, and land counts while it is held and stops counting when the
   * enemy takes it back or it breaks away. Off, it is the old tally that only grows (tests: withOldWarScore).
   */
  live: true,
}

export const REPARATION_MONTHS = 12
export const MAX_REPARATIONS = 30

const scoreKey = (a: NationId, b: NationId) => `${a}>${b}`

export type WarScoreSource = 'battles' | 'casualties' | 'missiles'

/** Adds to what `a` has earned against `b`, remembering where it came from. A side never earns past the cap. */
function addWarScore(s: GameState, a: NationId, b: NationId, amount: number, source: WarScoreSource) {
  const key = scoreKey(a, b)
  const before = s.warScore[key] ?? 0
  const now = clamp(before + amount, 0, WARSCORE.max)
  s.warScore[key] = now
  const gained = now - before
  if (gained > 0 && WARSCORE.live) {
    const l = ((s.warLedger ??= {})[key] ??= { battles: 0, casualties: 0, missiles: 0 })
    l[source] += gained
  }
}

/** Land `a` holds that was `b`'s, counted for as long as `a` holds it: read from the record of conquests, never stored as a score. */
function occupation(s: GameState, a: NationId, b: NationId): { land: number; capital: number; countries: number } {
  let land = 0
  let capital = 0
  let countries = 0
  if (!WARSCORE.live || !s.occupied) return { land, capital, countries }
  for (const [id, from] of Object.entries(s.occupied)) {
    if (from !== b || s.regions[id]?.owner !== a) continue
    countries++
    if (s.nations[b]?.originalCapital === id || s.nations[b]?.capital === id) capital += WARSCORE.capitalCapture - WARSCORE.capture
    land += WARSCORE.capture
  }
  return { land, capital, countries }
}

const earned = (s: GameState, a: NationId, b: NationId) => s.warScore[scoreKey(a, b)] ?? 0

/** The score before it is held to -100..100. */
function rawScore(s: GameState, a: NationId, b: NationId): number {
  const mine = occupation(s, a, b)
  const theirs = occupation(s, b, a)
  return earned(s, a, b) - earned(s, b, a) + mine.land + mine.capital - theirs.land - theirs.capital
}

/** War score of `a` against `b` minus the reverse, from -100 to 100. */
export function netWarScore(s: GameState, a: NationId, b: NationId): number {
  return Math.round(clamp(rawScore(s, a, b), -WARSCORE.max, WARSCORE.max))
}

function dropOccupation(s: GameState, drop: (id: RegionId, from: NationId) => boolean) {
  if (!s.occupied) return
  for (const [id, from] of Object.entries(s.occupied)) if (drop(id, from)) delete s.occupied[id]
  if (Object.keys(s.occupied).length === 0) delete s.occupied
}

export function clearWarScore(s: GameState, a: NationId, b: NationId) {
  delete s.warScore[scoreKey(a, b)]
  delete s.warScore[scoreKey(b, a)]
  if (s.warLedger) {
    delete s.warLedger[scoreKey(a, b)]
    delete s.warLedger[scoreKey(b, a)]
    if (Object.keys(s.warLedger).length === 0) delete s.warLedger
  }
  dropOccupation(s, (id, from) => {
    const owner = s.regions[id]?.owner
    return (from === a && owner === b) || (from === b && owner === a)
  })
}

/** A nation is gone: its record of scores and conquests goes with it. */
export function forgetWarScore(s: GameState, id: NationId) {
  const involves = (k: string) => k.split('>').includes(id)
  for (const k of Object.keys(s.warScore)) if (involves(k)) delete s.warScore[k]
  if (s.warLedger) {
    for (const k of Object.keys(s.warLedger)) if (involves(k)) delete s.warLedger[k]
    if (Object.keys(s.warLedger).length === 0) delete s.warLedger
  }
  dropOccupation(s, (region, from) => from === id || s.regions[region]?.owner === id)
}

/** Writes down that `by` took a country from `from`. Taking back one's own land erases the record instead. */
function noteConquest(s: GameState, region: RegionId, by: NationId, from: NationId) {
  const occ = (s.occupied ??= {})
  if (occ[region] === by) delete occ[region]
  else occ[region] = from
  if (Object.keys(occ).length === 0) delete s.occupied
}

/**
 * Called when a battle is fought. Kills and wins earn points that fade; a capture is written down (who lost the country) so the lead
 * lasts exactly as long as the land is held. `allies` are partners in a joint war that share the credit (a faction's army fights under its lead).
 */
export function recordBattle(s: GameState, b: BattleReport, capitalTaken: boolean, allies: NationId[] = []) {
  const att = b.attacker.nationId
  const def = b.defender.nationId
  if (att === 'rebels' || def === 'rebels') return
  if (!WARSCORE.live) {
    // The old tally, step for step (the golden hashes depend on the order of the additions).
    addWarScore(s, att, def, totalUnits(b.defender.losses) * WARSCORE.perLossInflicted, 'casualties')
    addWarScore(s, def, att, totalUnits(b.attacker.losses) * WARSCORE.perLossInflicted, 'casualties')
    if (b.winner === 'attacker') addWarScore(s, att, def, WARSCORE.battleWin + (b.captured ? (capitalTaken ? WARSCORE.capitalCapture : WARSCORE.capture) : 0), 'battles')
    else addWarScore(s, def, att, WARSCORE.battleWin, 'battles')
    return
  }
  const live = true
  // A nation the battle destroyed has no war left to score.
  if (live && (!s.nations[att]?.alive || !s.nations[def]?.alive)) return
  const kills = (units: BattleReport['attacker']['losses']) => {
    const v = totalUnits(units) * WARSCORE.perLossInflicted
    return live ? Math.min(v, WARSCORE.battleCap) : v
  }
  const attackers = [att, ...allies.filter((x) => x !== att && x !== def)]
  for (const who of attackers) {
    addWarScore(s, who, def, kills(b.defender.losses), 'casualties')
    if (b.winner === 'attacker') {
      addWarScore(s, who, def, WARSCORE.battleWin, 'battles')
    }
    addWarScore(s, def, who, kills(b.attacker.losses), 'casualties')
    if (b.winner === 'defender') addWarScore(s, def, who, WARSCORE.battleWin, 'battles')
  }
  if (live && b.captured && b.winner === 'attacker') noteConquest(s, b.regionId, att, def)
}

/** Once a month: earnings fade, and records of conquests nobody is fighting over any more are dropped. */
export function fadeWarScore(s: GameState) {
  if (!WARSCORE.live) return
  const keep = 1 - WARSCORE.decay
  for (const k of Object.keys(s.warScore)) {
    const v = s.warScore[k] * keep
    if (v < 0.05) delete s.warScore[k]
    else s.warScore[k] = v
  }
  if (s.warLedger) {
    for (const k of Object.keys(s.warLedger)) {
      if (s.warScore[k] === undefined) {
        delete s.warLedger[k]
        continue
      }
      const l = s.warLedger[k]
      l.battles *= keep
      l.casualties *= keep
      l.missiles *= keep
    }
    if (Object.keys(s.warLedger).length === 0) delete s.warLedger
  }
  dropOccupation(s, (id, from) => {
    const owner = s.regions[id]?.owner
    return !owner || owner === from || !s.wars.includes(pairKey(owner, from))
  })
}

export interface WarPart {
  id: 'battles' | 'casualties' | 'land' | 'capital' | 'missiles' | 'other'
  label: string
  /** Points for you (positive) or for them (negative) from this source. */
  points: number
  note: string
}

export interface WarBreakdown {
  parts: WarPart[]
  /** The sum of the parts before the score is held to -100..100. */
  raw: number
  /** The war score. */
  total: number
}

const tenth = (v: number) => Math.round(v * 10) / 10

/** What the war score is made of, for the screen: battles won, casualties, land held, the capital, missiles. */
export function warBreakdown(s: GameState, _map: WorldMap, a: NationId, b: NationId): WarBreakdown {
  const la = s.warLedger?.[scoreKey(a, b)]
  const lb = s.warLedger?.[scoreKey(b, a)]
  const pick = (k: WarScoreSource) => (la?.[k] ?? 0) - (lb?.[k] ?? 0)
  const mine = occupation(s, a, b)
  const theirs = occupation(s, b, a)
  const ledgerSum = (l: typeof la) => (l ? l.battles + l.casualties + l.missiles : 0)
  const other = earned(s, a, b) - ledgerSum(la) - (earned(s, b, a) - ledgerSum(lb))
  const who = (n: number, ours: string, theirs2: string) => (n > 0.05 ? ours : n < -0.05 ? theirs2 : 'even')
  const land = mine.land - theirs.land
  const cap = mine.capital - theirs.capital
  const parts: WarPart[] = [
    { id: 'battles', label: 'Battles won', points: pick('battles'), note: who(pick('battles'), 'you have won more', 'they have won more') },
    { id: 'casualties', label: 'Casualties inflicted', points: pick('casualties'), note: who(pick('casualties'), 'you have cost them more', 'they have cost you more') },
    { id: 'land', label: 'Land held', points: land, note: `${mine.countries} of theirs held by you, ${theirs.countries} of yours held by them` },
    { id: 'capital', label: 'Capital', points: cap, note: cap > 0 ? 'you hold their capital' : cap < 0 ? 'they hold your capital' : 'neither capital is held' },
    { id: 'missiles', label: 'Missile strikes', points: pick('missiles'), note: who(pick('missiles'), 'your strikes hurt them more', 'their strikes hurt you more') },
  ]
  if (Math.abs(other) > 0.05) parts.push({ id: 'other', label: 'Earlier gains', points: other, note: 'recorded before the breakdown was kept' })
  for (const p of parts) p.points = tenth(p.points)
  return { parts, raw: rawScore(s, a, b), total: netWarScore(s, a, b) }
}

export type Standing = 'winning' | 'ahead' | 'even' | 'behind' | 'losing'

export interface WarStanding {
  verdict: Standing
  /** One number for who is ahead in the war as it stands today: the score, the armies, and what each home front can bear. */
  value: number
  reasons: string[]
}

/** How much a nation's home front is straining, from 0: unrest, weariness, rebels, no oil or food. Adds the reasons it finds to `notes`. */
function homeStrain(s: GameState, id: NationId, notes: string[], whose: string): number {
  const n = s.nations[id]
  if (!n) return 0
  let v = 0
  const stab = clamp((35 - n.stability) * 0.4, 0, 10)
  if (stab > 0.5) {
    v += stab
    notes.push(`${whose} unrest at home (stability ${Math.round(n.stability)})`)
  }
  const weary = clamp((n.warWeariness - 25) * 0.3, 0, 10)
  if (weary > 0.5) {
    v += weary
    notes.push(`${whose} war weariness ${Math.round(n.warWeariness)}`)
  }
  const rebels = Object.values(s.regions).filter((r) => r.owner === id && r.rebels > 0.5).length
  if (rebels > 0) {
    v += Math.min(8, rebels * 2)
    notes.push(`${whose} rebels in ${rebels} ${rebels === 1 ? 'country' : 'countries'}`)
  }
  if (n.oilShortage) {
    v += 3
    notes.push(`${whose} no oil for its vehicles`)
  }
  if (n.foodShortage) {
    v += 3
    notes.push(`${whose} food shortage`)
  }
  return v
}

/**
 * Who is actually winning, apart from the points: the war score, plus how the armies stand against each other, minus the strain on each
 * home front. A big lead with a broken army, a restless people or a rebellion is not a safe lead, and this says so.
 */
export function warStanding(s: GameState, _map: WorldMap, a: NationId, b: NationId): WarStanding {
  const reasons: string[] = []
  const score = netWarScore(s, a, b)
  const pa = militaryPower(s, a)
  const pb = militaryPower(s, b)
  const edge = clamp(Math.log2((pa + 1) / (pb + 1)) * 12, -18, 18)
  if (edge >= 6) reasons.push('your army is much stronger')
  else if (edge <= -6) reasons.push('their army is much stronger')
  const mine = homeStrain(s, a, reasons, 'your')
  const theirs = homeStrain(s, b, reasons, 'their')
  const value = score + edge - mine + theirs
  const verdict: Standing = value >= 20 ? 'winning' : value >= 6 ? 'ahead' : value > -6 ? 'even' : value > -20 ? 'behind' : 'losing'
  if (reasons.length === 0) reasons.push(score >= 6 ? 'ahead on points, nothing else in the way' : score <= -6 ? 'behind on points' : 'no one has the upper hand')
  return { verdict, value: Math.round(value), reasons }
}

/** War score needed to demand a region at the peace table. */
export function regionValue(s: GameState, map: WorldMap, id: RegionId): number {
  const r = s.regions[id]
  return Math.round(clamp(6 + regionWorkforce(r, map.regions[id]) * 1.6, 6, 45))
}

/** War score needed to make a nation a puppet: a share of what its land is worth. */
export function puppetValue(s: GameState, map: WorldMap, id: NationId): number {
  let land = 0
  for (const r of Object.values(s.regions)) if (r.owner === id) land += regionValue(s, map, r.id)
  return Math.round(Math.min(EMPIRE.puppetCap, Math.max(DIPLOMACY.puppet.minValue, land * DIPLOMACY.puppet.valueShare)))
}

/** War score needed to free a puppet at the peace table: a share of what making it one would cost. */
export function liberateValue(s: GameState, map: WorldMap, puppet: NationId): number {
  return Math.round(puppetValue(s, map, puppet) * PUPPET.liberate.cost)
}

export function termsCost(s: GameState, map: WorldMap, terms: PeaceTerms, proposer: NationId, target: NationId) {
  let demand = 0
  let concession = 0
  for (const id of terms.cede) {
    const owner = s.regions[id]?.owner
    if (owner === target) demand += regionValue(s, map, id)
    else if (owner === proposer) concession += regionValue(s, map, id)
  }
  if (terms.puppet) demand += puppetValue(s, map, target)
  if (terms.territory) demand += territoryValue(s, map, target)
  if (terms.liberate !== undefined && s.nations[terms.liberate]) demand += liberateValue(s, map, terms.liberate)
  if (terms.reparations > 0) demand += terms.reparations * 1.2
  else concession += -terms.reparations * 1.2
  return { demand: Math.round(demand), concession: Math.round(concession) }
}

export function validatePeaceTerms(s: GameState, map: WorldMap, terms: PeaceTerms, proposer: NationId, target: NationId, checkBudget = true): string | null {
  if (terms.puppet) {
    if (s.nations[target].overlord) return `${s.nations[target].name} is already a puppet`
    if (s.nations[proposer].overlord) return 'A puppet cannot make puppets'
    if (s.nations[target].territoryOf) return `${s.nations[target].name} is a territory`
    if (s.nations[proposer].territoryOf) return 'A territory cannot make puppets'
  }
  if (terms.territory) {
    if (terms.puppet || terms.liberate !== undefined) return 'A nation cannot be made a territory and a puppet in one deal, or have a puppet freed with it'
    const why = territoryProblem(s, proposer, target)
    if (why) return why
  }
  // A territory owes no war reparations, to anyone.
  if (terms.reparations > 0 && s.nations[target]?.territoryOf) return `${s.nations[target].name} is a territory and owes no reparations`
  if (terms.reparations < 0 && s.nations[proposer]?.territoryOf) return `${s.nations[proposer].name} is a territory and owes no reparations`
  if (terms.territory && terms.reparations > 0) return 'A territory owes no reparations'
  if (terms.liberate !== undefined) {
    const why = liberationProblem(s, proposer, target, terms.liberate)
    if (why) return why
  }
  const seen = new Set<RegionId>()
  for (const id of terms.cede) {
    const r = s.regions[id]
    if (!r || seen.has(id)) return 'Invalid region in terms'
    seen.add(id)
    if (r.owner !== proposer && r.owner !== target) return `${map.regions[id].name} is not held by either side`
    if (s.nations[r.owner].capital === id) return 'A capital city cannot be given away'
  }
  if (!Number.isFinite(terms.reparations) || Math.abs(terms.reparations) > MAX_REPARATIONS) return `Reparations are capped at ${MAX_REPARATIONS} per month`
  if (!checkBudget) return null
  const { demand, concession } = termsCost(s, map, terms, proposer, target)
  const budget = Math.max(0, netWarScore(s, proposer, target))
  if (demand - concession > budget) return `Demands (${demand - concession}) exceed your war score (${budget})`
  return null
}

/** What a missile strike earns toward the peace table: the Defense Line it cut and the share of people it killed, a little each, capped per salvo. */
export function addMissileScore(s: GameState, attacker: NationId, victim: NationId, lineCut: number, percentKilled: number) {
  const amount = Math.min(MW.scoreMax, lineCut * MW.scoreLine + percentKilled * MW.scorePerPercent)
  if (amount > 0.01) addWarScore(s, attacker, victim, amount, 'missiles')
}
