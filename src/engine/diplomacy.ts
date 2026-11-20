import { evaluateProposal } from '../ai/diplomat'
import { addOpinion, addOpinionCapped, decayOpinions } from '../ai/opinion'
import { DEALINGS, TIES } from '../data/relations'
import { MW } from '../data/missileWar'
import { applyTruce, trucePair } from './missileWar'
import { LIBERATE_TEXT, PUPPET } from '../data/puppets'
import { DIPLOMACY, PROPOSAL_LABELS } from '../data/unitTypes'
import { EMPIRE, JUSTIFY, WAR } from '../data/war'
import { addInfamy, addLog, alliesOf, atWar, enemiesOf, grantJustification, guarantorsOf, hasCasusBelli, hasPact, isAllied, justificationOf, maxWars, newId, pairKey, puppetsOf, territoriesOf } from './helpers'
import type { Rng } from './rng'
import { bundleEmpty, bundleValue, describeBundle, marketPrices, shortfall, transferBundle, validateTradeTerms } from './trade'
import type { Deal, Dispatch, GameState, NationId, Proposal, ProposalDraft, WorldMap } from './types'
import { clearWarScore, REPARATION_MONTHS, validatePeaceTerms } from './warscore'
import { transferRegion } from './warfare'
import { tierOf } from './empire'
import { bindPuppet, clearPuppetFields, freePuppet, puppetJoinsWar, willFollow } from './puppets'
import { TERRITORY, TERRITORY_TEXT } from '../data/territories'
import { bindTerritory, territoryJoinsWar } from './territories'

export const TRUCE_TURNS = 12
export const PACT_TURNS = 24
/** Months the player has to answer a proposal (the turn it arrives plus two more). */
export const PROPOSAL_TURNS = 3

/** Rejections and lapsed offers between two bots are not news; everything involving the player is. */
function pushDispatch(s: GameState, d: Dispatch) {
  const involvesPlayer = s.humans.includes(d.from) || s.humans.includes(d.to)
  if (!involvesPlayer && (d.kind === 'rejected' || d.kind === 'expired')) return
  s.dispatches.push(d)
  addLog(s, 'diplomacy', d.text, [d.from, d.to])
}

const name = (s: GameState, id: NationId) => s.nations[id]?.name ?? id

const dealLabel = (kind: Deal['kind']) => (kind === 'reparations' ? 'reparations' : kind === 'loan' ? 'loan' : 'trade deal')

/** What a borrower pays each month on a loan, with interest. */
export const loanPayment = (amount: number, months: number) => (amount * (1 + DIPLOMACY.loan.interest * months)) / months

/** Imposes trade sanctions: the target loses part of its market access and its port trade for a year. */
export function imposeSanctions(s: GameState, from: NationId, to: NationId) {
  s.sanctions.push({ from, to, until: s.turn + DIPLOMACY.sanctions.months })
  grantJustification(s, to, from, 'Sanctioned us', JUSTIFY.reasonTurns)
  addInfamy(s, from, 3)
  addOpinion(s, to, from, 'Imposed sanctions on us', -25, 0.2)
  addLog(s, 'diplomacy', `${name(s, from)} has imposed trade sanctions on ${name(s, to)}.`, [from, to])
}

export function liftSanctions(s: GameState, from: NationId, to: NationId) {
  s.sanctions = s.sanctions.filter((x) => !(x.from === from && x.to === to))
  addOpinion(s, to, from, 'Lifted sanctions', 12, 0.3)
  addLog(s, 'diplomacy', `${name(s, from)} lifted its sanctions on ${name(s, to)}.`, [from, to])
}

/** A master absorbs a puppet that has served long enough. Its land joins the empire at once, half settled. */
export function annexPuppet(s: GameState, map: WorldMap, master: NationId, puppet: NationId) {
  addLog(s, 'diplomacy', `${name(s, master)} has annexed its puppet ${name(s, puppet)}.`, [master, puppet])
  // Its army and treasury join the master's: an annexation is a merger, not a conquest.
  const p = s.nations[puppet]
  const m = s.nations[master]
  for (const k of Object.keys(p.military.units) as (keyof typeof p.military.units)[]) {
    m.military.units[k] += p.military.units[k]
    p.military.units[k] = 0
  }
  // Live mode: its armies in the field and salvos in the air are the master's now, and its planned attacks go with them.
  for (const a of s.armies ?? []) if (a.nationId === puppet) a.nationId = master
  for (const f of s.flights ?? []) if (f.nationId === puppet) f.nationId = master
  for (const l of s.launches ?? []) if (l.order.nationId === puppet) l.order.nationId = master
  m.resources.capital += Math.max(0, p.resources.capital)
  p.resources.capital = Math.min(0, p.resources.capital)
  const loyalty = p.loyalty
  for (const id of Object.keys(s.regions).sort()) {
    if (s.regions[id].owner !== puppet) continue
    transferRegion(s, map, id, master, false)
    // A people that never accepted its master settles slowly under him: loyal land comes in as it was, restive land half as well settled as loyalty allows.
    if (loyalty !== undefined && loyalty < 50) s.regions[id].integration *= Math.max(0.2, loyalty / 50)
  }
  clearPuppetFields(p)
  addInfamy(s, master, EMPIRE.annexInfamy)
}

/** A winner frees a puppet of the loser at the peace table: independent, no tribute, grateful, and at peace with its liberator. */
function liberatePuppet(s: GameState, liberator: NationId, master: NationId, puppet: NationId) {
  freePuppet(s, puppet)
  addOpinion(s, puppet, liberator, LIBERATE_TEXT.opinion, PUPPET.liberate.opinion, 0.1)
  addLog(s, 'diplomacy', LIBERATE_TEXT.log(name(s, liberator), name(s, puppet), name(s, master)), [liberator, puppet, master])
  if (atWar(s, liberator, puppet)) makePeace(s, liberator, puppet)
}

/** A master lets its puppet go. */
export function releasePuppet(s: GameState, master: NationId, puppet: NationId) {
  freePuppet(s, puppet)
  addOpinion(s, puppet, master, 'Set us free', 25, 0.2)
  addLog(s, 'diplomacy', `${name(s, master)} set ${name(s, puppet)} free.`, [master, puppet])
}

/**
 * Why `a` cannot join a war on `b` beside someone (a call to arms, a bloc's call), or null: nobody fights more than MAX_WARS wars at once,
 * and allies who are already stretched stay out. A yes then starts no war.
 */
export function joinWarBlocked(s: GameState, a: NationId, b: NationId): string | null {
  if (enemiesOf(s, a).length >= maxWars(s, a)) return `${name(s, a)} is fighting all the wars it can`
  if (enemiesOf(s, b).length >= maxWars(s, b)) return `${name(s, b)} is fighting all the wars it can, so nobody more can join`
  return null
}

export function declareWar(s: GameState, map: WorldMap, a: NationId, b: NationId, rng: Rng, callAllies = true) {
  const key = pairKey(a, b)
  if (s.wars.includes(key)) return
  if (!callAllies && joinWarBlocked(s, a, b)) return
  // A war with a reason is a legitimate act. A war without one is aggression, and the world remembers it.
  const justified = !callAllies || hasCasusBelli(s, a, b)
  // A war begun under "Free X from Y" is remembered: it gives the right to free X at the peace table.
  if (s.liberationWars) delete s.liberationWars[`${a}>${b}`]
  const cause = justificationOf(s, a, b)
  if (cause) {
    const freed = puppetsOf(s, b).filter((id) => cause.reason === LIBERATE_TEXT.cause(s.nations[id].name, s.nations[b].name))
    if (freed.length) (s.liberationWars ??= {})[`${a}>${b}`] = freed
  }
  s.wars.push(key)
  s.wars.sort()
  s.warStarted[key] = s.turn
  clearWarScore(s, a, b)
  delete s.casusBelli[`${a}|${b}`]
  delete s.reasons[`${a}|${b}`]
  s.cases = s.cases.filter((c) => !(c.holder === a && c.target === b))
  if (callAllies) {
    addInfamy(s, a, justified ? JUSTIFY.infamyWithReason : JUSTIFY.infamyNoReason)
    if (!justified) {
      s.nations[a].stability = Math.max(0, s.nations[a].stability - JUSTIFY.noReasonStability)
      for (const other of Object.keys(s.nations).sort()) {
        if (other === a || other === b || !s.nations[other].alive) continue
        addOpinion(s, other, a, 'Attacked without cause', isAllied(s, other, a) ? -15 : -10, 0.3)
      }
      addLog(s, 'war', `${name(s, a)} attacked ${name(s, b)} with no justification. The world condemns the aggression.`, [a, b])
    }
  }
  delete s.pacts[key]
  s.nations[b].warWeariness = Math.max(0, s.nations[b].warWeariness - 5)
  s.proposals = s.proposals.filter((p) => !((p.from === a && p.to === b) || (p.from === b && p.to === a)) || p.kind === 'peace')
  addOpinion(s, b, a, 'Declared war on us', -40, 0.4)
  addLog(s, 'war', `${name(s, a)} has declared war on ${name(s, b)}!`, [a, b])
  // Puppets fight beside their overlord, on either side, without being asked.
  for (const [side, foe] of [[a, b], [b, a]] as const) {
    for (const puppet of puppetsOf(s, side)) {
      if (puppet === foe || atWar(s, puppet, foe) || !s.nations[puppet]?.alive) continue
      // A puppet that has lost its loyalty will not fight for its master (see puppets.ts).
      if (!willFollow(s.nations[puppet])) {
        addLog(s, 'war', `${name(s, puppet)} refuses to follow ${name(s, side)} into the war against ${name(s, foe)}.`, [puppet, side, foe])
        continue
      }
      puppetJoinsWar(s, puppet, side, foe)
    }
    // Territories fight beside their master without being asked and cannot refuse.
    for (const t of territoriesOf(s, side)) {
      if (t === foe || atWar(s, t, foe) || !s.nations[t]?.alive || s.nations[foe]?.territoryOf === side) continue
      territoryJoinsWar(s, t, side, foe)
    }
  }
  // A war on a territory is a war on its master: it joins, unless a treaty or its own limit on wars stands in the way.
  const lord = s.nations[b]?.territoryOf
  if (lord && lord !== a && s.nations[lord]?.alive && !atWar(s, lord, a) && !isAllied(s, lord, a) && !hasPact(s, lord, a) && s.nations[a]?.territoryOf !== lord) declareWar(s, map, lord, a, rng, false)
  if (!callAllies) return
  for (const ally of [...new Set([...alliesOf(s, b), ...guarantorsOf(s, b)])].sort()) {
    const n = s.nations[ally]
    if (!n?.alive || ally === a || atWar(s, ally, a) || isAllied(s, ally, a)) continue
    addOpinion(s, ally, a, alliesOf(s, b).includes(ally) ? 'Attacked our ally' : 'Attacked a nation we guarantee', -15, 0.4)
    grantJustification(s, ally, a, alliesOf(s, b).includes(ally) ? 'Attacked our ally' : 'Attacked a nation we guarantee', JUSTIFY.reasonTurns)
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

/** One side of a war: the nation, its allies and its puppets. */
const sideOf = (s: GameState, id: NationId): NationId[] => [...new Set([id, ...alliesOf(s, id), ...puppetsOf(s, id), ...territoriesOf(s, id)])].filter((x) => s.nations[x]?.alive)

/** Wars between the two sides, other than the one between `a` and `b` themselves: what a general peace would also end. */
export function generalPeaceTies(s: GameState, a: NationId, b: NationId): [NationId, NationId][] {
  const mine = sideOf(s, a)
  const theirs = sideOf(s, b)
  const out: [NationId, NationId][] = []
  for (const x of mine) for (const y of theirs) {
    if (x === y || (x === a && y === b)) continue
    if (atWar(s, x, y)) out.push([x, y])
  }
  return out
}

function makePeace(s: GameState, a: NationId, b: NationId) {
  const key = pairKey(a, b)
  if (s.liberationWars) {
    delete s.liberationWars[`${a}>${b}`]
    delete s.liberationWars[`${b}>${a}`]
    if (Object.keys(s.liberationWars).length === 0) delete s.liberationWars
  }
  s.wars = s.wars.filter((k) => k !== key)
  delete s.warStarted[key]
  clearWarScore(s, a, b)
  s.pacts[key] = s.turn + TRUCE_TURNS
  s.proposals = s.proposals.filter((p) => !(p.kind === 'peace' && ((p.from === a && p.to === b) || (p.from === b && p.to === a))))
  for (const id of [a, b]) s.nations[id].warWeariness = Math.max(0, s.nations[id].warWeariness - 10)
  addLog(s, 'diplomacy', `${name(s, a)} and ${name(s, b)} have signed a peace treaty (truce for ${TRUCE_TURNS} months).`, [a, b])
  // A territory fights only its master's wars, so the peace ends the ones it fought for them.
  for (const [lord, foe] of [[a, b], [b, a]] as const) for (const t of territoriesOf(s, lord)) if (atWar(s, t, foe) && t !== foe) makePeace(s, t, foe)
}

/** Why `from` cannot make this proposal to `to` right now, or null. Once accepted, peace terms no longer need war score to back them. */
export function validateProposal(s: GameState, map: WorldMap, from: NationId, to: NationId, d: ProposalDraft, accepted = false): string | null {
  const t = s.nations[to]
  if (!t?.alive || to === from) return 'Invalid target'
  switch (d.kind) {
    case 'peace':
      if (!atWar(s, from, to)) return 'Not at war'
      if (t.territoryOf && from !== t.territoryOf) return `${name(s, t.territoryOf)} makes peace for its territory ${t.name}`
      if (d.terms.general && !accepted && generalPeaceTies(s, from, to).length === 0) return 'Nobody else on either side is at war: untick "Include allies on both sides"'
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
    case 'loan': {
      const L = DIPLOMACY.loan
      // A bigger empire can lend more and for longer; from a superpower up, a loan can carry a pact (a World Bank loan).
      const spec = tierOf(s.nations[from])
      if (atWar(s, from, to)) return 'You cannot lend to an enemy'
      if (!Number.isFinite(d.amount) || d.amount < L.min || d.amount > spec.loanMax) return `Loans run from ${L.min} to ${spec.loanMax} money for a ${spec.name}`
      if (!Number.isInteger(d.months) || d.months < L.minMonths || d.months > spec.loanMonths) return `Loans run ${L.minMonths} to ${spec.loanMonths} months for a ${spec.name}`
      if (d.pact && !spec.loanPact) return 'Only a Superpower (25 countries) can attach a pact to a loan'
      if (d.pact && (isAllied(s, from, to) || hasPact(s, from, to))) return 'You already have a pact or an alliance with them'
      if (s.nations[from].resources.capital < d.amount) return 'You do not have that much money to lend'
      return null
    }
    case 'guarantee':
      if (atWar(s, from, to)) return 'You cannot guarantee a nation you are at war with'
      if (isAllied(s, from, to)) return 'Allies already defend each other'
      if ((s.guarantees ?? []).some((g) => g.from === from && g.to === to && g.until >= s.turn)) return 'You already guarantee them'
      return null
    case 'callToArms': {
      const enemy = s.nations[d.enemy]
      if (!isAllied(s, from, to) && !guarantorsOf(s, from).includes(to)) return 'Only allies and guarantors can be called to arms'
      if (!enemy?.alive || !atWar(s, from, d.enemy)) return 'Not at war with that nation'
      if (atWar(s, to, d.enemy)) return 'Already fighting them'
      if (hasPact(s, to, d.enemy) || isAllied(s, to, d.enemy)) return `${t.name} has a treaty with ${enemy.name}`
      return null
    }
    case 'truce':
      if (!DEALINGS.on || !isHumanNation(s, to) || !isHumanNation(s, from)) return 'A missile ceasefire is offered from the Missile War desk'
      if (!atWar(s, from, to)) return 'Not at war'
      if (trucePair(s, from, to) !== null) return 'A ceasefire already holds'
      return null
  }
}

const isHumanNation = (s: GameState, id: NationId) => s.humans.includes(id) || !!s.nations[id]?.isPlayer

/** Whether a `missileTruce` order is an offer to another player (who answers it on their own screen) rather than a rival's answer on the spot. */
export const truceByOffer = (s: GameState, o: { nationId: NationId; target: NationId; lift?: boolean }): boolean =>
  DEALINGS.on && !o.lift && isHumanNation(s, o.target) && isHumanNation(s, o.nationId)

/** What stops a missile ceasefire offer to another player, or null. */
export function truceOfferProblem(s: GameState, map: WorldMap, o: { nationId: NationId; target: NationId }): string | null {
  if (!s.nations[o.target]?.alive || o.target === o.nationId) return 'Unknown nation'
  if (s.proposals.some((p) => p.kind === 'truce' && p.from === o.nationId && p.to === o.target)) return 'Awaiting their answer'
  if (s.proposals.some((p) => p.kind === 'truce' && p.from === o.target && p.to === o.nationId)) return 'They have offered you one: answer it in Diplomacy'
  return validateProposal(s, map, o.nationId, o.target, { kind: 'truce' })
}

export function describeProposal(s: GameState, map: WorldMap, p: Proposal | (ProposalDraft & { from: NationId; to: NationId })): string {
  switch (p.kind) {
    case 'peace': {
      const parts: string[] = []
      const toProposer = p.terms.cede.filter((id) => s.regions[id]?.owner === p.to).map((id) => map.regions[id].name)
      const toTarget = p.terms.cede.filter((id) => s.regions[id]?.owner === p.from).map((id) => map.regions[id].name)
      if (toProposer.length) parts.push(`${name(s, p.to)} cedes ${toProposer.join(', ')}`)
      if (toTarget.length) parts.push(`${name(s, p.from)} cedes ${toTarget.join(', ')}`)
      if (p.terms.reparations > 0) parts.push(`${name(s, p.to)} pays ${p.terms.reparations} money/month for ${REPARATION_MONTHS} months`)
      if (p.terms.reparations < 0) parts.push(`${name(s, p.from)} pays ${-p.terms.reparations} money/month for ${REPARATION_MONTHS} months`)
      if (p.terms.liberate !== undefined && s.nations[p.terms.liberate]) parts.unshift(LIBERATE_TEXT.describe(s.nations[p.terms.liberate].name, name(s, p.to)))
      if (p.terms.territory) parts.unshift(TERRITORY_TEXT.describe(name(s, p.to), name(s, p.from)))
      if (p.terms.puppet) parts.unshift(`${name(s, p.to)} becomes a puppet of ${name(s, p.from)} and pays ${Math.round(DIPLOMACY.puppet.tribute * 100)}% of its income`)
      const base = parts.length ? parts.join('; ') : 'White peace: no territory or payments change hands'
      const ties = p.terms.general ? generalPeaceTies(s, p.from, p.to) : []
      return ties.length ? `${base}; and ${ties.length === 1 ? 'one more war' : `${ties.length} more wars`} between their allies and puppets end too (${ties.map(([x, y]) => `${name(s, x)}–${name(s, y)}`).join(', ')})` : base
    }
    case 'pact':
      return `Neither side may declare war for ${PACT_TURNS} months`
    case 'alliance':
      return 'Each side is called to arms when the other is attacked, and both share military intelligence'
    case 'trade': {
      const { give, receive, months } = p.terms
      const span = months > 0 ? ` every month for ${months} months` : ''
      const live = [p.terms.start ? `starting in ${p.terms.start} month${p.terms.start === 1 ? '' : 's'}` : '', p.terms.collateral ? `${name(s, p.from)} puts up ${Math.round(p.terms.collateral)} money as collateral` : '', p.terms.joinWars ? `${name(s, p.to)} joins every war ${name(s, p.from)} fights` : ''].filter(Boolean)
      const tail = live.length ? `; ${live.join('; ')}` : ''
      if (bundleEmpty(receive) && bundleEmpty(give)) return `${name(s, p.to)} fights beside ${name(s, p.from)} in every war${span}${live.length > 1 ? `; ${live.filter((x) => !x.includes('joins every war')).join('; ')}` : ''}`
      if (bundleEmpty(receive)) return `${name(s, p.from)} offers ${describeBundle(give)}${span} as a gift${tail}`
      if (bundleEmpty(give)) return `${name(s, p.from)} demands ${describeBundle(receive)}${span}${tail}`
      return `${name(s, p.from)} gives ${describeBundle(give)} for ${describeBundle(receive)}${span}${tail}`
    }
    case 'callToArms':
      return `Declare war on ${name(s, p.enemy)} at ${name(s, p.from)}'s side`
    case 'loan': {
      const pay = loanPayment(p.amount, p.months)
      return `${name(s, p.from)} lends ${Math.round(p.amount)} money, repaid at ${pay.toFixed(1)} a month for ${p.months} months${p.pact ? ', with a non-aggression pact for as long' : ''}`
    }
    case 'guarantee':
      return `${name(s, p.from)} promises to defend ${name(s, p.to)} for ${DIPLOMACY.guarantee.months} months`
    case 'truce':
      return `Neither side fires missiles or bombers at the other for ${MW.truceMonths} months; the armies stay at war`
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
      // Read the other wars first: signing the main peace changes who counts as allied and at war.
      const ties = p.terms.general ? generalPeaceTies(s, p.from, p.to) : []
      const liberated = p.terms.liberate
      makePeace(s, p.from, p.to)
      if (liberated !== undefined) liberatePuppet(s, p.from, p.to, liberated)
      for (const [x, y] of ties) if (atWar(s, x, y)) makePeace(s, x, y)
      for (const id of p.terms.cede) {
        const owner = s.regions[id].owner
        const receiver = owner === p.to ? p.from : p.to
        if (s.nations[owner].capital !== id) transferRegion(s, map, id, receiver, false)
      }
      if (p.terms.puppet) {
        bindPuppet(s, p.to, p.from)
        addOpinion(s, p.to, p.from, 'Our overlord', -10, 0.1)
        addLog(s, 'war', `${name(s, p.to)} is now a puppet state of ${name(s, p.from)}.`, [p.from, p.to])
      }
      if (p.terms.territory) {
        bindTerritory(s, p.to, p.from)
        addOpinion(s, p.to, p.from, 'Our master', TERRITORY.madeOpinion, 0.1)
        addLog(s, 'war', TERRITORY_TEXT.log(name(s, p.to), name(s, p.from)), [p.from, p.to])
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
      if (bundleEmpty(receive) && bundleEmpty(give)) {
        // A pledge to fight beside the proposer, with nothing else changing hands.
      } else if (bundleEmpty(receive)) {
        const value = bundleValue(give, marketPrices(s)) * Math.max(1, months)
        // With ties on, gifts stack only to a ceiling: generosity is remembered, but it cannot buy unlimited goodwill.
        if (TIES.on) addOpinionCapped(s, p.to, p.from, 'Generous gifts', Math.min(30, 4 + value / 6), 0.5, TIES.giftCap)
        else addOpinion(s, p.to, p.from, 'Generous gifts', Math.min(30, 4 + value / 6), 0.5)
      } else if (bundleEmpty(give)) {
        // Paying tribute under threat is not friendship.
        addOpinion(s, p.to, p.from, 'Forced us to pay tribute', -20, 0.25)
      } else {
        addOpinion(s, p.to, p.from, 'Fair dealing', 4, 0.25)
        addOpinion(s, p.from, p.to, 'Fair dealing', 4, 0.25)
      }
      if (months === 0) {
        transferBundle(s, p.from, p.to, give)
        transferBundle(s, p.to, p.from, receive)
      } else if (p.terms.start !== undefined || p.terms.collateral !== undefined || p.terms.joinWars) {
        // A live contract: it starts on a later month if asked, and the proposer's collateral is held until it ends.
        const start = s.turn + (p.terms.start ?? 0)
        const held = p.terms.collateral ?? 0
        s.nations[p.from].resources.capital -= held
        startDeal(s, { kind: 'trade', from: p.from, to: p.to, give, receive, until: start + months - 1, contract: { start, held, poster: p.from, ...(p.terms.joinWars ? { joins: p.to } : {}) } })
      } else {
        startDeal(s, { kind: 'trade', from: p.from, to: p.to, give, receive, until: s.turn + months - 1 })
      }
      return null
    }
    case 'callToArms':
      declareWar(s, map, p.to, p.enemy, rng, false)
      addOpinion(s, p.from, p.to, 'Answered our call to arms', 20, 0.3)
      return null
    case 'loan': {
      const lender = s.nations[p.from]
      const borrower = s.nations[p.to]
      lender.resources.capital -= p.amount
      borrower.resources.capital += p.amount
      startDeal(s, { kind: 'loan', from: p.to, to: p.from, give: { capital: loanPayment(p.amount, p.months) }, receive: {}, until: s.turn + p.months - 1 })
      addOpinion(s, p.to, p.from, 'Lent us money', 12, 0.3)
      if (p.pact) {
        s.pacts[pairKey(p.from, p.to)] = Math.max(s.pacts[pairKey(p.from, p.to)] ?? -1, s.turn + p.months)
        addOpinion(s, p.to, p.from, 'A World Bank loan', 20, 0.2)
      }
      return null
    }
    case 'guarantee':
      s.guarantees.push({ from: p.from, to: p.to, until: s.turn + DIPLOMACY.guarantee.months })
      addOpinion(s, p.to, p.from, 'Guaranteed our independence', 25, 0.15)
      return null
    case 'truce':
      applyTruce(s, { type: 'missileTruce', nationId: p.from, target: p.to })
      return null
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

/** A master forces a trade deal on its territory: with its master it is made at once, with anyone else the other side still has to agree. */
export function forceDeal(s: GameState, map: WorldMap, territory: NationId, partner: NationId, terms: import('./types').TradeTerms, rng: Rng) {
  if (partner === s.nations[territory]?.territoryOf) {
    const p: Proposal = { kind: 'trade', terms, id: newId(s, 'p'), from: territory, to: partner, created: s.turn, expires: s.turn + PROPOSAL_TURNS }
    s.proposalMemory[`${territory}>${partner}:trade`] = s.turn
    settle(s, map, p, true, 'its master commands it', rng)
    return
  }
  propose(s, map, territory, partner, { kind: 'trade', terms }, rng)
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
  // A contract's collateral: whoever walks away from a running contract loses it; before it starts it comes back.
  if (d.contract && d.contract.held > 0) {
    const forfeits = d.contract.poster === nationId && s.turn >= d.contract.start
    const to = s.nations[forfeits ? partner : d.contract.poster]
    if (to?.alive) to.resources.capital += d.contract.held
  }
  if (d.kind === 'reparations') {
    addOpinion(s, partner, nationId, 'Forgave our debts', 15, 0.3)
    pushDispatch(s, { kind: 'completed', from: nationId, to: partner, proposalKind: 'deal', text: `${name(s, nationId)} forgave ${name(s, partner)}'s war reparations.` })
    return
  }
  if (d.kind === 'loan' && d.to === nationId) {
    addOpinion(s, partner, nationId, 'Forgave our loan', 18, 0.3)
    pushDispatch(s, { kind: 'completed', from: nationId, to: partner, proposalKind: 'deal', text: `${name(s, nationId)} forgave the rest of ${name(s, partner)}'s loan.` })
    return
  }
  if (d.kind === 'loan') {
    // Walking away from a loan is a default: the lender is wronged, the world takes note, and other lenders charge more.
    addOpinion(s, partner, nationId, 'Defaulted on our loan', -50, 0.3)
    grantJustification(s, partner, nationId, 'Defaulted on our loan', JUSTIFY.reasonTurns)
    addInfamy(s, nationId, DIPLOMACY.loan.defaultInfamy)
    s.nations[nationId].defaultedUntil = Math.max(s.nations[nationId].defaultedUntil ?? 0, s.turn + DIPLOMACY.loan.defaultLockMonths)
    pushDispatch(s, { kind: 'broken', from: nationId, to: partner, proposalKind: 'deal', text: `${name(s, nationId)} stopped paying its loan from ${name(s, partner)}. Nobody will lend to it for a while.` })
    return
  }
  addOpinion(s, partner, nationId, 'Broke a trade deal', -35, 0.4)
  pushDispatch(s, { kind: 'broken', from: nationId, to: partner, proposalKind: 'deal', text: `${name(s, nationId)} tore up its trade deal with ${name(s, partner)}.` })
}

/** Tears up a non-aggression pact. The other side and the world remember it. */
export function breakPact(s: GameState, a: NationId, b: NationId) {
  delete s.pacts[pairKey(a, b)]
  addOpinion(s, b, a, 'Broke our pact', -35, 0.3)
  grantJustification(s, b, a, 'Broke our pact', JUSTIFY.reasonTurns)
  addInfamy(s, a, DIPLOMACY.pactBreakInfamy)
  for (const other of Object.keys(s.nations).sort()) if (other !== a && other !== b && s.nations[other].alive) addOpinion(s, other, a, 'Breaks its word', -4, 0.3)
  pushDispatch(s, { kind: 'broken', from: a, to: b, proposalKind: 'pact', text: `${name(s, a)} tore up its non-aggression pact with ${name(s, b)}.` })
}

export function leaveAlliance(s: GameState, a: NationId, b: NationId) {
  s.alliances = s.alliances.filter((k) => k !== pairKey(a, b))
  addOpinion(s, b, a, 'Abandoned our alliance', -30, 0.4)
  pushDispatch(s, { kind: 'broken', from: a, to: b, proposalKind: 'alliance', text: `${name(s, a)} has walked out of its alliance with ${name(s, b)}.` })
}

/** A nation joins a war its partner is fighting, if it is free to. */
function joinWarOf(s: GameState, map: WorldMap, rng: Rng, joiner: NationId, enemy: NationId): boolean {
  const n = s.nations[joiner]
  const e = s.nations[enemy]
  if (!n?.alive || !e?.alive || joiner === enemy) return false
  if (atWar(s, joiner, enemy)) return true
  if (n.overlord || e.overlord === joiner || isAllied(s, joiner, enemy) || hasPact(s, joiner, enemy)) return false
  if (enemiesOf(s, joiner).length >= maxWars(s, joiner) || enemiesOf(s, enemy).length >= maxWars(s, enemy)) return false
  declareWar(s, map, joiner, enemy, rng, false)
  return atWar(s, joiner, enemy)
}

/** Monthly payments for trade deals and reparations. A side that cannot pay breaks the deal. Live contracts also start late, fight beside a partner, and hold collateral. */
export function applyDeals(s: GameState, map?: WorldMap, rng?: Rng) {
  const kept: Deal[] = []
  for (const d of [...s.deals].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const from = s.nations[d.from]
    const to = s.nations[d.to]
    const c = d.contract
    // A territory owes no reparations, whenever the deal was made.
    if (d.kind === 'reparations' && from?.territoryOf) continue
    if (!from?.alive || !to?.alive) {
      // A contract's collateral goes back to its poster if the poster is still there.
      if (c && c.held > 0 && s.nations[c.poster]?.alive) s.nations[c.poster].resources.capital += c.held
      continue
    }
    // A contract that has not started yet only waits.
    if (c && s.turn < c.start) {
      kept.push(d)
      continue
    }
    // The duty to fight beside a partner: the joiner takes up each of the partner's wars, or breaks the contract.
    let refused: NationId | null = null
    if (c?.joins && map && rng) {
      const other = c.joins === d.from ? d.to : d.from
      for (const e of [...enemiesOf(s, other)].sort()) {
        if (!joinWarOf(s, map, rng, c.joins, e)) {
          refused = c.joins
          break
        }
      }
    }
    const defaulter = refused ?? (shortfall(from, d.give) ? d.from : shortfall(to, d.receive) ? d.to : null)
    if (defaulter) {
      const victim = defaulter === d.from ? d.to : d.from
      if (c) {
        // A broken contract is worse than a missed payment: the victim has a reason for war, and the collateral changes hands.
        addOpinion(s, victim, defaulter, 'Broke a contract', -40, 0.3)
        grantJustification(s, victim, defaulter, 'Broke a contract', JUSTIFY.reasonTurns)
        addInfamy(s, defaulter, 2)
        if (c.held > 0) s.nations[defaulter === c.poster ? victim : c.poster].resources.capital += c.held
        pushDispatch(s, { kind: 'broken', from: defaulter, to: victim, proposalKind: 'deal', text: `${name(s, defaulter)} ${refused ? `refused to join ${name(s, victim)}'s war` : 'could not deliver'} and broke its contract with ${name(s, victim)}${c.held > 0 && defaulter === c.poster ? `. The ${Math.round(c.held)} money in collateral goes to ${name(s, victim)}` : ''}.` })
        continue
      }
      addOpinion(s, victim, defaulter, 'Defaulted on a deal', -30, 0.4)
      pushDispatch(s, { kind: 'broken', from: defaulter, to: victim, proposalKind: 'deal', text: `${name(s, defaulter)} could not pay and defaulted on its ${dealLabel(d.kind)} with ${name(s, victim)}.` })
      continue
    }
    transferBundle(s, d.from, d.to, d.give)
    transferBundle(s, d.to, d.from, d.receive)
    if (s.turn >= d.until) {
      if (d.kind === 'trade' || d.kind === 'loan') {
        addOpinion(s, d.from, d.to, 'Honored our deal', 10, 0.3)
        addOpinion(s, d.to, d.from, 'Honored our deal', 10, 0.3)
      }
      if (c && c.held > 0) s.nations[c.poster].resources.capital += c.held
      pushDispatch(s, { kind: 'completed', from: d.from, to: d.to, proposalKind: 'deal', text: `The ${c ? 'contract' : dealLabel(d.kind)} between ${from.name} and ${to.name} has been fulfilled.` })
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
      return atWar(s, p.from, p.enemy) && !atWar(s, p.to, p.enemy) && (isAllied(s, p.from, p.to) || guarantorsOf(s, p.from).includes(p.to))
    case 'alliance':
      return !isAllied(s, p.from, p.to) && !atWar(s, p.from, p.to)
    case 'pact':
      return !hasPact(s, p.from, p.to) && !atWar(s, p.from, p.to)
    case 'trade':
    case 'loan':
      return !atWar(s, p.from, p.to)
    case 'guarantee':
      return !atWar(s, p.from, p.to) && !isAllied(s, p.from, p.to)
    case 'truce':
      return atWar(s, p.from, p.to) && trucePair(s, p.from, p.to) === null
  }
}

/** The month's end for treaties and offers. `withdraw` runs once treaties have lapsed and before offers expire: it takes out offers the world has overtaken. */
export function expireDiplomacy(s: GameState, withdraw?: () => void) {
  for (const [k, until] of Object.entries(s.pacts)) if (until < s.turn) delete s.pacts[k]
  for (const [k, until] of Object.entries(s.casusBelli)) if (until < s.turn) delete s.casusBelli[k]
  s.sanctions = (s.sanctions ?? []).filter((x) => x.until >= s.turn)
  s.guarantees = (s.guarantees ?? []).filter((x) => x.until >= s.turn)
  withdraw?.()
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
  fizzleStaleWars(s)
}

/**
 * A war between two AI nations in which neither side's countries have been attacked for a year is over in all but name: it holds
 * a war slot, ties down allies and puts off every pact. It ends in the usual truce. A war a human is in is never ended for them.
 */
export function fizzleStaleWars(s: GameState) {
  for (const key of [...s.wars]) {
    const [a, b] = key.split('|')
    if (s.humans.includes(a) || s.humans.includes(b)) continue
    if (s.turn - (s.warStarted[key] ?? s.turn) < WAR.staleMonths) continue
    let last = -Infinity
    for (const r of Object.values(s.regions)) if (r.owner === a || r.owner === b) last = Math.max(last, r.attackedTurn)
    if (s.turn - last < WAR.staleMonths) continue
    makePeace(s, a, b)
    addLog(s, 'diplomacy', `The war between ${name(s, a)} and ${name(s, b)} has fizzled out: nobody has fought for a year.`, [a, b])
  }
}
