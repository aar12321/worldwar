import { PROPOSAL_LABELS } from '../data/unitTypes'
import { addLog } from './helpers'
import { validateOrder } from './orders'
import type { GameState, Order, Proposal, WorldMap } from './types'

/** Shortfalls the nation answering can fix (money, influence, a box to untick): such an offer is not moot. */
const FIXABLE = /money|afford|enough|untick|influence/i

/** Why an offer waiting on a nation can no longer be accepted, or null when it still can (or only for a shortfall it can fix). */
export function mootReason(game: GameState, map: WorldMap, p: Proposal, orders: readonly Order[] = []): string | null {
  const others = orders.filter((o) => !(o.type === 'respond' && o.proposalId === p.id))
  const why = validateOrder(game, map, { type: 'respond', nationId: p.to, proposalId: p.id, accept: true }, others as Order[])
  return why && !FIXABLE.test(why) ? why : null
}

/**
 * Whether an offer waiting on a nation can no longer be taken up because the world moved on: a pact offer from someone it is now
 * allied with, peace with someone it is no longer at war with, a call to a war that is over. Such offers used to sit in the inbox
 * with "Cannot accept" until they expired, counted on the Diplomacy badge and in the advisor. A shortfall the nation can fix
 * (money, influence, a box to untick) is not moot. Pure and read-only; `dropMootOffers` is what withdraws them.
 */
export function offerIsMoot(game: GameState, map: WorldMap, p: Proposal, orders: readonly Order[] = []): boolean {
  return mootReason(game, map, p, orders) !== null
}

/** The refusal of an accepted offer, said as what happened in the world (the rules speak to the one proposing). */
const PLAIN: Record<string, string> = {
  'Not at war': 'the war is over',
  'Make peace first': 'they are at war',
  'Cannot trade with an enemy': 'they are at war',
  'You cannot lend to an enemy': 'they are at war',
  'You cannot guarantee a nation you are at war with': 'they are at war',
  'Already allied': 'they are allies now',
  'Allies already defend each other': 'they are allies now',
  'Pact already in force': 'a pact is already in force',
  'You already have a pact or an alliance with them': 'a pact or an alliance is already in force',
  'You already guarantee them': 'the guarantee is already in force',
  'Already fighting them': 'that war is already being fought',
  'Not at war with that nation': 'that war is over',
  'Only allies and guarantors can be called to arms': 'they are no longer allies',
  'A ceasefire already holds': 'a ceasefire already holds',
  'Invalid target': 'one of them is gone',
}

export function plainMoot(why: string): string {
  return PLAIN[why] ?? why.charAt(0).toLowerCase() + why.slice(1)
}

/**
 * Withdraws every offer the world has overtaken (see `offerIsMoot`), each with a line in the news, so it neither waits in an inbox nor costs
 * the nation that never answered it "Ignored our offer" when it would have expired. Run at the end of each month (before offers expire)
 * and, in a live game, after every order that happens at once. Returns how many were withdrawn. Changes nothing when none is moot.
 */
export function dropMootOffers(s: GameState, map: WorldMap): number {
  if (s.proposals.length === 0) return 0
  const gone = new Map<string, string>()
  for (const p of s.proposals) {
    // An offer to or from a nation that has fallen is cleared with the nation, without news.
    if (!s.nations[p.from]?.alive || !s.nations[p.to]?.alive) continue
    const why = mootReason(s, map, p)
    if (why) gone.set(p.id, why)
  }
  if (gone.size === 0) return 0
  const dropped = s.proposals.filter((p) => gone.has(p.id))
  s.proposals = s.proposals.filter((p) => !gone.has(p.id))
  for (const p of dropped) {
    const text = mootLine(s, p, gone.get(p.id)!)
    s.dispatches.push({ kind: 'expired', from: p.from, to: p.to, proposalKind: p.kind, text })
    addLog(s, 'diplomacy', text, [p.from, p.to])
  }
  return dropped.length
}

/** The news line for a withdrawn offer. */
export function mootLine(s: GameState, p: Proposal, why: string): string {
  const from = s.nations[p.from]?.name ?? p.from
  const to = s.nations[p.to]?.name ?? p.to
  return `${from}'s offer of a ${PROPOSAL_LABELS[p.kind].toLowerCase()} to ${to} was withdrawn: ${plainMoot(why)}.`
}
