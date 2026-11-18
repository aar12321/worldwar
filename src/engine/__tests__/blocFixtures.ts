import { expect } from 'vitest'
import { factionOf } from '../factions'
import { pairKey, totalUnits } from '../helpers'
import { validateOrder } from '../orders'
import { applyOrderNow } from '../resolveTurn'
import type { Faction, GameState, NationId, Order } from '../types'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'

/**
 * The bloc rules (docs/BLOC_STATUS.md). The map is a chain r0 - r1 - r2 - ... : r0 and r1 are the bloc, r2 the enemy that also holds r3
 * and r4. r0 does not border the enemy, so its divisions go over r1's border: the operation is one force led by r1.
 */
export const map = lineMap(8)

export function world(humans: NationId[] = ['r0', 'r1']): GameState {
  const s = startState(map, 'r0', 3)
  s.humans = humans
  for (const id of Object.keys(s.nations)) {
    const n = s.nations[id]
    Object.assign(n.resources, { capital: 1000, pp: 300, oil: 100, steel: 100, goods: 60, food: 120 })
    n.isPlayer = humans.includes(id)
    setMilitary(s, id, { infantry: 10, armor: 4 })
  }
  return s
}
export const ok = (s: GameState, o: Order) => expect(applyOrderNow(s, map, o).error, JSON.stringify(o)).toBeNull()
export const bad = (s: GameState, o: Order) => validateOrder(s, map, o)
export const unitsOf = (s: GameState, ids: NationId[]) => ids.reduce((a, m) => a + totalUnits(s.nations[m].military.units), 0)

/** r0 founds a bloc, r1 joins; r2 (with r3, r4) is at war with both. */
export function setup(humans: NationId[] = ['r0', 'r1']): { s: GameState; f: () => Faction } {
  const s = world(humans)
  ok(s, { type: 'factionFound', nationId: 'r0', name: 'Iron Pact' })
  const fid = factionOf(s, 'r0')!.id
  ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
  if (!factionOf(s, 'r1')) ok(s, { type: 'factionJoin', nationId: 'r1', factionId: fid })
  giveRegions(s, 'r2', ['r3', 'r4'])
  for (const id of ['r2', 'r3', 'r4']) s.regions[id].line = 3
  setMilitary(s, 'r2', { infantry: 4 })
  s.wars.push(pairKey('r0', 'r2'), pairKey('r1', 'r2'))
  s.wars.sort()
  return { s, f: () => factionOf(s, 'r0')! }
}

