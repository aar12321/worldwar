import { alliesOf, atWar, enemiesOf, isAllied } from '../engine/helpers'
import { factionOf } from '../engine/factions'
import { partnerRelations } from '../engine/partners'
import type { GameState, NationId } from '../engine/types'

/**
 * The nations the Diplomacy desk lists first: neighbors, enemies, and everyone you have a standing arrangement with.
 * That is allies, pact partners, guarantees either way, trade and loans (a pact with someone across the sea used to
 * leave them off the list), and the members of your faction. The nation you came for (`focus`) is always in it.
 */
export function closeNations(game: GameState, me: NationId, neighbors: Iterable<NationId>, focus: NationId | null = null): NationId[] {
  const partners = partnerRelations(game, me)
  const close = new Set<NationId>([...neighbors, ...enemiesOf(game, me), ...alliesOf(game, me), ...partners.keys(), ...(factionOf(game, me)?.members ?? [])])
  for (const d of game.deals) close.add(d.from === me ? d.to : d.from)
  if (focus && focus !== me && game.nations[focus]?.alive) close.add(focus)
  close.delete(me)
  return [...close]
    .filter((id) => game.nations[id]?.alive)
    .sort((a, b) => Number(atWar(game, me, b)) - Number(atWar(game, me, a)) || Number(isAllied(game, me, b)) - Number(isAllied(game, me, a)) || Number(partners.has(b)) - Number(partners.has(a)) || game.nations[a].name.localeCompare(game.nations[b].name))
}


export { offerIsMoot } from '../engine/offers'
