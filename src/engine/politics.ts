import { COUP, ELECTION, GOVERNMENTS } from '../data/government'
import { addLog, clamp } from './helpers'
import type { Rng } from './rng'
import type { GameState } from './types'

/**
 * Elections and coups, once a month after the economy has run.
 * A democracy that has kept its people content wins its election; one that has not, loses.
 * A junta whose people are close to revolt can be overthrown.
 */
export function runPolitics(s: GameState, rng: Rng) {
  for (const n of Object.values(s.nations)) {
    if (!n.alive) continue
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

/** Months until a nation's next election, or null when it holds none. */
export function monthsToElection(s: GameState, nationId: string): number | null {
  const n = s.nations[nationId]
  if (!n || GOVERNMENTS[n.government].election === 0 || n.nextElection <= 0) return null
  return Math.max(0, n.nextElection - s.turn)
}
