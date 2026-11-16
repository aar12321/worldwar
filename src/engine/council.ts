import { opinionOf } from '../ai/opinion'
import { COUNCIL, RESOLUTIONS } from '../data/empire'
import { tierOf } from './empire'
import { addInfamy, addLog, alliesOf, atWar, enemiesOf, pairKey } from './helpers'
import type { GameState, NationId, ResolutionKind, WorldMap } from './types'

export interface Vote {
  nation: NationId
  weight: number
  vote: 'yes' | 'no' | 'abstain'
}

export interface VoteResult {
  votes: Vote[]
  yes: number
  no: number
  total: number
  /** Share of the whole vote needed to pass. */
  needed: number
  passes: boolean
}

/** Every nation's weight in the Council: its income. Puppets vote with their master; the target votes against. */
export function projectedVote(s: GameState, map: WorldMap, proposer: NationId, kind: ResolutionKind, target?: NationId, target2?: NationId, gross?: Map<NationId, number>): VoteResult {
  const votes: Vote[] = []
  let yes = 0
  let no = 0
  let total = 0
  for (const n of Object.values(s.nations).filter((x) => x.alive).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const weight = Math.max(1, gross?.get(n.id) ?? 1)
    total += weight
    let vote: Vote['vote']
    if (n.id === proposer || n.overlord === proposer || n.territoryOf === proposer || alliesOf(s, proposer).includes(n.id)) vote = 'yes'
    else if (n.id === target || n.id === target2 || (target && (n.overlord === target || n.territoryOf === target))) vote = 'no'
    else {
      const op = opinionOf(s, map, n.id, proposer, { coalition: false })
      let lean = op
      if (kind === 'sanctions' && target) lean = op * 0.5 - opinionOf(s, map, n.id, target, { coalition: false }) * 0.8 + (atWar(s, n.id, target) ? 40 : 0)
      if (kind === 'ceasefire') lean = op * 0.5 + 8 + (target && atWar(s, n.id, target) ? -30 : 0) + (target2 && atWar(s, n.id, target2) ? -30 : 0)
      if (kind === 'recognition') lean = op - (s.infamy[proposer] ?? 0) * 0.3
      if (kind === 'accord') lean = op + 12 - enemiesOf(s, n.id).length * 5
      vote = lean >= COUNCIL.yesOpinion ? 'yes' : lean <= COUNCIL.noOpinion ? 'no' : 'abstain'
    }
    if (vote === 'yes') yes += weight
    if (vote === 'no') no += weight
    votes.push({ nation: n.id, weight, vote })
  }
  const needed = tierOf(s.nations[proposer]).council || 2 / 3
  return { votes, yes, no, total, needed, passes: total > 0 && yes / total > needed }
}

/** Why a nation cannot put this resolution to the Council, or null. */
export function resolutionProblem(s: GameState, proposer: NationId, kind: ResolutionKind, target?: NationId, target2?: NationId): string | null {
  const n = s.nations[proposer]
  const spec = RESOLUTIONS[kind]
  if (!spec) return 'Unknown resolution'
  if (!tierOf(n).council) return 'Only a Superpower (25 countries) can put resolutions to the World Council'
  if (s.turn - (n.lastResolution ?? -99) < COUNCIL.cooldown) return `You can put another resolution in ${COUNCIL.cooldown - (s.turn - (n.lastResolution ?? -99))} months`
  if (spec.needsTarget && (!target || !s.nations[target]?.alive || target === proposer)) return 'Choose a nation'
  if (spec.needsSecond && (!target2 || !s.nations[target2]?.alive || target2 === proposer || target2 === target)) return 'Choose the second nation'
  if (kind === 'ceasefire' && target && target2 && !atWar(s, target, target2)) return 'They are not at war with each other'
  if (kind === 'recognition' && (s.infamy[proposer] ?? 0) < 1) return 'Your reputation is already clean'
  return null
}

/** Puts a resolution to the vote and carries it out if it passes. */
export function runResolution(s: GameState, map: WorldMap, proposer: NationId, kind: ResolutionKind, target: NationId | undefined, target2: NationId | undefined, gross?: Map<NationId, number>) {
  const n = s.nations[proposer]
  n.lastResolution = s.turn
  const result = projectedVote(s, map, proposer, kind, target, target2, gross)
  const name = (id?: NationId) => (id ? (s.nations[id]?.name ?? id) : '')
  const pct = Math.round((result.yes / Math.max(1, result.total)) * 100)
  if (!result.passes) {
    addLog(s, 'diplomacy', `The World Council rejected ${n.name}'s ${RESOLUTIONS[kind].name.toLowerCase()} (${pct}% in favor, ${Math.round(result.needed * 100)}% needed).`, [proposer])
    return result
  }
  const yesVoters = result.votes.filter((v) => v.vote === 'yes').map((v) => v.nation)
  switch (kind) {
    case 'sanctions':
      for (const id of yesVoters) {
        if (id === target || s.sanctions.some((x) => x.from === id && x.to === target && x.until >= s.turn)) continue
        s.sanctions.push({ from: id, to: target!, until: s.turn + COUNCIL.sanctionsMonths })
      }
      break
    case 'ceasefire': {
      const key = pairKey(target!, target2!)
      s.wars = s.wars.filter((k) => k !== key)
      delete s.warStarted[key]
      s.pacts[key] = s.turn + 12
      break
    }
    case 'recognition':
      addInfamy(s, proposer, -COUNCIL.recognitionInfamy)
      break
    case 'accord':
      s.accord = { until: s.turn + COUNCIL.accordMonths, members: yesVoters }
      break
  }
  addLog(s, 'diplomacy', `The World Council passed ${n.name}'s ${RESOLUTIONS[kind].name.toLowerCase()}${target ? ` on ${name(target)}${target2 ? ` and ${name(target2)}` : ''}` : ''} (${pct}% in favor).`, [proposer, ...(target ? [target] : []), ...(target2 ? [target2] : [])])
  return result
}

/** A trade accord member's extra trade. */
export const accordTrade = (s: GameState, id: NationId) => (s.accord && s.accord.until >= s.turn && s.accord.members.includes(id) ? COUNCIL.accordTrade : 0)
