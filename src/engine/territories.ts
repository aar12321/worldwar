import { addOpinion } from '../ai/opinion'
import { TERRITORY } from '../data/territories'
import { EMPIRE } from '../data/war'
import { tierSpec } from '../data/empire'
import { computeEconomy } from './economy'
import { adoptTerritory, dismissTerritory, factionOf } from './factions'
import { addInfamy, addLog, atWar, enemiesOf, pairKey, puppetsOf, regionsOf, territoriesOf } from './helpers'
import { bundleValue, marketPrices, validateTradeTerms } from './trade'
import { transferRegion } from './warfare'
import { puppetValue } from './warscore'
import type { GameState, Nation, NationId, Order, TradeTerms, WorldMap } from './types'

/**
 * Territories, the whole rule set (numbers in `data/territories.ts`).
 *
 * A territory is held by `Nation.territoryOf` (its master) and written up in `GameState.territories`. Neither exists in a game that has
 * no territory. A territory is NOT a puppet: it has no `overlord`, loyalty, tribute or rebels, and the puppet rules never touch it.
 *
 *  - REVENUE: each month the master takes `TERRITORY.cut` (30%) of the territory's revenue (taxes + factories + trade + business tax, the same
 *    base the puppet tribute and the economic victory use, counted before the territory's own costs). It can never be lowered or paused.
 *    Nothing is taken when the revenue is not above zero, and never more than the territory has in its treasury, so it cannot be driven
 *    into a debt spiral by the cut itself. It is not part of the puppet tribute and not held to its 25% cap.
 *  - FACTION: it is put into the master's faction (one is founded if the master has none), does not use a seat or have a vote, and cannot leave.
 *  - WAR: it fights in every war its master fights and cannot make peace by itself; peace is made by the master, in its own name or the territory's.
 *  - ARMY: the master commands it (`commandTerritory`), the territory pays for what it orders.
 *  - TRADE: the master forces deals on it (`forceTrade`); it cannot refuse or cancel one.
 *  - REPARATIONS: a territory is never made to pay any (peace terms refuse it; ones it owed are forgiven when it becomes one).
 *  - PEOPLE: its people, output and workforce are its own and never counted as the master's. Countries count for a share (see below).
 *  - ENDING: the master may release it, or annex it after `annexMonths`; if the master falls it becomes independent.
 */

export const isTerritory = (n: Pick<Nation, 'territoryOf'> | undefined | null): boolean => !!n?.territoryOf

/** The master of a territory, when both are alive. */
export const masterOf = (s: GameState, id: NationId): NationId | null => {
  const m = s.nations[id]?.territoryOf
  return m && s.nations[m]?.alive ? m : null
}

const isHumanNation = (s: GameState, id: NationId) => s.humans.includes(id) || !!s.nations[id]?.isPlayer

// ---- orders given as the territory ---------------------------------------------------------------------------------------------

let commanding = 0
/** Runs `fn` as the master: orders in it that carry the territory's `nationId` are not refused for being the territory's own. */
export function asCommand<T>(fn: () => T): T {
  commanding++
  try {
    return fn()
  } finally {
    commanding--
  }
}

/** Orders a territory may not give itself: its army and wars, its diplomacy, its faction, its missiles. Its master gives them for it. */
const BARRED = new Set<Order['type']>([
  ...TERRITORY.commands,
  'respond',
  'declareWar',
  'buildCase',
  'leaveAlliance',
  'breakPact',
  'imposeSanctions',
  'liftSanctions',
  'invest',
  'strike',
  'raid',
  'nuke',
  'recon',
  'scramble',
  'missileTruce',
  'operation',
  'buildWarhead',
  'resolution',
  'factionFound',
  'factionJoin',
  'factionInvite',
  'factionRequest',
  'factionLeave',
  'factionContribute',
  'factionWithdraw',
  'factionPropose',
  'factionVote',
])

/** Why a nation's own order is refused because it is a territory, or null. */
export function ownOrderProblem(s: GameState, o: Order): string | null {
  if (commanding > 0) return null
  const n = s.nations[o.nationId]
  if (!n?.territoryOf || !BARRED.has(o.type)) return null
  const m = s.nations[n.territoryOf]?.name ?? 'Its master'
  return o.type === 'factionLeave' ? `${n.name} must stay in ${m}'s faction for ever` : `${m} decides what ${n.name} does here`
}

/** The order a `commandTerritory` carries out, or the order itself. */
export const commanded = (o: Order): Order => (o.type === 'commandTerritory' && o.order && typeof o.order === 'object' ? o.order : o)

type Command = Extract<Order, { type: 'commandTerritory' }>

/** Why a master may not give this order as its territory, or null. `validate` is the usual order check, so the territory's treasury and rules are the ones that count. */
export function commandProblem(s: GameState, o: Command, pending: Order[], validate: (s: GameState, map: WorldMap, o: Order, pending: Order[]) => string | null, map: WorldMap): string | null {
  const t = typeof o.territory === 'string' ? s.nations[o.territory] : undefined
  if (!t?.alive || t.territoryOf !== o.nationId) return 'They are not your territory'
  const inner = o.order
  if (!inner || typeof inner !== 'object' || typeof inner.type !== 'string') return 'Choose an order'
  if (inner.nationId !== o.territory) return 'The order must be given as the territory'
  if (!(TERRITORY.commands as readonly string[]).includes(inner.type)) return 'A master cannot command that'
  if (inner.type === 'propose' && inner.proposal?.kind !== 'peace') return 'A territory only asks for peace through its master. Trade is forced with Force trade.'
  // The master's own wars are fought and ended by the master: a peace it has not made is not the territory's to ask.
  if (inner.type === 'propose' && inner.proposal?.kind === 'peace' && atWar(s, o.nationId, inner.target)) return `You are at war with ${s.nations[inner.target]?.name ?? 'them'} yourself: make peace yourself, and your territory follows`
  const mine = pending.filter((p): p is Command => p.type === 'commandTerritory' && p.territory === o.territory && !!p.order).map((p) => p.order)
  return asCommand(() => validate(s, map, inner, mine))
}

// ---- the price and the limits --------------------------------------------------------------------------------------------------

/** The most territories a nation of this tier may hold. */
export const maxTerritories = (n: Pick<Nation, 'tier'>): number => TERRITORY.maxByTier[Math.max(1, Math.min(5, Math.round(n.tier ?? 1))) - 1]

/** War score to make a nation a territory: a multiple of what a puppet of the same size costs, never over the cap. */
export function territoryValue(s: GameState, map: WorldMap, id: NationId): number {
  return Math.round(Math.min(TERRITORY.valueCap, puppetValue(s, map, id) * TERRITORY.valueMult))
}

/** Why `proposer` may not make `target` a territory (at the peace table), or null. */
export function territoryProblem(s: GameState, proposer: NationId, target: NationId): string | null {
  const m = s.nations[proposer]
  const t = s.nations[target]
  if (!m?.alive || !t?.alive || proposer === target) return 'Invalid nation'
  if (isHumanNation(s, target)) return `${t.name} is run by a player: a player's nation cannot be made a territory`
  if (t.overlord) return `${t.name} is a puppet`
  if (t.territoryOf) return `${t.name} is already a territory`
  if (m.overlord) return 'A puppet cannot hold territories'
  if (m.territoryOf) return 'A territory cannot hold territories'
  const held = territoriesOf(s, proposer).length + 1 + territoriesOf(s, target).length
  const max = maxTerritories(m)
  if (held > max) return `A ${tierSpec(m.tier ?? 1).name} can hold ${max} ${max === 1 ? 'territory' : 'territories'}`
  return null
}

// ---- revenue ---------------------------------------------------------------------------------------------------------------------

/** The revenue the cut is a share of: taxes, factories, trade and business tax, before any cost. */
export function revenueOf(s: GameState, map: WorldMap, id: NationId): number {
  const e = computeEconomy(s, map, id)
  return Math.max(0, e.taxIncome + e.factoryIncome + e.tradeIncome + e.corporateIncome)
}

/** What the master takes from a territory this month: the share of its revenue, never more than its treasury holds. */
export function cutOf(s: GameState, map: WorldMap, id: NationId): { revenue: number; cut: number } {
  const t = s.nations[id]
  const revenue = revenueOf(s, map, id)
  if (!t || revenue <= 0) return { revenue, cut: 0 }
  return { revenue, cut: Math.max(0, Math.min(revenue * TERRITORY.cut, t.resources.capital)) }
}

// ---- becoming one, and ceasing to be one -------------------------------------------------------------------------------------------

const hold = (s: GameState, id: NationId, master: NationId) => {
  s.nations[id].territoryOf = master
  const rec = (s.territories ??= {})
  const old = rec[id]
  rec[id] = { master, since: old?.since ?? s.turn, taken: old?.taken ?? 0, last: 0, revenue: 0 }
}

/** Makes `id` a territory of `master`: it joins the master's faction, owes no reparations, and what it ruled passes up to the master. */
export function bindTerritory(s: GameState, id: NationId, master: NationId) {
  const t = s.nations[id]
  // What the new territory itself held passes up, as puppets of a puppet do.
  for (const p of puppetsOf(s, id)) {
    if (p === master) continue
    s.nations[p].overlord = master
    s.nations[p].overlordSince = s.turn
    if (s.nations[p].loyalty !== undefined) s.nations[p].loyalty = Math.max(0, s.nations[p].loyalty! - 10)
  }
  for (const q of territoriesOf(s, id)) if (q !== master) hold(s, q, master)
  t.overlord = null
  hold(s, id, master)
  // It owes no reparations: what it still owed is forgiven.
  s.deals = s.deals.filter((d) => !(d.kind === 'reparations' && d.from === id))
  adoptTerritory(s, master, id)
  for (const q of territoriesOf(s, master)) adoptTerritory(s, master, q)
  joinWars(s, id, master)
}

/** Passes the territories of a nation that became a puppet or territory up to its new master. */
export function passUpTerritories(s: GameState, from: NationId, master: NationId) {
  for (const q of territoriesOf(s, from)) {
    if (q === master) {
      freeTerritory(s, q, 'released')
      continue
    }
    hold(s, q, master)
    adoptTerritory(s, master, q)
  }
}

/** Ends a territory's subjection: independent, out of its master's faction. */
export function freeTerritory(s: GameState, id: NationId, why: 'released' | 'master fell' | 'annexed' = 'released') {
  const t = s.nations[id]
  if (!t) return
  delete t.territoryOf
  if (s.territories) {
    delete s.territories[id]
    if (Object.keys(s.territories).length === 0) delete s.territories
  }
  if (t.alive) dismissTerritory(s, id)
  void why
}

/** A nation is gone: territories it held are free, and its own record goes. */
export function dropTerritories(s: GameState, id: NationId) {
  for (const q of territoriesOf(s, id)) {
    freeTerritory(s, q, 'master fell')
    addLog(s, 'diplomacy', `${s.nations[q].name} is independent again: its master ${s.nations[id].name} has fallen.`, [q, id])
  }
  if (s.nations[id]?.territoryOf) {
    delete s.nations[id].territoryOf
    if (s.territories) {
      delete s.territories[id]
      if (Object.keys(s.territories).length === 0) delete s.territories
    }
  }
}

/** A master lets a territory go. */
export function releaseTerritory(s: GameState, master: NationId, id: NationId) {
  freeTerritory(s, id, 'released')
  addOpinion(s, id, master, 'Set us free', TERRITORY.releaseOpinion, 0.2)
  addLog(s, 'diplomacy', `${s.nations[master].name} set its territory ${s.nations[id].name} free.`, [master, id])
}

/** Influence to annex a territory: for every country it holds. */
export const annexTerritoryCost = (s: GameState, id: NationId): number => Math.round(EMPIRE.annexCost * Math.max(1, regionsOf(s, id).length) * TERRITORY.annexCostMult)

/** A master absorbs a territory: its land, army and treasury become the master's, its land half settled. */
export function annexTerritory(s: GameState, map: WorldMap, master: NationId, id: NationId) {
  const t = s.nations[id]
  const m = s.nations[master]
  addLog(s, 'diplomacy', `${m.name} has annexed its territory ${t.name}.`, [master, id])
  for (const k of Object.keys(t.military.units) as (keyof typeof t.military.units)[]) {
    m.military.units[k] += t.military.units[k]
    t.military.units[k] = 0
  }
  for (const a of s.armies ?? []) if (a.nationId === id) a.nationId = master
  for (const f of s.flights ?? []) if (f.nationId === id) f.nationId = master
  for (const l of s.launches ?? []) if (l.order.nationId === id) l.order.nationId = master
  for (const job of s.trainingQueue ?? []) if (job.nationId === id) job.nationId = master
  m.resources.capital += Math.max(0, t.resources.capital)
  t.resources.capital = Math.min(0, t.resources.capital)
  freeTerritory(s, id, 'annexed')
  for (const rid of Object.keys(s.regions).sort()) {
    if (s.regions[rid].owner !== id) continue
    transferRegion(s, map, rid, master, false)
    s.regions[rid].integration *= TERRITORY.annexIntegration
  }
  addInfamy(s, master, EMPIRE.annexInfamy)
}

// ---- the month -----------------------------------------------------------------------------------------------------------------------

/** A territory takes up its master's wars, whatever its own treaties say, and whatever the limit on wars is. */
function joinWars(s: GameState, id: NationId, master: NationId) {
  for (const foe of enemiesOf(s, master).sort()) {
    if (foe === id || atWar(s, id, foe) || !s.nations[foe]?.alive || s.nations[foe].territoryOf === master) continue
    territoryJoinsWar(s, id, master, foe)
  }
}

/** A territory takes its master's side in a war with `foe`. */
export function territoryJoinsWar(s: GameState, id: NationId, master: NationId, foe: NationId) {
  const pk = pairKey(id, foe)
  if (s.wars.includes(pk)) return
  s.wars.push(pk)
  s.wars.sort()
  s.warStarted[pk] = s.turn
  delete s.pacts[pk]
  s.alliances = s.alliances.filter((k) => k !== pk)
  addLog(s, 'war', `${s.nations[id].name} fights beside its master ${s.nations[master].name} against ${s.nations[foe].name}.`, [id, master, foe])
}

/** Once a month, after the economy: the cut is taken, the faction and the wars are kept in order, a territory whose master is gone is freed. */
export function runTerritoryMonth(s: GameState, map: WorldMap) {
  if (!s.territories) return
  for (const id of Object.keys(s.territories).sort()) {
    const rec = s.territories[id]
    const t = s.nations[id]
    const master = s.nations[rec.master]
    if (!t?.alive) {
      delete s.territories[id]
      continue
    }
    if (!master?.alive || t.territoryOf !== rec.master || master.overlord || master.territoryOf) {
      if (master?.alive && (master.overlord || master.territoryOf)) {
        // Its master became someone's vassal: it passes up with the rest.
        const up = master.overlord ?? master.territoryOf!
        hold(s, id, up)
        adoptTerritory(s, up, id)
        continue
      }
      freeTerritory(s, id, 'master fell')
      continue
    }
    const { revenue, cut } = cutOf(s, map, id)
    if (cut > 0) {
      t.resources.capital -= cut
      master.resources.capital += cut
    }
    rec.last = cut
    rec.revenue = revenue
    rec.taken += cut
    // The faction is the master's; a territory that was somehow left out is put back.
    if (factionOf(s, id)?.id !== factionOf(s, rec.master)?.id || !factionOf(s, id)) adoptTerritory(s, rec.master, id)
    joinWars(s, id, rec.master)
  }
  if (s.territories && Object.keys(s.territories).length === 0) delete s.territories
}

// ---- forcing a trade deal -----------------------------------------------------------------------------------------------------------

type Force = Extract<Order, { type: 'forceTrade' }>

/** Why a master may not force this deal on its territory, or null. A deal may not give the territory's goods away: it must get back at least `forceFair` of what it gives, at market prices. */
export function forceTradeProblem(s: GameState, o: Force, pending: Order[]): string | null {
  const t = typeof o.territory === 'string' ? s.nations[o.territory] : undefined
  if (!t?.alive || t.territoryOf !== o.nationId) return 'They are not your territory'
  const p = typeof o.partner === 'string' ? s.nations[o.partner] : undefined
  if (!p?.alive || o.partner === o.territory) return 'Choose a nation for it to trade with'
  if (atWar(s, o.territory, o.partner)) return `${t.name} is at war with ${p.name}`
  if (!o.terms || typeof o.terms !== 'object' || !o.terms.give || !o.terms.receive) return 'Describe the deal'
  if (pending.some((x) => x.type === 'forceTrade' && x.territory === o.territory && x.partner === o.partner)) return 'Already ordered'
  const open = s.deals.filter((d) => d.kind === 'trade' && (d.from === o.territory || d.to === o.territory)).length
  if (open >= TERRITORY.maxDeals) return `${t.name} already has ${TERRITORY.maxDeals} trade deals`
  const bad = validateTradeTerms(s, o.terms as TradeTerms, o.territory, o.partner)
  if (bad) return bad
  const prices = marketPrices(s)
  const give = bundleValue(o.terms.give, prices)
  const get = bundleValue(o.terms.receive, prices)
  if (give > 0 && get < give * TERRITORY.forceFair - 1e-9) return `A forced deal must give ${t.name} at least ${Math.round(TERRITORY.forceFair * 100)}% of what it gives, at market prices (it gives ${Math.round(give)}, gets ${Math.round(get)})`
  return null
}

// ---- counting -----------------------------------------------------------------------------------------------------------------------

/** What the master's territories count for toward its tier and the conquest goal: a share of their countries, rounded down. */
export function territoryCountWeight(s: GameState, master: NationId, held?: Map<NationId, number>): number {
  if (!s.territories) return 0
  let sum = 0
  for (const q of territoriesOf(s, master)) sum += (held?.get(q) ?? regionsOf(s, q).length) * TERRITORY.countWeight
  return Math.floor(sum)
}

/** For the news and the desk: the territory as a line. */
export const describeTerritory = (s: GameState, id: NationId): string => `${s.nations[id]?.name ?? id}, a territory of ${s.nations[s.nations[id]?.territoryOf ?? '']?.name ?? 'its master'}`
