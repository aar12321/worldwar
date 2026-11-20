import { isLive } from '../engine/calendar'
import type { GameState } from '../engine/types'

/** When an offer sent from the Diplomacy desk is seen and answered: at once in a live game, at the month's turn in a turn game. */
export function offerWhen(game: GameState, human: string | null | undefined): string {
  if (isLive(game)) return human ? `${human} sees it at once and answers from their Diplomacy desk` : 'They answer the same day'
  return human ? `${human} sees it when the next month begins` : 'They answer when the month ends'
}
