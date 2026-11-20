import { COSTS } from '../data/unitTypes'
import { JUSTIFY } from '../data/war'
import { hasCasusBelli } from '../engine/helpers'
import type { GameState, NationId } from '../engine/types'

/**
 * The Declare war button's reason when it cannot be pressed. A war with no reason costs more influence than any nation starts with
 * (60 against 30, a few points a month), so "Not enough influence" alone leaves a player, or two friends who want to fight each
 * other, stuck. This says what they have and the way that works: build a case, and the war costs a sixth.
 */
export function warRefusal(game: GameState, me: NationId, target: NationId, why: string): string {
  if (!/^Not enough influence/.test(why) || hasCasusBelli(game, me, target)) return why
  const have = Math.floor(game.nations[me]?.resources.pp ?? 0)
  return `${why}; you have ${have}. Build a case first (${JUSTIFY.caseCost} influence, ready in ${JUSTIFY.caseMonths} months): then war costs only ${COSTS.declareWarWithCasusBelli}.`
}
