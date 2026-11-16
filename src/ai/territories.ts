import { TERRITORY } from '../data/territories'
import { regionsOf, territoriesOf } from '../engine/helpers'
import { asCommand, territoryProblem, territoryValue } from '../engine/territories'
import { grossIncome } from '../engine/victory'
import { regionValue } from '../engine/warscore'
import type { GameState, NationId, Order, WorldMap } from '../engine/types'

/**
 * When a rival asks for a territory at the peace table instead of land or a puppet (see `peaceTerms`). Never Easy or Medium: only the strongest
 * tier, with a crushing lead (war score 40 beyond the price), for one territory at a time, never of a country that earns more than the master does
 * (a territory pays a third of everything and fights for it, so a rich one is a conquest to be taken apart), and only a land worth ruling.
 */
export function wantsTerritory(s: GameState, map: WorldMap, me: NationId, enemy: NationId, net: number, skill: 0 | 1 | 2): boolean {
  if (skill < 2 || net < TERRITORY.ai.minNet[skill]) return false
  if (territoriesOf(s, me).length >= TERRITORY.ai.maxTerritories[skill]) return false
  if (territoryProblem(s, me, enemy)) return false
  if (grossIncome(s, map, enemy) > TERRITORY.ai.maxRichness * Math.max(1, grossIncome(s, map, me))) return false
  let land = 0
  for (const r of regionsOf(s, enemy)) land += regionValue(s, map, r)
  if (land < TERRITORY.ai.minLand) return false
  return territoryValue(s, map, enemy) <= net * 0.9
}

/** What a territory's own bot plans for the army and diplomacy of its master's command: kept as the master's orders. */
const COMMANDED = new Set<Order['type']>(TERRITORY.commands.filter((t) => t !== 'propose' && t !== 'cancelDeal'))

/**
 * A territory's bot plans its military (training, posture, alert, attacks) as it would for itself, and a bot master gives the orders. A master
 * who is a person commands its territories by hand: then the territory's bot plans only its economy. Returns the orders to send for the territory.
 */
export function territoryOrders(s: GameState, id: NationId, plan: (asMaster: boolean) => Order[]): Order[] {
  const master = s.nations[s.nations[id]?.territoryOf ?? '']
  const person = !master?.alive || s.humans.includes(master.id) || master.isPlayer
  if (person) return plan(false)
  const planned = asCommand(() => plan(true))
  return planned.map((o) => (COMMANDED.has(o.type) ? ({ type: 'commandTerritory', nationId: master.id, territory: id, order: o } as Order) : o))
}
