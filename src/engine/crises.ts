import { nationNeighbors, addOpinion } from '../ai/opinion'
import { AREA_NAMES, areaOf } from '../data/areas'
import { CRISIS, HEADLINES, OUTCOMES, type CrisisAction } from '../data/crises'
import { JUSTIFY } from '../data/war'
import { declareWar } from './diplomacy'
import { addInfamy, addLog, atWar, grantJustification, hasPact, isAllied, newId, regionsOf } from './helpers'
import type { Rng } from './rng'
import type { Crisis, GameState, NationId, WorldMap } from './types'

const nm = (s: GameState, id: NationId | null) => (id ? s.nations[id]?.name ?? id : '')

const fill = (text: string, s: GameState, c: Crisis) => text.replace('{area}', c.area).replace('{nation}', nm(s, c.nation)).replace('{rival}', nm(s, c.rival))

/** How strained the world is: reputations for aggression, wars, and trouble in the news. 0 to 100. */
export function worldTension(s: GameState): number {
  const all = Object.values(s.nations)
  const alive = Math.max(1, all.filter((n) => n.alive).length)
  const gone = all.length - alive
  const infamy = Object.values(s.infamy).reduce((sum, v) => sum + v, 0)
  // Measured against how many nations are left, so a crowded world is not always tense.
  const raw = (infamy / alive) * 10 + (s.wars.length / alive) * 50 + s.crises.length * 5 + (gone / Math.max(1, all.length)) * 20
  return Math.round(Math.max(0, Math.min(100, raw)))
}

/** What answering a crisis costs. */
export function crisisCost(action: CrisisAction): { capital: number; pp: number } {
  if (action === 'aid') return { capital: CRISIS.aidMoney, pp: CRISIS.aidInfluence }
  if (action === 'mediate') return { capital: 0, pp: CRISIS.mediateInfluence }
  return { capital: 0, pp: CRISIS.supportInfluence }
}

/** Why a nation cannot answer a crisis this way, or null. */
export function validateCrisisAction(s: GameState, nationId: NationId, crisisId: string, action: CrisisAction): string | null {
  const c = s.crises.find((x) => x.id === crisisId)
  if (!c) return 'That crisis is over'
  if (c.stage < 1) return 'It is only a rumor so far'
  if (c.nation === nationId || c.rival === nationId) return 'You are part of this crisis'
  if (c.answered.includes(nationId)) return 'You have already answered this'
  if (action === 'mediate' && c.kind !== 'dispute') return 'There is nobody to mediate between'
  if (action === 'support' && c.kind !== 'dispute') return 'Only a dispute has sides'
  if (action === 'support' && c.rival && (isAllied(s, nationId, c.rival) || hasPact(s, nationId, c.rival))) return `You are bound by treaty to ${nm(s, c.rival)}`
  return null
}

/** A nation answers a crisis. The effects are a mix of help, opinion, and a reason for war. */
export function answerCrisis(s: GameState, nationId: NationId, crisisId: string, action: CrisisAction) {
  const c = s.crises.find((x) => x.id === crisisId)
  if (!c) return
  c.answered.push(nationId)
  const me = nm(s, nationId)
  if (action === 'aid') {
    c.boil = Math.max(0, c.boil - CRISIS.aidRelief)
    addOpinion(s, c.nation, nationId, 'Sent aid in our crisis', 15, 0.2)
    addLog(s, 'diplomacy', `${me} sent aid to ${nm(s, c.nation)}.`, [nationId, c.nation])
  } else if (action === 'mediate') {
    c.boil = Math.max(0, c.boil - CRISIS.mediateRelief)
    for (const side of [c.nation, c.rival]) if (side) addOpinion(s, side, nationId, 'Mediated our dispute', 8, 0.2)
    addLog(s, 'diplomacy', `${me} is mediating between ${nm(s, c.nation)} and ${nm(s, c.rival)}.`, [nationId, c.nation])
  } else {
    // Standing with the victim: it earns a reason to fight the aggressor, and the aggressor's resentment, and unease elsewhere.
    c.boil = Math.max(0, c.boil - CRISIS.supportRelief)
    if (c.rival) {
      grantJustification(s, nationId, c.rival, `Stands with ${nm(s, c.nation)}`, JUSTIFY.reasonTurns)
      addOpinion(s, c.rival, nationId, 'Meddled in our dispute', -12, 0.2)
    }
    addOpinion(s, c.nation, nationId, 'Stood by us', 20, 0.2)
    addInfamy(s, nationId, 3)
    addLog(s, 'diplomacy', `${me} stands with ${nm(s, c.nation)}.`, [nationId, c.nation])
  }
}

function spawn(s: GameState, map: WorldMap, rng: Rng): Crisis | null {
  const alive = Object.values(s.nations).filter((n) => n.alive).sort((a, b) => (a.id < b.id ? -1 : 1))
  if (alive.length < 4) return null
  const taken = new Set(s.crises.flatMap((c) => [c.nation, c.rival ?? '']))
  const free = alive.filter((n) => !taken.has(n.id) && !s.humans.includes(n.id))
  if (free.length === 0) return null
  const place = (id: NationId) => {
    const r = map.regions[s.nations[id].capital]
    return AREA_NAMES[areaOf(r?.lat ?? 0, r?.lng ?? 0)]
  }
  if (rng.chance(0.5)) {
    // Unrest hits the least stable nations.
    const weights = free.map((n) => Math.max(1, 80 - n.stability))
    let roll = rng.next() * weights.reduce((a, b) => a + b, 0)
    let pick = free[0]
    for (let i = 0; i < free.length; i++) {
      roll -= weights[i]
      if (roll <= 0) {
        pick = free[i]
        break
      }
    }
    return { id: newId(s, 'cr'), kind: 'unrest', nation: pick.id, rival: null, area: place(pick.id), stage: 0, next: s.turn + CRISIS.gap + rng.int(0, CRISIS.jitter), boil: CRISIS.escalate, answered: [] }
  }
  // A dispute is between neighbors, one with a grievance against the other.
  const pairs: [NationId, NationId][] = []
  for (const a of free) for (const b of [...nationNeighbors(s, map, a.id)].sort()) if (!taken.has(b) && s.nations[b]?.alive && !s.humans.includes(b) && !atWar(s, a.id, b) && !isAllied(s, a.id, b) && !hasPact(s, a.id, b)) pairs.push([a.id, b])
  if (pairs.length === 0) return null
  const [rival, victim] = pairs[rng.int(0, pairs.length - 1)]
  return { id: newId(s, 'cr'), kind: 'dispute', nation: victim, rival, area: place(victim), stage: 0, next: s.turn + CRISIS.gap + rng.int(0, CRISIS.jitter), boil: CRISIS.escalate, answered: [] }
}

/** The month's news: new trouble starts as a rumor, grows in steps, and then calms or boils over. */
export function runCrises(s: GameState, map: WorldMap, rng: Rng) {
  const keep: Crisis[] = []
  for (const c of s.crises) {
    const gone = !s.nations[c.nation]?.alive || (c.rival !== null && !s.nations[c.rival]?.alive) || (c.kind === 'dispute' && c.rival !== null && atWar(s, c.nation, c.rival))
    if (gone) continue
    if (s.turn < c.next) {
      keep.push(c)
      continue
    }
    if (c.stage < 2) {
      c.stage++
      c.next = s.turn + CRISIS.gap + rng.int(0, CRISIS.jitter)
      addLog(s, 'news', fill(HEADLINES[c.kind][c.stage], s, c), [c.nation, ...(c.rival ? [c.rival] : [])])
      keep.push(c)
      continue
    }
    // The end. The more people helped, the likelier it calms.
    const boils = rng.chance(c.boil)
    const involved = [c.nation, ...(c.rival ? [c.rival] : []), ...c.answered]
    if (c.kind === 'unrest') {
      if (boils) {
        const nation = s.nations[c.nation]
        nation.stability = Math.max(0, nation.stability - 25)
        const lands = regionsOf(s, c.nation).filter((r) => r !== nation.capital)
        const hit = lands.length ? lands[rng.int(0, lands.length - 1)] : nation.capital
        s.regions[hit].rebels = Math.max(s.regions[hit].rebels, 2.5)
        addLog(s, 'news', fill(OUTCOMES.unrestBoils, s, c), involved)
      } else addLog(s, 'news', fill(OUTCOMES.unrestCalm, s, c), involved)
    } else if (c.rival) {
      if (boils && !atWar(s, c.rival, c.nation)) {
        addLog(s, 'news', fill(OUTCOMES.disputeBoils, s, c), involved)
        declareWar(s, map, c.rival, c.nation, rng)
      } else addLog(s, 'news', fill(OUTCOMES.disputeCalm, s, c), involved)
    }
  }
  s.crises = keep
  if (s.crises.length < CRISIS.max && rng.chance(CRISIS.spawn + worldTension(s) / 600)) {
    const c = spawn(s, map, rng)
    if (c) {
      s.crises.push(c)
      addLog(s, 'news', fill(HEADLINES[c.kind][0], s, c), [c.nation, ...(c.rival ? [c.rival] : [])])
    }
  }
}
