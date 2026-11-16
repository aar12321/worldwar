/**
 * Territories in natural bot play: all-bot worlds (the player's seat too), events off. Not a test file; `territoriesBots.test.ts` runs it when
 * asked for (VITE_TERRBOT=1) and prints TERRBOT lines. For each territory made it records the war score it cost, its revenue and the cut taken
 * over its life, and for every master the share of its own gross the cuts make, next to the puppets and conquests of the same run.
 */
import { TERRITORY } from '../../data/territories'
import { empireCount } from '../empire'
import { revenueOf, territoryValue } from '../territories'
import { grossIncome } from '../victory'
import { puppetValue } from '../warscore'
import { getWorld } from '../../map/world'
import type { Difficulty, GameState } from '../types'
import { playWorld } from './strategySim'

export interface TerritoryLife {
  id: string
  master: string
  born: number
  ended: number | null
  months: number
  price: number
  puppetPrice: number
  /** Revenue of the territory at birth and its cut over its life. */
  revenue0: number
  cut: number
  /** Its master's gross at birth. */
  masterGross0: number
}

export interface TerritoryBotRun {
  difficulty: Difficulty
  seed: number
  months: number
  made: number
  lives: TerritoryLife[]
  maxTerritoriesOfOne: number
  puppetsMade: number
  topEmpire: number
  topCountries: number
  alive: number
  /** The most, and the mean, of a master's cuts as a share of its own gross, in a month a master held one. */
  cutShareMax: number
  cutShareMean: number
  /** Where the biggest empire's tier count comes from: its own countries, territories. */
  topSplit: { own: number; territories: number; count: number }
}

export function territoryBotRun(difficulty: Difficulty, seed: number, months: number, player = 'poland'): TerritoryBotRun {
  const { map } = getWorld()
  const lives = new Map<string, TerritoryLife>()
  const all: TerritoryLife[] = []
  const share = { max: 0, sum: 0, n: 0 }
  let maxOne = 0
  let puppets = 0
  const seenPuppets = new Set<string>()
  const probe = (s: GameState, _o: unknown, month: number) => {
    const by = new Map<string, number>()
    for (const n of Object.values(s.nations)) {
      if (!n.alive) continue
      if (n.overlord && !seenPuppets.has(`${n.id}>${n.overlord}`)) {
        seenPuppets.add(`${n.id}>${n.overlord}`)
        puppets++
      }
      if (!n.territoryOf) continue
      by.set(n.territoryOf, (by.get(n.territoryOf) ?? 0) + 1)
      let life = lives.get(n.id)
      if (!life || life.master !== n.territoryOf || life.ended !== null) {
        life = { id: n.id, master: n.territoryOf, born: month, ended: null, months: 0, price: territoryValue(s, map, n.id), puppetPrice: puppetValue(s, map, n.id), revenue0: revenueOf(s, map, n.id), cut: 0, masterGross0: grossIncome(s, map, n.territoryOf) }
        lives.set(n.id, life)
        all.push(life)
      }
      life.months++
      life.cut += s.territories?.[n.id]?.last ?? 0
    }
    for (const [master, k] of by) {
      maxOne = Math.max(maxOne, k)
      if (!s.nations[master]?.alive) continue
      let cuts = 0
      for (const [id, rec] of Object.entries(s.territories ?? {})) if (rec.master === master && s.nations[id]?.alive) cuts += rec.last
      const gross = grossIncome(s, map, master)
      if (gross > 1 && cuts > 0) {
        share.max = Math.max(share.max, cuts / gross)
        share.sum += cuts / gross
        share.n++
      }
    }
    for (const [id, life] of lives) {
      const n = s.nations[id]
      if (life.ended === null && (!n?.alive || n.territoryOf !== life.master)) life.ended = month
    }
  }
  const { result, state } = playWorld({ seed, difficulty, months, player, probe, check: true })
  let top = 0
  let topC = 0
  let split = { own: 0, territories: 0, count: 0 }
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue
    const c = empireCount(state, n.id)
    const own = Object.values(state.regions).filter((r) => r.owner === n.id).length
    top = Math.max(top, c)
    if (own > topC) {
      topC = own
      split = { own, territories: Object.values(state.nations).filter((x) => x.alive && x.territoryOf === n.id).length, count: c }
    }
  }
  return { difficulty, seed, months, made: all.length, lives: all, maxTerritoriesOfOne: maxOne, puppetsMade: puppets, topEmpire: top, topCountries: topC, alive: result.alive, cutShareMax: share.max, cutShareMean: share.n ? share.sum / share.n : 0, topSplit: split }
}

export const summarizeTerritory = (l: TerritoryLife) => ({ id: l.id, master: l.master, born: l.born, months: l.months, ended: l.ended, price: l.price, puppetPrice: l.puppetPrice, revenue0: Math.round(l.revenue0 * 10) / 10, cut: Math.round(l.cut), masterGross0: Math.round(l.masterGross0 * 10) / 10, cutPerMonth: l.months ? Math.round((l.cut / l.months) * 10) / 10 : 0, share: TERRITORY.cut })
