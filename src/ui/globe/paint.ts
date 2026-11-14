import type { GameState } from '../../engine/types'
import { getWorld } from '../../map/world'
import type { MapMode } from '../../store'

const { map } = getWorld()

/** What the polygons' colors depend on, as one string. A day in which armies march and nothing changes hands leaves it the same. */
export function paintSignature(game: GameState | null, mode: MapMode): string {
  if (!game) return 'none'
  let out = `${game.playerId}|`
  for (const id of map.order) out += `${game.regions[id].owner},`
  if (mode === 'relations') out += `|${game.wars.join(',')}|${game.alliances.join(',')}|${Object.keys(game.pacts).join(',')}|${game.turn}`
  if (mode === 'fronts') {
    out += `|${game.wars.join(',')}|`
    for (const id of map.order) out += `${Math.round(game.regions[id].line * 10)},`
  }
  return out
}
