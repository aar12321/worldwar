import { useGame } from '../store'
import { incomingMissiles } from '../engine/missiles'
import type { GameState } from '../engine/types'

/** The game while missiles (or a warhead) are in the air toward one of the player's countries, else nothing, so a quiet day leaves it alone. */
const struck = (s: { game: GameState | null }) => {
  const g = s.game
  if (!g) return null
  return incomingMissiles(g, g.playerId).length > 0 || (g.nukes ?? []).some((f) => f.nationId !== g.playerId && g.regions[f.target]?.owner === g.playerId) ? g : null
}

/**
 * The edge of the screen pulses while a salvo is incoming: a red frame (orange with the color-blind palette) that breathes. With reduced
 * motion it is a steady frame. It draws no sound, and takes no clicks.
 */
export function MissileAlert() {
  const game = useGame(struck)
  if (!game) return null
  const nukes = (game.nukes ?? []).some((f) => f.nationId !== game.playerId && game.regions[f.target]?.owner === game.playerId)
  return <div className={`missile-edge ${nukes ? 'missile-edge-nuke' : ''}`} aria-hidden data-missile-edge />
}
