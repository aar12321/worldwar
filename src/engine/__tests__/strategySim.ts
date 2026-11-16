import { generateAllBotOrders, generateBotOrders } from '../../ai/bot'
import { createInitialState, type NewGameOptions } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { applyEventChoice } from '../events'
import { computeEconomy } from '../economy'
import { enemiesOf, pairKey, regionsOf, totalUnits } from '../helpers'
import { militaryPower } from '../militaryStats'
import { resolveTurn } from '../resolveTurn'
import type { Difficulty, GameState, Order } from '../types'
import { forecastAttack } from '../warfare'
import { netWarScore } from '../warscore'
import { checkInvariants } from './invariants'

/**
 * The strategy harness: plays whole worlds with the AI in every seat (the player's too) and measures how the game plays.
 * Not a pass or fail test: `strategySim.test.ts` runs it only when asked for, and docs/STRATEGY.md says how and what the numbers mean.
 */
export interface WarRecord {
  key: string
  started: number
  ended: number | null
  /** How it ended: a treaty, a nation's fall, a puppet, or still going when the game stopped. */
  how: 'peace' | 'elimination' | 'puppet' | 'open'
  /** The war score lead of whoever was ahead when it ended, 0 to 100. */
  lead: number
  /** Regions that changed hands inside it (captures). */
  captures: number
  /** Battles fought between the two sides. */
  battles: number
  /** Military power of the side that declared it, over the other side's, on the day it was declared. 0 when it began another way. */
  ratio: number
}

export interface SimResult {
  difficulty: Difficulty
  seed: number
  months: number
  alive: number
  /** Countries held by the biggest nation, at the end and at the halfway mark. */
  topHold: number
  topHoldHalf: number
  /** Share of all countries held by the top five. */
  top5Share: number
  attacks: number
  attackWins: number
  captures: number
  /** Sum and count of the forecast win chance of every attack launched. */
  oddsSum: number
  oddsLow: number
  oddsHigh: number
  /** Attacks launched by nations whose military was a small part of what the target could field. */
  declarations: number
  peaceOffers: number
  wars: WarRecord[]
  /** Wars still open at the end, and how old they are in months. */
  openAges: number[]
  /** Nations that never declared a war, never attacked and were never attacked in the whole game. */
  quiet: number
  /** Median months of income the quiet nations hold in the treasury, and the median of the nations that fought. */
  quietHoard: number
  fightHoard: number
  /** Nations that fought at least one war. */
  fighters: number
  alliances: number
  allianceCalls: number
  allianceJoined: number
  strikes: number
  /** Capitals taken. */
  capitalsTaken: number
  /** Median months of income a nation holds in the treasury, and the share holding more than 24 months of it. */
  hoardMedian: number
  hoardShare: number
  /** Battles lost by an attacker that was thrown back with line untouched (a wasted attack). */
  repulsed: number
  /** Monthly spread of nations alive. */
  aliveSeries: number[]
  /** Wars started per 12 months. */
  warsPerYear: number
  /** Nations that lost ground and took some back. */
  recoveries: number
  /** Nations knocked out by the end and the number of puppets. */
  puppets: number
  stalls: number
  /** Declarations made with less military power than the target. */
  riskyDeclarations: number
}

export interface SimOptions extends Partial<NewGameOptions> {
  seed: number
  difficulty: Difficulty
  months: number
  player?: string
  /** Called with the state after each month, for custom probes. */
  probe?: (s: GameState, orders: Order[], month: number) => void
  check?: boolean
  /** Leave out every posture order, as if nobody ever stationed forces (to measure what the postures change). */
  noPosture?: boolean
}

export function playWorld(opts: SimOptions): { result: SimResult; state: GameState } {
  const { map } = getWorld()
  let s: GameState = createInitialState(map, { goal: 'classic', victoryShare: 2, playerRegionId: opts.player ?? 'poland', seed: opts.seed, difficulty: opts.difficulty, scenario: opts.scenario })
  s.nextEventTurn = 99999
  const wars = new Map<string, WarRecord>()
  const lastNet = new Map<string, number>()
  const done: WarRecord[] = []
  const fought = new Set<string>()
  const lossesEver = new Map<string, number>()
  const recovered = new Set<string>()
  const peak = new Map<string, number>()
  const aliveSeries: number[] = []
  const r: SimResult = {
    difficulty: opts.difficulty,
    seed: opts.seed,
    months: opts.months,
    alive: 0,
    topHold: 0,
    topHoldHalf: 0,
    top5Share: 0,
    attacks: 0,
    attackWins: 0,
    captures: 0,
    oddsSum: 0,
    oddsLow: 0,
    oddsHigh: 0,
    declarations: 0,
    peaceOffers: 0,
    wars: [],
    openAges: [],
    quiet: 0,
    quietHoard: 0,
    fightHoard: 0,
    fighters: 0,
    alliances: 0,
    allianceCalls: 0,
    allianceJoined: 0,
    strikes: 0,
    capitalsTaken: 0,
    hoardMedian: 0,
    hoardShare: 0,
    repulsed: 0,
    aliveSeries,
    warsPerYear: 0,
    recoveries: 0,
    puppets: 0,
    stalls: 0,
    riskyDeclarations: 0,
  }
  const declared = new Map<string, number>()
  let started = 0
  const top = () => {
    let best = 0
    const count = new Map<string, number>()
    for (const reg of Object.values(s.regions)) count.set(reg.owner, (count.get(reg.owner) ?? 0) + 1)
    for (const v of count.values()) best = Math.max(best, v)
    return { best, count }
  }
  for (let i = 0; i < opts.months; i++) {
    if (s.pendingEvent) s = applyEventChoice(s, map, 0)
    const orders = [...generateAllBotOrders(s, map), ...generateBotOrders(s, map, s.playerId, true)].filter((o) => !(opts.noPosture && o.type === 'setDeployment'))
    for (const o of orders) {
      if (o.type === 'attack') {
        const f = forecastAttack(s, map, o.nationId, o.target, o.commit ?? 'main', o.stance ?? 'assault', 8, o.missiles, o.share)
        if (f) {
          r.oddsSum += f.winChance
          if (f.winChance < 0.4) r.oddsLow++
          if (f.winChance >= 0.75) r.oddsHigh++
        }
        r.attacks++
        fought.add(o.nationId)
      } else if (o.type === 'declareWar') {
        r.declarations++
        fought.add(o.nationId)
        const ratio = militaryPower(s, o.nationId) / Math.max(0.1, militaryPower(s, o.target))
        declared.set(pairKey(o.nationId, o.target), ratio)
        if (ratio < 1) r.riskyDeclarations++
      } else if (o.type === 'propose' && o.proposal.kind === 'peace') r.peaceOffers++
      else if (o.type === 'propose' && o.proposal.kind === 'callToArms') r.allianceCalls++
      else if (o.type === 'strike') r.strikes++
    }
    for (const key of s.wars) {
      const [a, b] = key.split('|')
      lastNet.set(key, Math.max(netWarScore(s, a, b), netWarScore(s, b, a)))
    }
    const before = new Set(s.wars)
    const owners0 = new Map(Object.values(s.regions).map((x) => [x.id, x.owner]))
    s = resolveTurn(s, map, orders)
    // The bots play the player's nation too. If it falls, or reaches its goal, the world carries on: the measuring does not stop with it.
    if (s.outcome !== 'playing') s.outcome = 'playing'
    for (const b of s.battles) {
      if (b.attacker.nationId === 'rebels') continue
      if (b.winner === 'attacker') r.attackWins++
      if (b.captured) {
        r.captures++
        const key = [b.attacker.nationId, b.defender.nationId].sort().join('|')
        const w = wars.get(key)
        if (w) w.captures++
        if (s.nations[b.defender.nationId] && owners0.get(b.regionId) === b.defender.nationId && b.regionId === s.nations[b.defender.nationId].originalCapital) r.capitalsTaken++
      } else if (b.winner === 'defender' && (b.lineBefore ?? 0) - (b.lineAfter ?? 0) < 0.01) r.repulsed++
      fought.add(b.attacker.nationId)
      fought.add(b.defender.nationId)
      const bw = wars.get([b.attacker.nationId, b.defender.nationId].sort().join('|'))
      if (bw) bw.battles++
    }
    for (const d of s.dispatches) if (d.kind === 'joined') r.allianceJoined++
    for (const key of s.wars) {
      if (!before.has(key)) {
        started++
        wars.set(key, { key, started: s.turn - 1, ended: null, how: 'open', lead: 0, captures: 0, battles: 0, ratio: declared.get(key) ?? 0 })
      }
    }
    for (const key of before) {
      if (s.wars.includes(key)) continue
      const w = wars.get(key) ?? { key, started: 0, ended: null, how: 'open' as const, lead: 0, captures: 0, battles: 0, ratio: 0 }
      const [a, b] = key.split('|')
      w.ended = s.turn - 1
      w.lead = lastNet.get(key) ?? 0
      const dead = !s.nations[a].alive || !s.nations[b].alive
      const pup = s.nations[a].overlord === b || s.nations[b].overlord === a
      w.how = dead ? 'elimination' : pup ? 'puppet' : 'peace'
      done.push(w)
      wars.delete(key)
    }
    // Territory lost and taken back.
    const count = new Map<string, number>()
    for (const reg of Object.values(s.regions)) count.set(reg.owner, (count.get(reg.owner) ?? 0) + 1)
    for (const [id, c] of count) {
      const p = peak.get(id) ?? c
      if (c > p) peak.set(id, c)
      else if (!peak.has(id)) peak.set(id, c)
      const lost = lossesEver.get(id) ?? 0
      if (c < (peak.get(id) ?? c)) lossesEver.set(id, Math.max(lost, (peak.get(id) ?? c) - c))
      else if (lost > 0 && c > (peak.get(id) ?? c) - lost + 0) recovered.add(id)
    }
    aliveSeries.push(Object.values(s.nations).filter((n) => n.alive).length)
    if (i === Math.floor(opts.months / 2) - 1) r.topHoldHalf = top().best
    opts.probe?.(s, orders, i)
    if (opts.check && i % 12 === 11) checkInvariants(s)
  }
  for (const w of wars.values()) {
    r.openAges.push(s.turn - w.started)
    done.push({ ...w, ended: null, how: 'open' })
  }
  r.wars = done
  const alive = Object.values(s.nations).filter((n) => n.alive)
  r.alive = alive.length
  const t = top()
  r.topHold = t.best
  r.top5Share = [...t.count.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0) / Object.keys(s.regions).length
  r.fighters = fought.size
  r.quiet = alive.filter((n) => !fought.has(n.id) && enemiesOf(s, n.id).length === 0).length
  r.alliances = s.alliances.length
  r.recoveries = recovered.size
  r.puppets = alive.filter((n) => n.overlord).length
  const hoards: number[] = []
  const quietHoards: number[] = []
  const fightHoards: number[] = []
  for (const n of alive) {
    const e = computeEconomy(s, map, n.id)
    const income = Math.max(1, e.taxIncome + e.factoryIncome + e.tradeIncome)
    hoards.push(n.resources.capital / income)
    ;(!fought.has(n.id) && enemiesOf(s, n.id).length === 0 ? quietHoards : fightHoards).push(n.resources.capital / income)
  }
  quietHoards.sort((a, b) => a - b)
  fightHoards.sort((a, b) => a - b)
  r.quietHoard = quietHoards[Math.floor(quietHoards.length / 2)] ?? 0
  r.fightHoard = fightHoards[Math.floor(fightHoards.length / 2)] ?? 0
  hoards.sort((a, b) => a - b)
  r.hoardMedian = hoards[Math.floor(hoards.length / 2)] ?? 0
  r.hoardShare = hoards.filter((h) => h > 24).length / Math.max(1, hoards.length)
  r.warsPerYear = (started / opts.months) * 12
  r.stalls = r.openAges.filter((a) => a >= 18).length
  void regionsOf
  void totalUnits
  return { result: r, state: s }
}

const med = (xs: number[]) => {
  if (!xs.length) return 0
  const a = [...xs].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** The numbers docs/STRATEGY.md reports, averaged over a set of games of one difficulty. */
export function summarize(results: SimResult[]) {
  const wars = results.flatMap((x) => x.wars)
  const ended = wars.filter((w) => w.how !== 'open')
  const decisive = ended.filter((w) => w.how === 'elimination' || w.how === 'puppet' || w.lead >= 20 || w.captures >= 2)
  const attacks = results.reduce((a, x) => a + x.attacks, 0)
  return {
    games: results.length,
    aliveAtEnd: avg(results.map((x) => x.alive)),
    topHoldHalf: avg(results.map((x) => x.topHoldHalf)),
    topHold: avg(results.map((x) => x.topHold)),
    topHoldMax: Math.max(...results.map((x) => x.topHold)),
    top5Share: avg(results.map((x) => x.top5Share)),
    warsPerGameYear: avg(results.map((x) => x.warsPerYear)),
    warsEnded: ended.length / results.length,
    decisivePerGame: decisive.length / results.length,
    decisiveShare: ended.length ? decisive.length / ended.length : 0,
    warMonthsMedian: med(ended.map((w) => (w.ended ?? 0) - w.started)),
    warMonthsMean: avg(ended.map((w) => (w.ended ?? 0) - w.started)),
    rematchShare: ((): number => {
      const seen = new Map<string, number>()
      let again = 0
      for (const w of wars) {
        const k = `${w.key}`
        seen.set(k, (seen.get(k) ?? 0) + 1)
        if ((seen.get(k) ?? 0) >= 3) again++
      }
      return wars.length ? again / wars.length : 0
    })(),
    idleByOrderShare: ((): number => {
      const byOrder = ended.filter((w) => w.ratio > 0)
      return byOrder.length ? byOrder.filter((w) => w.battles === 0 && w.how === 'peace').length / byOrder.length : 0
    })(),
    idleMonthsMedian: med(ended.filter((w) => w.battles === 0 && w.how === 'peace').map((w) => (w.ended ?? 0) - w.started)),
    idleWarShare: ended.length ? ended.filter((w) => w.battles === 0 && w.how === 'peace').length / ended.length : 0,
    stalledPerGame: wars.filter((w) => w.battles >= 3 && w.captures === 0 && (w.ended ?? 999) - w.started >= 12).length / results.length,
    riskyDeclarationShare: results.reduce((a, x) => a + x.declarations, 0) ? results.reduce((a, x) => a + x.riskyDeclarations, 0) / results.reduce((a, x) => a + x.declarations, 0) : 0,
    warsOver24: ended.filter((w) => (w.ended ?? 0) - w.started > 24).length / results.length,
    openWarsAtEnd: avg(results.map((x) => x.openAges.length)),
    openOver18: avg(results.map((x) => x.stalls)),
    attacksPerGame: attacks / results.length,
    attackWinRate: attacks ? results.reduce((a, x) => a + x.attackWins, 0) / attacks : 0,
    meanOdds: attacks ? results.reduce((a, x) => a + x.oddsSum, 0) / attacks : 0,
    lowOddsShare: attacks ? results.reduce((a, x) => a + x.oddsLow, 0) / attacks : 0,
    highOddsShare: attacks ? results.reduce((a, x) => a + x.oddsHigh, 0) / attacks : 0,
    capturesPerGame: avg(results.map((x) => x.captures)),
    capitalsPerGame: avg(results.map((x) => x.capitalsTaken)),
    repulsedShare: attacks ? results.reduce((a, x) => a + x.repulsed, 0) / attacks : 0,
    declarationsPerGame: avg(results.map((x) => x.declarations)),
    peaceOffersPerGame: avg(results.map((x) => x.peaceOffers)),
    fightersShare: avg(results.map((x) => x.fighters / 175)),
    quietNations: avg(results.map((x) => x.quiet)),
    alliancesAtEnd: avg(results.map((x) => x.alliances)),
    callsPerGame: avg(results.map((x) => x.allianceCalls)),
    joinedPerGame: avg(results.map((x) => x.allianceJoined)),
    strikesPerGame: avg(results.map((x) => x.strikes)),
    hoardMedian: avg(results.map((x) => x.hoardMedian)),
    hoardShare: avg(results.map((x) => x.hoardShare)),
    recoveries: avg(results.map((x) => x.recoveries)),
    puppets: avg(results.map((x) => x.puppets)),
  }
}
