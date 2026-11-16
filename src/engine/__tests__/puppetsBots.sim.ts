/**
 * Puppets in natural bot play: all-bot worlds (the player's seat too), events off. Not a test file; `puppetsBots.test.ts` runs it
 * when asked for (VITE_PUPBOT=1) and prints PUPBOT lines. It records every puppet made, its loyalty over its life, the tribute it paid
 * and the largest empire at the end (a snowball check).
 */
import { PUPPET } from '../../data/puppets'
import { extraction } from '../puppets'
import { empireCount } from '../empire'
import { getWorld } from '../../map/world'
import type { Difficulty, GameState } from '../types'
import { playWorld } from './strategySim'

export interface PuppetLife {
  id: string
  master: string
  born: number
  /** Loyalty each month it lived, and the month it ended (null: still a puppet at the end). */
  loyalty: number[]
  ended: number | null
  /** Tribute (money-equivalent) it paid over its life. */
  tribute: number
}

export interface PuppetBotRun {
  difficulty: Difficulty
  seed: number
  months: number
  made: number
  lives: PuppetLife[]
  maxPuppetsOfOne: number
  topEmpire: number
  topCountries: number
  alive: number
  zeroLoyaltyMonths: number
  /** The most, and the mean, of the share of its gross a master collects as tribute in a month. */
  tributeShareMax: number
  tributeShareMean: number
}

export function puppetBotRun(difficulty: Difficulty, seed: number, months: number, player = 'poland'): PuppetBotRun {
  const { map } = getWorld()
  const lives = new Map<string, PuppetLife>()
  const all: PuppetLife[] = []
  let maxOne = 0
  const share = { max: 0, sum: 0, n: 0 }
  const probe = (s: GameState, _o: unknown, month: number) => {
    const by = new Map<string, number>()
    for (const n of Object.values(s.nations)) {
      if (!n.alive || !n.overlord) continue
      by.set(n.overlord, (by.get(n.overlord) ?? 0) + 1)
      let life = lives.get(n.id)
      if (!life || life.master !== n.overlord || life.ended !== null) {
        life = { id: n.id, master: n.overlord, born: month, loyalty: [], ended: null, tribute: 0 }
        lives.set(n.id, life)
        all.push(life)
      }
      life.loyalty.push(n.loyalty ?? -1)
    }
    for (const [master, k] of by) {
      if (!s.nations[master]?.alive) continue
      try {
        const { total, cap } = extraction(s, map, master)
        // What the master really collects: everything up to the cap, then half of the rest.
        const effective = total <= cap ? total : cap + (total - cap) * PUPPET.capRate
        const gross = cap / PUPPET.extractionCap
        if (gross > 1) {
          share.max = Math.max(share.max, effective / gross)
          share.sum += effective / gross
          share.n++
        }
        for (const life of all) if (life.master === master && life.ended === null) life.tribute += effective / k
      } catch {
        /* a master that fell */
      }
    }
    for (const [id, life] of lives) {
      const n = s.nations[id]
      if (life.ended === null && (!n?.alive || n.overlord !== life.master)) life.ended = month
    }
    for (const v of by.values()) maxOne = Math.max(maxOne, v)
  }
  const { result, state } = playWorld({ seed, difficulty, months, player, probe, check: true })
  let top = 0
  let topC = 0
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue
    top = Math.max(top, empireCount(state, n.id))
    topC = Math.max(topC, Object.values(state.regions).filter((r) => r.owner === n.id).length)
  }
  return {
    difficulty,
    seed,
    months,
    made: all.length,
    lives: all,
    maxPuppetsOfOne: maxOne,
    topEmpire: top,
    topCountries: topC,
    alive: result.alive,
    tributeShareMax: share.max,
    tributeShareMean: share.n ? share.sum / share.n : 0,
    zeroLoyaltyMonths: all.reduce((a, l) => a + l.loyalty.filter((x) => x >= 0 && x < 1).length, 0),
  }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
export function summarizeLife(l: PuppetLife) {
  const ls = l.loyalty.filter((x) => x >= 0)
  return { id: l.id, master: l.master, born: l.born, months: l.loyalty.length, ended: l.ended, minL: Math.min(...ls, 100), avgL: Math.round(avg(ls)), lastL: ls[ls.length - 1] ?? -1, tribute: Math.round(l.tribute) }
}
