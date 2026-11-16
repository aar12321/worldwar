import { inviteOutlook } from '../ai/factions'
import { opinionOf } from '../ai/opinion'
import { alliesOf, guarantorsOf, hasPact } from './helpers'
import { factionOf, factionProblem } from './factions'
import type { Faction, GameState, NationId, Order, WorldMap } from './types'

/**
 * Who your partners are, in the words the Diplomacy desk uses, so the Faction desk can show the same people the same way:
 * an alliance, a peace pact, a guarantee (either way), or a running trade deal or loan.
 */
export type PartnerRelation = 'ally' | 'pact' | 'guarantor' | 'guarded' | 'trade' | 'loan'

export const RELATION_TEXT: Record<PartnerRelation, { chip: string; long: string; tone: 'good' | 'warn' | 'bad' | 'none' }> = {
  ally: { chip: 'Ally', long: 'You are allied', tone: 'good' },
  pact: { chip: 'Pact', long: 'You have a peace pact', tone: 'good' },
  guarantor: { chip: 'Guarantees you', long: 'They guarantee your independence', tone: 'none' },
  guarded: { chip: 'You guarantee', long: 'You guarantee their independence', tone: 'none' },
  trade: { chip: 'Trade', long: 'You have a trade deal running', tone: 'none' },
  loan: { chip: 'Loan', long: 'A loan is running between you', tone: 'none' },
}

const ORDER: PartnerRelation[] = ['ally', 'pact', 'guarantor', 'guarded', 'trade', 'loan']

/** Every nation `me` has a standing arrangement with, and what it is. Allies, pact partners, guarantees either way, trade and loans. Reparations are not a partnership. */
export function partnerRelations(s: GameState, me: NationId): Map<NationId, PartnerRelation[]> {
  const out = new Map<NationId, Set<PartnerRelation>>()
  const add = (id: NationId, r: PartnerRelation) => {
    if (id === me || !s.nations[id]?.alive) return
    if (!out.has(id)) out.set(id, new Set())
    out.get(id)!.add(r)
  }
  for (const a of alliesOf(s, me)) add(a, 'ally')
  for (const id of Object.keys(s.nations)) if (id !== me && hasPact(s, me, id)) add(id, 'pact')
  for (const g of guarantorsOf(s, me)) add(g, 'guarantor')
  for (const p of s.guarantees ?? []) if (p.from === me && p.until >= s.turn) add(p.to, 'guarded')
  for (const d of s.deals) {
    if (d.from !== me && d.to !== me) continue
    if (d.kind === 'trade') add(d.from === me ? d.to : d.from, 'trade')
    else if (d.kind === 'loan') add(d.from === me ? d.to : d.from, 'loan')
  }
  const sorted = new Map<NationId, PartnerRelation[]>()
  for (const [id, set] of out) sorted.set(id, ORDER.filter((r) => set.has(r)))
  return sorted
}

export interface InviteCandidate {
  id: NationId
  relations: PartnerRelation[]
  opinion: number
  /** Why this nation cannot be invited right now, or null. The same sentence the order itself would be refused with. */
  problem: string | null
  /** The faction it belongs to, if any. */
  inFaction: Faction | null
  /** For a rival: how it is likely to answer. Null for another player. */
  outlook: 'likely' | 'unsure' | 'unlikely' | null
}

/**
 * Every living nation but you, as someone to invite into your faction: partners first, then by what they think of you.
 * Nobody is left out: a nation that cannot be invited carries the reason, and sorts below those that can within its group.
 */
export function inviteCandidates(s: GameState, map: WorldMap, me: NationId, f: Faction, pending: Order[] = []): InviteCandidate[] {
  const partners = partnerRelations(s, me)
  const out: InviteCandidate[] = []
  for (const n of Object.values(s.nations)) {
    if (!n.alive || n.id === me) continue
    const problem = factionProblem(s, map, { type: 'factionInvite', nationId: me, target: n.id }, pending)
    const human = s.humans.includes(n.id) || !!n.isPlayer
    out.push({
      id: n.id,
      relations: partners.get(n.id) ?? [],
      opinion: opinionOf(s, map, n.id, me, { coalition: false }),
      problem,
      inFaction: factionOf(s, n.id),
      outlook: human || problem ? null : inviteOutlook(s, map, n.id, f),
    })
  }
  return out.sort((a, b) => Number(b.relations.length > 0) - Number(a.relations.length > 0) || Number(!!a.problem) - Number(!!b.problem) || b.opinion - a.opinion || (s.nations[a.id].name < s.nations[b.id].name ? -1 : 1))
}

/** Partners (allies and pact partners first) who could be invited to your faction right now, best liked first. */
export function invitablePartners(s: GameState, map: WorldMap, me: NationId, f: Faction, pending: Order[] = []): InviteCandidate[] {
  const strong = (c: InviteCandidate) => c.relations.includes('ally') || c.relations.includes('pact')
  return inviteCandidates(s, map, me, f, pending)
    .filter((c) => c.relations.length > 0 && !c.problem)
    .sort((a, b) => Number(strong(b)) - Number(strong(a)) || b.opinion - a.opinion || (a.id < b.id ? -1 : 1))
}
