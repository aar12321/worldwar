import { AI_TRUCE, MW } from '../data/missileWar'
import { DEALINGS } from '../data/relations'
import { recentlyProposed, truceByOffer, truceRefusedAt } from '../engine/diplomacy'
import { enemiesOf } from '../engine/helpers'
import { exchangeOf, missilesInStore, tensionOf, truceAnswer, truceNeed, trucePair, truceWilling } from '../engine/missileWar'
import { createRng } from '../engine/rng'
import type { GameState, NationId, Order } from '../engine/types'

/**
 * Rivals offer missile ceasefires (AI_TRUCE, docs/MISSILE_PROGRAM_STATUS.md "Rivals offer ceasefires").
 *
 * A rival offers an enemy a ceasefire only when it would itself accept one from that enemy (`truceWilling`, the rule it answers by, so
 * what it offers and what it answers agree): the world is on edge (tension at its temperament's need), the missile war has cost it more
 * than it dealt, it is losing the exchange with that enemy lately, or it is under fire with its interceptor store or its own missiles
 * spent. The pair must be exchanging missiles (either struck the other within `exchange` months), or, with the world on edge, the enemy
 * must hold missiles. Never right after it escalated against that enemy (fired at it by its own order this month or last, or orders a
 * strike, raid or warhead on it this month; a doctrine's automatic answer does not count), never while a ceasefire holds or an offer waits
 * either way. To a player the offer goes to the Diplomacy inbox (a `truce` offer, as between two players, under the inbox limits of any
 * rival offer): at most one every `every` months, and none for `afterRefusal` months after the player declined or let one lapse. To
 * another rival it is made on the spot, and only when that rival would accept. One offer a month at most (the caller takes the first that
 * is valid); whether it is made this month is a draw from its own random stream, so nothing else in the month moves.
 */
export function missileTruceOffers(s: GameState, id: NationId, skill: 0 | 1 | 2, orders: readonly Order[]): Order[] {
  if (!AI_TRUCE.on || !MW.enabled || skill < 1) return []
  const n = s.nations[id]
  if (!n?.alive || n.isPlayer || s.humans.includes(id)) return []
  const foes = enemiesOf(s, id).filter((e) => s.nations[e]?.alive && trucePair(s, id, e) === null)
  if (!foes.length) return []
  // Firing on warning, ordered this month, is no time to talk.
  if (orders.some((o) => o.type === 'setDoctrine' && o.nationId === id && o.doctrine === 'warning')) return []
  const rng = createRng((s.seed ^ 0x7c3e) >>> 0, s.turn * 100003 + hashText(id))
  if (!rng.chance(AI_TRUCE.chance)) return []
  const onEdge = tensionOf(s) >= truceNeed(s, n)
  const struck = (victim: NationId, by: NationId) => s.turn - (s.nations[victim]?.struckBy?.[by] ?? -999) <= AI_TRUCE.exchange
  const owner = (region: string) => s.regions[region]?.owner
  const hitting = (foe: NationId) => orders.some((o) => o.nationId === id && (o.type === 'strike' || o.type === 'raid' || o.type === 'nuke') && owner(o.target) === foe)
  const out: Order[] = []
  // The enemy that struck it most lately first, then the rest by id.
  const ranked = [...foes].sort((a, b) => (n.struckBy?.[b] ?? -999) - (n.struckBy?.[a] ?? -999) || (a < b ? -1 : 1))
  for (const foe of ranked) {
    const x = exchangeOf(s, id, foe)
    if ((x.lastOrdered !== null && s.turn - x.lastOrdered <= AI_TRUCE.escalated) || hitting(foe)) continue
    if (!(struck(id, foe) || struck(foe, id)) && !(onEdge && missilesInStore(s.nations[foe]) >= AI_TRUCE.armed)) continue
    if (!truceWilling(s, id, foe).accepts) continue
    if (orders.some((o) => o.type === 'missileTruce' && o.target === foe)) continue
    if (s.proposals.some((p) => p.kind === 'truce' && ((p.from === id && p.to === foe) || (p.from === foe && p.to === id)))) continue
    const order: Order = { type: 'missileTruce', nationId: id, target: foe }
    if (truceByOffer(s, order)) {
      if (!DEALINGS.on || recentlyProposed(s, id, foe, 'truce', AI_TRUCE.every)) continue
      const refused = truceRefusedAt(s, id, foe)
      if (refused !== null && s.turn - refused < AI_TRUCE.afterRefusal) continue
    } else if (!truceAnswer(s, foe, id).accepts) continue
    out.push(order)
  }
  return out
}

function hashText(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}
