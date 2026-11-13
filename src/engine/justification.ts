import { JUSTIFY } from '../data/war'
import { addOpinion, nationNeighbors, opinionOf } from '../ai/opinion'
import type { Rng } from './rng'
import { addLog, atWar, grantJustification, hasCasusBelli, hasPact, isAllied } from './helpers'
import type { GameState, NationId, WorldMap } from './types'

const nm = (s: GameState, id: NationId) => s.nations[id]?.name ?? id

/** The month's work on reasons for war: cases come due, border incidents flare, reputations fade. */
export function runJustification(s: GameState, map: WorldMap, rng: Rng) {
  // Cases that have matured become reasons for war.
  const waiting = []
  for (const c of s.cases) {
    if (!s.nations[c.holder]?.alive || !s.nations[c.target]?.alive || atWar(s, c.holder, c.target) || isAllied(s, c.holder, c.target) || hasPact(s, c.holder, c.target)) continue
    if (c.ready > s.turn) {
      waiting.push(c)
      continue
    }
    grantJustification(s, c.holder, c.target, 'Disputed claims', JUSTIFY.reasonTurns)
    addLog(s, 'diplomacy', `${nm(s, c.holder)} has built a case against ${nm(s, c.target)}: ${nm(s, c.target)} stands accused of violating agreements.`, [c.holder, c.target])
  }
  s.cases = waiting

  // Neighbors that dislike each other sometimes clash on the border. Whoever's people were hurt gains a reason for war.
  const ids = Object.values(s.nations).filter((n) => n.alive).map((n) => n.id).sort()
  for (const a of ids) {
    const near = nationNeighbors(s, map, a)
    for (const b of [...near].sort()) {
      if (b < a || !s.nations[b]?.alive || atWar(s, a, b) || isAllied(s, a, b) || hasPact(s, a, b)) continue
      if (opinionOf(s, map, a, b, { borders: true, coalition: false }) > -20 && opinionOf(s, map, b, a, { borders: true, coalition: false }) > -20) continue
      if (!rng.chance(JUSTIFY.incidentChance)) continue
      const victim = rng.chance(0.5) ? a : b
      const culprit = victim === a ? b : a
      if (hasCasusBelli(s, victim, culprit)) continue
      grantJustification(s, victim, culprit, 'Border incident', 8)
      addOpinion(s, culprit, victim, 'Border incident', JUSTIFY.incidentOpinion, 0.3)
      addLog(s, 'war', `A border incident between ${nm(s, culprit)} and ${nm(s, victim)}: ${nm(s, victim)} protests.`, [victim, culprit])
    }
  }

  // Reputation fades.
  for (const id of Object.keys(s.infamy)) {
    const v = s.infamy[id] * (1 - JUSTIFY.infamyFade) - JUSTIFY.infamyFadeFlat
    if (v <= 0 || !s.nations[id]?.alive) delete s.infamy[id]
    else s.infamy[id] = v
  }
}
