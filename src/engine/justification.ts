import { JUSTIFY } from '../data/war'
import { BORDER, STATION } from '../data/deployment'
import { incidentFactor, borderPressure, pressureBound, recordIncident, sharesLandBorder } from './borders'
import { borderCover, garrisonDivisions, watchesWaters } from './deployment'
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
    if (!s.nations[c.holder]?.alive || !s.nations[c.target]?.alive) continue
    const why = atWar(s, c.holder, c.target) ? 'you are already at war with them' : isAllied(s, c.holder, c.target) ? 'you are now allied' : hasPact(s, c.holder, c.target) ? 'a non-aggression pact is in force' : null
    if (why) {
      // The player hears why a case they paid for was dropped.
      if (s.nations[c.holder].isPlayer) addLog(s, 'diplomacy', `Your case against ${nm(s, c.target)} was dropped: ${why}.`, [c.holder, c.target])
      continue
    }
    if (c.ready > s.turn) {
      waiting.push(c)
      continue
    }
    grantJustification(s, c.holder, c.target, 'Disputed claims', JUSTIFY.reasonTurns)
    addLog(s, 'diplomacy', `${nm(s, c.holder)} has built a case against ${nm(s, c.target)}: ${nm(s, c.target)} stands accused of violating agreements.`, [c.holder, c.target])
  }
  s.cases = waiting

  // Neighbors that dislike each other sometimes clash on the border. Whoever's people were hurt gains a reason for war.
  // Troops massed on a border make a clash likelier; a border guarded well makes it rarer and can turn a provocation back.
  const ids = Object.values(s.nations).filter((n) => n.alive).map((n) => n.id).sort()
  for (const a of ids) {
    const near = nationNeighbors(s, map, a)
    for (const b of [...near].sort()) {
      if (b < a || !s.nations[b]?.alive || atWar(s, a, b) || isAllied(s, a, b) || hasPact(s, a, b)) continue
      const sore = !(opinionOf(s, map, a, b, { borders: true, coalition: false }) > -20 && opinionOf(s, map, b, a, { borders: true, coalition: false }) > -20)
      if (!sore && (pressureBound(s, a, b) < BORDER.pressureEligible || borderPressure(s, map, a, b) < BORDER.pressureEligible)) continue
      if (!rng.chance(JUSTIFY.incidentChance * incidentFactor(s, map, a, b))) continue
      // The side with fewer troops massed against it is likelier to be the one wronged.
      const ga = garrisonDivisions(s, a, b)
      const gb = garrisonDivisions(s, b, a)
      const victim = rng.chance(0.5 + 0.4 * ((gb - ga) / (ga + gb + 1))) ? a : b
      const culprit = victim === a ? b : a
      if (hasCasusBelli(s, victim, culprit)) continue
      const land = sharesLandBorder(s, map, a, b)
      // Across the sea an intruder is only seen by a nation that watches its waters.

      // A garrison that fully guards its border turns a provocation back before it becomes an incident.
      const cover = land ? borderCover(s, map, victim, culprit) : 0
      if (cover > 0 && rng.chance(cover * STATION.provocationStop)) {
        addLog(s, 'war', `${nm(s, victim)}'s border garrison turned back a provocation from ${nm(s, culprit)}.`, [victim, culprit])
        continue
      }
      grantJustification(s, victim, culprit, 'Border incident', 8)
      addOpinion(s, culprit, victim, 'Border incident', JUSTIFY.incidentOpinion, 0.3)
      recordIncident(s, a, b)
      addLog(s, 'war', land || !s.nations[victim].military.deployment ? `A border incident between ${nm(s, culprit)} and ${nm(s, victim)}: ${nm(s, victim)} protests.` : `A naval incident between ${nm(s, culprit)} and ${nm(s, victim)}: a foreign vessel was found in ${nm(s, victim)}'s waters.`, [victim, culprit])
    }
  }

  // Reputation fades.
  for (const id of Object.keys(s.infamy)) {
    const v = s.infamy[id] * (1 - JUSTIFY.infamyFade) - JUSTIFY.infamyFadeFlat
    if (v <= 0 || !s.nations[id]?.alive) delete s.infamy[id]
    else s.infamy[id] = v
  }
}
