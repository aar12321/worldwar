import { evaluateProposal } from '../ai/diplomat'
import { addOpinion, decayOpinions } from '../ai/opinion'
import { ARMS, PROPOSAL_LABELS, UNIT_SPECS } from '../data/unitTypes'
import { breakArmsBetween, grantArmsContract, validateArmsTerms } from './arms'
import { addLog, alliesOf, atWar, hasPact, isAllied, newId, pairKey } from './helpers'
import type { Rng } from './rng'
import { bundleEmpty, bundleValue, describeBundle, marketPrices, shortfall, transferBundle, validateTradeTerms } from './trade'
import type { Deal, Dispatch, GameState, NationId, Proposal, ProposalDraft, WorldMap } from './types'
import { clearWarScore, REPARATION_MONTHS, validatePeaceTerms } from './warscore'
import { transferRegion } from './warfare'

export const TRUCE_TURNS = 12
export const PACT_TURNS = 24
/** Months the player has to answer a proposal (the turn it arrives plus two more). */
export const PROPOSAL_TURNS = 3

/** Rejections and lapsed offers between two bots are not news; everything involving the player is. */
function pushDispatch(s: GameState, d: Dispatch) {
  const involvesPlayer = d.from === s.playerId || d.to === s.playerId
  if (!involvesPlayer && (d.kind === 'rejected' || d.kind === 'expired')) return
  s.dispatches.push(d)
  addLog(s, 'diplomacy', d.text, [d.from, d.to])
}

const name = (s: GameState, id: NationId) => s.nations[id]?.name ?? id

export function declareWar(s: GameState, map: WorldMap, a: NationId, b: NationId, rng: Rng, callAllies = true) {
  const key = pairKey(a, b)
  if (s.wars.includes(key)) return
  s.wars.push(key)
  s.wars.sort()
  s.warStarted[key] = s.turn
  clearWarScore(s, a, b)
  delete s.casusBelli[`${a}|${b}`]
  delete s.pacts[key]
  breakArmsBetween(s, a, b)
  s.nations[b].warWeariness = Math.max(0, s.nations[b].warWeariness - 5)
  s.proposals = s.proposals.filter((p) => !((p.from === a && p.to === b) || (p.from === b && p.to === a)) || p.kind === 'peace')
  addOpinion(s, b, a, 'Declared war on us', -40, 0.4)
  addLog(s, 'war', `${name(s, a)} has declared war on ${name(s, b)}!`, [a, b])
  if (!callAllies) return
  for (const ally of alliesOf(s, b).sort()) {
    const n = s.nations[ally]
    if (!n?.alive || ally === a || atWar(s, ally, a) || isAllied(s, ally, a)) continue
    addOpinion(s, ally, a, 'Attacked our ally', -15, 0.4)
    if (hasPact(s, ally, a)) {
      addLog(s, 'diplomacy', `${n.name} is bound by a pact with ${name(s, a)} and cannot defend ${name(s, b)}.`, [ally, a, b])
      continue
    }
    const call: Proposal = { kind: 'callToArms', enemy: a, id: newId(s, 'p'), from: b, to: ally, created: s.turn, expires: s.turn + PROPOSAL_TURNS }
    if (n.isPlayer) {
      s.proposals.push(call)
      pushDispatch(s, { kind: 'proposal', from: b, to: ally, proposalKind: 'callToArms', text: `${name(s, b)} invokes your alliance: join the war against ${name(s, a)}!` })
      continue
    }
    const v = evaluateProposal(s, map, ally, call, rng)
    if (v.accept) {
      declareWar(s, map, ally, a, rng, false)
      addOpinion(s, b, ally, 'Answered our call to arms', 20, 0.3)
      pushDispatch(s, { kind: 'joined', from: ally, to: b, proposalKind: 'callToArms', text: `${n.name} honors its alliance and joins ${name(s, b)} against ${name(s, a)}.` })
    } else {
      addOpinion(s, b, ally, 'Ignored our call to arms', -25, 0.5)
      pushDispatch(s, { kind: 'ignored', from: ally, to: b, proposalKind: 'callToArms', text: `${n.name} ignored ${name(s, b)}'s call to arms: ${v.reason}.` })
    }
  }
}

function makePeace(s: GameState, a: NationId, b: NationId) {
  const key = pairKey(a, b)
  s.wars = s.wars.filter((k) => k !== key)
  delete s.warStarted[key]
  clearWarScore(s, a, b)
  s.pacts[key] = s.turn + TRUCE_TURNS
  s.proposals = s.proposals.filter((p) => !(p.kind === 'peace' && ((p.from === a && p.to === b) || (p.from === b && p.to === a))))
  for (const id of [a, b]) s.nations[id].warWeariness = Math.max(0, s.nations[id].warWeariness - 10)
  addLog(s, 'diplomacy', `${name(s, a)} and ${name(s, b)} have signed a peace treaty (truce for ${TRUCE_TURNS} months).`, [a, b])
}

/** Why `from` cannot make this proposal to `to` right now, or null. Once accepted, peace terms no longer need war score to back them. */
export function validateProposal(s: GameState, map: WorldMap, from: NationId, to: NationId, d: ProposalDraft, accepted = false): string | null {
  const t = s.nations[to]
  if (!t?.alive || to === from) return 'Invalid target'
  switch (d.kind) {
    case 'peace':
      if (!atWar(s, from, to)) return 'Not at war'
      return validatePeaceTerms(s, map, d.terms, from, to, !accepted)
    case 'pact':
      if (atWar(s, from, to)) return 'Make peace first'
      if (isAllied(s, from, to)) return 'Already allied'
      if (hasPact(s, from, to)) return 'Pact already in force'
      return null
    case 'alliance':
      if (atWar(s, from, to)) return 'Make peace first'
      if (isAllied(s, from, to)) return 'Already allied'
      return null
    case 'trade':
      if (atWar(s, from, to)) return 'Cannot trade with an enemy'
      return validateTradeTerms(s, d.terms, from, to)
    case 'arms':
      return validateArmsTerms(s, from, to, d.terms)
    case 'callToArms': {
      const enemy = s.nations[d.enemy]
      if (!isAllied(s, from, to)) return 'Only allies can be called to arms'
      if (!enemy?.alive || !atWar(s, from, d.enemy)) return 'Not at war with that nation'
      if (atWar(s, to, d.enemy)) return 'Already fighting them'
      if (hasPact(s, to, d.enemy) || isAllied(s, to, d.enemy)) return `${t.name} has a treaty with ${enemy.name}`
      return null
    }
  }
}

export function describeProposal(s: GameState, map: WorldMap, p: Proposal | (ProposalDraft & { from: NationId; to: NationId })): string {
  switch (p.kind) {
    case 'peace': {
      const parts: string[] = []
      const toProposer = p.terms.cede.filter((id) => s.regions[id]?.owner === p.to).map((id) => map.regions[id].name)
      const toTarget = p.terms.cede.filter((id) => s.regions[id]?.owner === p.from).map((id) => map.regions[id].name)
      if (toProposer.length) parts.push(`${name(s, p.to)} cedes ${toProposer.join(', ')}`)
      if (toTarget.length) parts.push(`${name(s, p.from)} cedes ${toTarget.join(', ')}`)
      if (p.terms.reparations > 0) parts.push(`${name(s, p.to)} pays ${p.terms.reparations} Capital/month for ${REPARATION_MONTHS} months`)
      if (p.terms.reparations < 0) parts.push(`${name(s, p.from)} pays ${-p.terms.reparations} Capital/month for ${REPARATION_MONTHS} months`)
      return parts.length ? parts.join('; ') : 'White peace: no territory or payments change hands'
    }
    case 'pact':
      return `Neither side may declare war for ${PACT_TURNS} months`
    case 'alliance':
      return 'Each side is called to arms when the other is attacked, and both share military intelligence'
    case 'trade': {
      const { give, receive, months } = p.terms
      const span = months > 0 ? ` every month for ${months} months` : ''
      if (bundleEmpty(receive)) return `${name(s, p.from)} offers ${describeBundle(give)}${span} as a gift`
      if (bundleEmpty(give)) return `${name(s, p.from)} demands ${describeBundle(receive)}${span}`
      return `${name(s, p.from)} gives ${describeBundle(give)} for ${describeBundle(receive)}${span}`
    }
    case 'callToArms':
      return `Declare war on ${name(s, p.enemy)} at ${name(s, p.from)}'s side`
    case 'arms': {
      const buyer = p.terms.seller === p.from ? p.to : p.from
      const bonus = Math.round(p.terms.tier * ARMS.attackPerTier * 100)
      return `${name(s, p.terms.seller)} supplies ${UNIT_SPECS[p.terms.unit].name} (tier ${p.terms.tier}, +${bonus}% attack) to ${name(s, buyer)} for ${p.terms.payPerMonth} Capital a month, for ${p.terms.months} months`
    }
  }
}

function startDeal(s: GameState, deal: Omit<Deal, 'id'>) {
  s.deals.push({ ...deal, id: newId(s, 'd') })
}

/** Carries out an accepted proposal. Returns why it could not be honoured, or null. */
function applyProposal(s: GameState, map: WorldMap, p: Proposal, rng: Rng): string | null {
  const err = validateProposal(s, map, p.from, p.to, p, true)
  if (err) return err
  switch (p.kind) {
    case 'peace': {
      makePeace(s, p.from, p.to)
      for (const id of p.terms.cede) {
        const owner = s.regions[id].owner
        const receiver = owner === p.to ? p.from : p.to
        if (s.nations[owner].capital !== id) transferRegion(s, map, id, receiver, false)
      }
      if (p.terms.reparations !== 0) {
        const payer = p.terms.reparations > 0 ? p.to : p.from
        const payee = payer === p.to ? p.from : p.to
        startDeal(s, { kind: 'reparations', from: payer, to: payee, give: { capital: Math.abs(p.terms.reparations) }, receive: {}, until: s.turn + REPARATION_MONTHS - 1 })
      }
      return null
    }
    case 'pact':
      s.pacts[pairKey(p.from, p.to)] = s.turn + PACT_TURNS
      return null
    case 'alliance':
      s.alliances.push(pairKey(p.from, p.to))
      s.alliances.sort()
      return null
    case 'trade': {
      const { give, receive, months } = p.terms
      if (bundleEmpty(receive)) {
        const value = bundleValue(give, marketPrices(s)) * Math.max(1, months)
        addOpinion(s, p.to, p.from, 'Generous gifts', Math.min(30, 4 + value / 6), 0.5)
      } else {
        addOpinion(s, p.to, p.from, 'Fair dealing', 4, 0.25)
        addOpinion(s, p.from, p.to, 'Fair dealing', 4, 0.25)
      }
      if (months === 0) {
        transferBundle(s, p.from, p.to, give)
        transferBundle(s, p.to, p.from, receive)
      } else {
        startDeal(s, { kind: 'trade', from: p.from, to: p.to, give, receive, until: s.turn + months - 1 })
      }
      return null
    }
    case 'callToArms':
      declareWar(s, map, p.to, p.enemy, rng, false)
      addOpinion(s, p.from, p.to, 'Answered our call to arms', 20, 0.3)
      return null
    case 'arms': {
      const buyer = p.terms.seller === p.from ? p.to : p.from
      grantArmsContract(s, buyer, { unit: p.terms.unit, tier: p.terms.tier, supplier: p.terms.seller, payPerMonth: p.terms.payPerMonth, months: p.terms.months })
      addOpinion(s, p.terms.seller, buyer, 'Bought our weapons', 4, 0.25)
      return null
    }
  }
}

function settle(s: GameState, map: WorldMap, p: Proposal, accept: boolean, reason: string, rng: Rng) {
  const label = PROPOSAL_LABELS[p.kind].toLowerCase()
  const why = reason ? `: ${reason}` : ''
  if (accept) {
    const err = applyProposal(s, map, p, rng)
    if (err) {
      pushDispatch(s, { kind: 'rejected', from: p.to, to: p.from, proposalKind: p.kind, text: `The ${label} between ${name(s, p.from)} and ${name(s, p.to)} fell through (${err}).` })
      return
    }
    const text =
      p.kind === 'callToArms'
        ? `${name(s, p.to)} answered ${name(s, p.from)}'s call to arms against ${name(s, p.enemy)}${why}.`
        : `${name(s, p.to)} accepted ${name(s, p.from)}'s ${label}${why}.`
    pushDispatch(s, { kind: 'accepted', from: p.to, to: p.from, proposalKind: p.kind, text })
    return
  }
  if (p.kind === 'callToArms') addOpinion(s, p.from, p.to, 'Ignored our call to arms', -25, 0.5)
  else if (p.kind === 'alliance') addOpinion(s, p.from, p.to, 'Spurned our alliance', -6, 0.5)
  else addOpinion(s, p.from, p.to, 'Rebuffed our offer', -3, 0.5)
  pushDispatch(s, { kind: 'rejected', from: p.to, to: p.from, proposalKind: p.kind, text: `${name(s, p.to)} rejected ${name(s, p.from)}'s ${label}${why}.` })
}

/** Sends a proposal. Bots answer at once; the player gets it in their inbox. */
export function propose(s: GameState, map: WorldMap, from: NationId, to: NationId, draft: ProposalDraft, rng: Rng) {
  const p = { ...draft, id: newId(s, 'p'), from, to, created: s.turn, expires: s.turn + PROPOSAL_TURNS } as Proposal
  s.proposalMemory[`${from}>${to}:${draft.kind}`] = s.turn
  if (s.nations[to].isPlayer) {
    s.proposals.push(p)
    pushDispatch(s, { kind: 'proposal', from, to, proposalKind: p.kind, text: `${name(s, from)} proposes a ${PROPOSAL_LABELS[p.kind].toLowerCase()}: ${describeProposal(s, map, p)}.` })
    return
  }
  const v = evaluateProposal(s, map, to, p, rng)
  settle(s, map, p, v.accept, v.reason, rng)
}

export function respond(s: GameState, map: WorldMap, nationId: NationId, proposalId: string, accept: boolean, rng: Rng) {
  const p = s.proposals.find((x) => x.id === proposalId && x.to === nationId)
  if (!p) return
  s.proposals = s.proposals.filter((x) => x.id !== proposalId)
  settle(s, map, p, accept, '', rng)
}

export const recentlyProposed = (s: GameState, from: NationId, to: NationId, kind: ProposalDraft['kind'], turns: number) =>
  s.turn - (s.proposalMemory[`${from}>${to}:${kind}`] ?? -999) < turns

export function cancelDeal(s: GameState, nationId: NationId, dealId: string) {
  const d = s.deals.find((x) => x.id === dealId)
  if (!d) return
  s.deals = s.deals.filter((x) => x.id !== dealId)
  const partner = d.from === nationId ? d.to : d.from
  if (d.kind === 'reparations') {
    addOpinion(s, partner, nationId, 'Forgave our debts', 15, 0.3)
    pushDispatch(s, { kind: 'completed', from: nationId, to: partner, proposalKind: 'deal', text: `${name(s, nationId)} forgave ${name(s, partner)}'s war reparations.` })
    return
  }
  addOpinion(s, partner, nationId, 'Broke a trade deal', -35, 0.4)
  pushDispatch(s, { kind: 'broken', from: nationId, to: partner, proposalKind: 'deal', text: `${name(s, nationId)} tore up its trade deal with ${name(s, partner)}.` })
}

export function leaveAlliance(s: GameState, a: NationId, b: NationId) {
  s.alliances = s.alliances.filter((k) => k !== pairKey(a, b))
  addOpinion(s, b, a, 'Abandoned our alliance', -30, 0.4)
  pushDispatch(s, { kind: 'broken', from: a, to: b, proposalKind: 'alliance', text: `${name(s, a)} has walked out of its alliance with ${name(s, b)}.` })
}

/** Monthly payments for trade deals and reparations. A side that cannot pay breaks the deal. */
export function applyDeals(s: GameState) {
  const kept: Deal[] = []
  for (const d of [...s.deals].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const from = s.nations[d.from]
    const to = s.nations[d.to]
    if (!from?.alive || !to?.alive) continue
    const defaulter = shortfall(from, d.give) ? d.from : shortfall(to, d.receive) ? d.to : null
    if (defaulter) {
      const victim = defaulter === d.from ? d.to : d.from
      addOpinion(s, victim, defaulter, 'Defaulted on a deal', -30, 0.4)
      pushDispatch(s, { kind: 'broken', from: defaulter, to: victim, proposalKind: 'deal', text: `${name(s, defaulter)} could not pay and defaulted on its ${d.kind === 'reparations' ? 'reparations' : 'trade deal'} with ${name(s, victim)}.` })
      continue
    }
    transferBundle(s, d.from, d.to, d.give)
    transferBundle(s, d.to, d.from, d.receive)
    if (s.turn >= d.until) {
      if (d.kind === 'trade') {
        addOpinion(s, d.from, d.to, 'Honored our deal', 10, 0.3)
        addOpinion(s, d.to, d.from, 'Honored our deal', 10, 0.3)
      }
      pushDispatch(s, { kind: 'completed', from: d.from, to: d.to, proposalKind: 'deal', text: `The ${d.kind === 'reparations' ? 'reparations' : 'trade deal'} between ${from.name} and ${to.name} has been fulfilled.` })
      continue
    }
    kept.push(d)
  }
  s.deals = kept
}

function stillRelevant(s: GameState, p: Proposal): boolean {
  if (!s.nations[p.from]?.alive || !s.nations[p.to]?.alive) return false
  switch (p.kind) {
    case 'peace':
      return atWar(s, p.from, p.to)
    case 'callToArms':
      return atWar(s, p.from, p.enemy) && !atWar(s, p.to, p.enemy) && isAllied(s, p.from, p.to)
    case 'alliance':
      return !isAllied(s, p.from, p.to) && !atWar(s, p.from, p.to)
    case 'pact':
      return !hasPact(s, p.from, p.to) && !atWar(s, p.from, p.to)
    case 'trade':
      return !atWar(s, p.from, p.to)
    case 'arms':
      return !atWar(s, p.from, p.to) && !!s.nations[p.terms.seller]?.alive
  }
}

export function expireDiplomacy(s: GameState) {
  for (const [k, until] of Object.entries(s.pacts)) if (until < s.turn) delete s.pacts[k]
  for (const [k, until] of Object.entries(s.casusBelli)) if (until < s.turn) delete s.casusBelli[k]
  const kept: Proposal[] = []
  for (const p of s.proposals) {
    if (!stillRelevant(s, p)) continue
    if (p.expires >= s.turn) {
      kept.push(p)
      continue
    }
    if (p.kind === 'callToArms') {
      addOpinion(s, p.from, p.to, 'Ignored our call to arms', -25, 0.5)
      pushDispatch(s, { kind: 'expired', from: p.to, to: p.from, proposalKind: p.kind, text: `${name(s, p.to)} never answered ${name(s, p.from)}'s call to arms.` })
    } else {
      addOpinion(s, p.from, p.to, 'Ignored our offer', -3, 0.5)
    }
  }
  s.proposals = kept
  for (const [k, turn] of Object.entries(s.proposalMemory)) if (s.turn - turn > 24) delete s.proposalMemory[k]
  decayOpinions(s)
}
