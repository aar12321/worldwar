import type { GameState } from './types'

/**
 * What the globe actually draws. Training timers, march progress, and the
 * month clock are left out so those ticks do not rebuild the map.
 */
export function sceneKey(s: GameState): string {
  let out = `${s.turn}|${s.playerId}|`
  for (const id of Object.keys(s.regions).sort()) {
    const region = s.regions[id]
    out += `${id}:${region.owner}:${region.rebels > 0.05 ? 1 : 0}:${region.buildings.factory}:${region.buildings.port};`
  }
  const held = s.territoryOwners
  if (held) {
    for (const id of Object.keys(held).sort()) out += `${id}=${held[id]},`
  }
  out += '#'
  for (const id of Object.keys(s.armies).sort()) {
    const army = s.armies[id]
    const march = army.march
    out += `${id}@${army.location}/${army.owner}/${army.homeTerritoryId}/${Math.round(army.units.infantry)}/${Math.round(army.units.armor)}/${Math.round(army.units.air)}/${Math.round(army.units.naval)}/`
    if (march) out += `${march.kind}:${march.to}:${march.territoryId}:${march.fromLat.toFixed(2)}:${march.fromLng.toFixed(2)}:${march.toLat.toFixed(2)}:${march.toLng.toFixed(2)}`
    out += ';'
  }
  for (const battle of s.battles) {
    if (battle.attacker.nationId === s.playerId || battle.defender.nationId === s.playerId || battle.captured) out += `${battle.id};`
  }
  return out
}
