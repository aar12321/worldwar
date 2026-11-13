import { COUP, ELECTION, GOVERNMENTS } from '../data/government'
import { DIPLOMACY } from '../data/unitTypes'
import { computeEconomy } from './economy'
import { addLog, clamp } from './helpers'
import { militaryPower } from './militaryStats'
import type { Rng } from './rng'
import type { GameState, Nation, WorldMap } from './types'

/**
 * Elections and coups, once a month after the economy has run.
 * A democracy that has kept its people content wins its election; one that has not, loses.
 * A junta whose people are close to revolt can be overthrown.
 */
export function runPolitics(s: GameState, map: WorldMap, rng: Rng) {
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
    if (n.overlord) payTribute(s, map, n, rng)
    const gov = GOVERNMENTS[n.government]
    if (gov.election > 0 && n.nextElection > 0 && s.turn >= n.nextElection) {
      n.nextElection = s.turn + gov.election
      if (n.stability >= ELECTION.needed) {
        n.stability = clamp(n.stability + ELECTION.win.stability, 0, 100)
        n.resources.pp = Math.min(200, n.resources.pp + ELECTION.win.influence)
        if (n.isPlayer) addLog(s, 'event', `${n.name}'s government won the election. Stability +${ELECTION.win.stability}, influence +${ELECTION.win.influence}.`, [n.id])
      } else {
        n.stability = clamp(n.stability + ELECTION.lose.stability, 0, 100)
        n.resources.pp = Math.floor(n.resources.pp * ELECTION.lose.influenceLoss)
        n.taxRate = Math.min(n.taxRate, ELECTION.lose.tax)
        addLog(s, 'event', `${n.name}'s government lost the election. The new one cuts taxes, and stability drops.`, n.isPlayer ? [n.id] : [n.id])
      }
    }
    if (gov.coups && n.stability < COUP.below && rng.chance((COUP.below - n.stability) * COUP.perPoint)) {
      n.stability = COUP.stabilityAfter
      n.resources.pp = 0
      n.laws = []
      n.draftRate = Math.min(n.draftRate, 0.1)
      addLog(s, 'event', `A coup overthrew the junta in ${n.name}. Its laws are gone and a new junta holds power.`, [n.id])
    }
  }
}

/** A puppet pays part of its income to its master, and breaks free when its master dies or it grows strong and restless. */
function payTribute(s: GameState, map: WorldMap, puppet: Nation, rng: Rng) {
  const master = s.nations[puppet.overlord ?? '']
  if (!master?.alive) {
    puppet.overlord = null
    return
  }
  const e = computeEconomy(s, map, puppet.id)
  const tribute = Math.max(0, e.taxIncome + e.factoryIncome + e.tradeIncome + e.corporateIncome) * DIPLOMACY.puppet.tribute
  puppet.resources.capital -= tribute
  master.resources.capital += tribute
  const strong = militaryPower(s, puppet.id) > militaryPower(s, master.id) * 0.8
  if ((puppet.stability < 30 || strong) && rng.chance(DIPLOMACY.puppet.breakChance)) {
    puppet.overlord = null
    addLog(s, 'war', `${puppet.name} threw off ${master.name}'s rule and is independent again.`, [puppet.id, master.id])
  }
}

/** Months until a nation's next election, or null when it holds none. */
export function monthsToElection(s: GameState, nationId: string): number | null {
  const n = s.nations[nationId]
  if (!n || GOVERNMENTS[n.government].election === 0 || n.nextElection <= 0) return null
  return Math.max(0, n.nextElection - s.turn)
}
