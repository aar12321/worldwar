import type { BattleReport, GameState, NationId } from '../engine/types'
import { getWorld } from '../map/world'

/** Which of these battles play in the battle window, by the player's setting. */
export function scenesFor(mode: 'all' | 'mine' | 'off', player: NationId, battles: BattleReport[]): BattleReport[] {
  if (mode === 'off') return []
  return battles.filter((b) => b.attacker.nationId === player || (mode === 'all' && b.defender.nationId === player))
}

/** One line for a battle the player was in, and whether it went their way. */
export function battleLine(b: BattleReport, game: GameState, player: NationId): { text: string; good: boolean } {
  const place = getWorld().map.regions[b.regionId]?.name ?? 'the front'
  const line = b.lineBefore !== undefined && b.lineAfter !== undefined ? ` (Defense Line ${b.lineBefore.toFixed(1)} → ${b.lineAfter.toFixed(1)})` : ''
  const won = b.winner === 'attacker'
  if (b.attacker.nationId === 'rebels') return won && b.captured ? { text: `Rebels took ${place}. It has broken away.`, good: false } : { text: `Your garrison beat back rebels in ${place}.`, good: true }
  if (b.attacker.nationId === player) {
    if (b.captured) return { text: `You captured ${place}.`, good: true }
    return won ? { text: `You pushed back the defense of ${place}${line}.`, good: true } : { text: `Your attack on ${place} was repulsed.`, good: false }
  }
  const who = game.nations[b.attacker.nationId]?.name ?? 'An enemy'
  if (b.captured) return { text: `${who} captured ${place} from you.`, good: false }
  return won ? { text: `${who} pushed back your defense of ${place}${line}.`, good: false } : { text: `${who} attacked ${place} and was repulsed.`, good: true }
}
