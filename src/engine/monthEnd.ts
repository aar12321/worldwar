import { computeEconomy, type MoneyLine } from './economy'
import { tributeOf } from './politics'
import { portfolio } from './stocks'
import type { GameState, NationId, WorldMap } from './types'

/**
 * The money that moves at the month's end outside the economy's own lines: dividends on shares, tribute between a puppet and its
 * master, and the money in trade deals and reparations. Together with `computeEconomy().lines` this is everything that changes the
 * treasury in a quiet month.
 */
export function monthEndLines(s: GameState, map: WorldMap, nationId: NationId): MoneyLine[] {
  const n = s.nations[nationId]
  const out: MoneyLine[] = []
  const add = (label: string, amount: number) => {
    if (Math.abs(amount) > 1e-9) out.push({ label, amount, kind: amount >= 0 ? 'income' : 'cost' })
  }
  add('Dividends on shares', portfolio(s, nationId).dividends)
  if (n.overlord && s.nations[n.overlord]?.alive) add(`Tribute to ${s.nations[n.overlord].name}`, -tributeOf(s, map, nationId))
  let paid = 0
  for (const p of Object.values(s.nations)) if (p.alive && p.overlord === nationId) paid += tributeOf(s, map, p.id)
  add('Tribute from puppets', paid)
  // Deals pay while both sides are alive, up to and including their last month.
  let deals = 0
  for (const d of s.deals) {
    if (d.until < s.turn || !s.nations[d.from]?.alive || !s.nations[d.to]?.alive) continue
    if (d.from === nationId) deals += (d.receive.capital ?? 0) - (d.give.capital ?? 0)
    else if (d.to === nationId) deals += (d.give.capital ?? 0) - (d.receive.capital ?? 0)
  }
  add('Trade deals and reparations', deals)
  return out
}

/** The treasury's whole change in a quiet month: the economy's lines and the month-end flows. */
export function treasuryChange(s: GameState, map: WorldMap, nationId: NationId): number {
  return computeEconomy(s, map, nationId).netCapital + monthEndLines(s, map, nationId).reduce((sum, l) => sum + l.amount, 0)
}
