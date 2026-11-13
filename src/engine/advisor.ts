import { ELECTION } from '../data/government'
import { SECTORS, SECTOR_IDS } from '../data/business'
import { TECHS } from '../data/techTree'
import { BUILDING_SPECS, UNIT_SPECS, buildingCost, weaponCost } from '../data/unitTypes'
import { MAX_WARS } from '../data/war'
import { nextWeaponLevel } from './arms'
import { computeEconomy, lineMax } from './economy'
import { cityDevelopCost } from './cities'
import { enemiesOf, hasPact, isAllied, totalUnits } from './helpers'
import { militaryPower, militarySheet } from './militaryStats'
import { validateOrder } from './orders'
import { monthsToElection } from './politics'
import type { BuildingType, GameState, Milestone, NationId, Order, RegionId, WorldMap } from './types'
import { UNIT_TYPES } from './types'
import { canAttackRegion, forecastAttack, garrisonStrength } from './warfare'
import { netWarScore } from './warscore'

/** Where an advice button takes the player. The screens turn this into a panel, tab or window. */
export type AdviceTarget =
  | { desk: 'economy'; tab: 'country' | 'budget' | 'market' | 'business' | 'government' | 'people'; region?: RegionId }
  | { desk: 'military'; tab: 'forces' | 'wars' }
  | { desk: 'research' }
  | { desk: 'diplomacy'; nation?: NationId }
  | { desk: 'warRoom'; region: RegionId }
  | { desk: 'map'; region: RegionId }

export interface Advice {
  id: string
  /** now: fix this turn. soon: trouble is coming. idea: a good use of the turn. */
  urgency: 'now' | 'soon' | 'idea'
  title: string
  detail: string
  /** Label for the button. */
  action: string
  target: AdviceTarget
  weight: number
}

const WEIGHT = { now: 300, soon: 200, idea: 100 }

/**
 * The advisor's reading of one nation's month: what is wrong, what is about to go wrong, and what would be a good move.
 * Pure, so the Briefing, the monthly report and the tests all see the same list.
 */
export function advise(s: GameState, map: WorldMap, nationId: NationId, pending: Order[] = [], limit = 6): Advice[] {
  const n = s.nations[nationId]
  if (!n?.alive) return []
  const econ = computeEconomy(s, map, nationId)
  const out: Advice[] = []
  const add = (urgency: Advice['urgency'], bonus: number, a: Omit<Advice, 'urgency' | 'weight'>) => out.push({ ...a, urgency, weight: WEIGHT[urgency] + bonus })
  const name = (id: RegionId) => map.regions[id]?.name ?? id
  const money = n.resources.capital
  const enemies = enemiesOf(s, nationId)
  const myPower = militaryPower(s, nationId)
  const myUnits = totalUnits(n.military.units)
  const capital = s.regions[n.capital]?.owner === nationId ? n.capital : Object.values(s.regions).find((r) => r.owner === nationId)?.id

  // Food
  if (n.foodShortage) {
    add('now', 90, { id: 'starving', title: 'Your people are starving', detail: 'There is no food left. The military fights 30% weaker and stability is falling. Build farms or cut the draft.', action: 'Build a farm', target: { desk: 'economy', tab: 'country', region: capital } })
  } else if (econ.netFood < 0) {
    const months = Math.max(1, Math.floor(n.resources.food / -econ.netFood))
    add(months <= 4 ? 'now' : 'soon', 60 - Math.min(40, months), {
      id: 'food',
      title: `Food runs out in ${months} ${months === 1 ? 'month' : 'months'}`,
      detail: `You eat ${(-econ.netFood).toFixed(1)} more than you grow each month. A farm adds 3.`,
      action: 'Build a farm',
      target: { desk: 'economy', tab: 'country', region: capital },
    })
  }

  // Money
  if (n.inDebt) {
    add('now', 80, { id: 'debt', title: 'The treasury is empty', detail: 'You are in debt. Stability drops every month, and after two months soldiers start to desert. Raise taxes, end a war, or build factories.', action: 'Open the budget', target: { desk: 'economy', tab: 'budget' } })
  } else if (econ.netCapital < 0) {
    const months = Math.max(1, Math.floor(money / -econ.netCapital))
    add(months <= 6 ? 'now' : 'soon', 50 - Math.min(40, months), {
      id: 'deficit',
      title: `Money runs out in ${months} ${months === 1 ? 'month' : 'months'}`,
      detail: `You spend ${(-econ.netCapital).toFixed(0)} more than you earn each month${econ.warBillTotal > 0 ? `, ${econ.warBillTotal.toFixed(0)} of it on wars` : ''}.`,
      action: 'Open the budget',
      target: { desk: 'economy', tab: 'budget' },
    })
  }

  // Materials
  if (n.oilShortage) {
    add('now', 75, { id: 'no-oil', title: 'You are out of oil', detail: 'Tanks, planes and warships fight at 60% strength until you have oil. Buy it on the market, or turn on auto-buy.', action: 'Open the market', target: { desk: 'economy', tab: 'market' } })
  } else if (econ.netOil < -0.05 && n.resources.oil < econ.oilUse * 4) {
    const months = Math.max(1, Math.floor(n.resources.oil / -econ.netOil))
    add(months <= 3 ? 'now' : 'soon', 55, { id: 'oil', title: `Oil runs out in ${months} ${months === 1 ? 'month' : 'months'}`, detail: `Your units burn ${econ.oilUse.toFixed(1)} a month and you pump ${econ.oilProduction.toFixed(1)}. Buy some, or build an energy sector.`, action: 'Open the market', target: { desk: 'economy', tab: 'market' } })
  }
  if (n.goodsShortage) {
    add('now', 65, { id: 'no-goods', title: 'The shops are empty', detail: 'People are going without goods and stability is falling. Buy goods on the market, or grow factories and manufacturing.', action: 'Open the market', target: { desk: 'economy', tab: 'market' } })
  } else if (econ.netGoods < 0 && n.resources.goods < econ.goodsUse * 3) {
    add('soon', 35, { id: 'goods', title: 'Goods are running short', detail: 'People use more than you make. Buy some, or grow manufacturing.', action: 'Open the market', target: { desk: 'economy', tab: 'market' } })
  }

  // Order at home
  if (n.stability < 35) {
    add('now', 70, { id: 'unrest', title: 'The country is close to revolt', detail: `Stability is ${Math.round(n.stability)}%. Below 30% rebels rise. See what your people are missing.`, action: 'See your people', target: { desk: 'economy', tab: 'people' } })
  } else if (econ.stabilityTarget < 40 && econ.stabilityTarget < n.stability - 3) {
    add('soon', 40, { id: 'sliding', title: 'Stability is sliding', detail: `It is ${Math.round(n.stability)}% and heading to ${Math.round(econ.stabilityTarget)}%.`, action: 'See your people', target: { desk: 'economy', tab: 'people' } })
  }
  const rebel = Object.values(s.regions)
    .filter((r) => r.owner === nationId && r.rebels > 0)
    .sort((a, b) => b.rebels - a.rebels)[0]
  if (rebel) {
    add('now', 55, { id: 'rebels', title: `Rebels in ${name(rebel.id)}`, detail: `${rebel.rebels.toFixed(1)} divisions of rebels are fighting your garrison. If they win, the country breaks away.`, action: 'Go there', target: { desk: 'map', region: rebel.id } })
  }

  // Borrowing
  if (!n.inDebt && econ.netCapital < 0 && econ.credit.room > 20 && money < -econ.netCapital * 8) {
    add('soon', 45, { id: 'borrow', title: 'You could borrow to cover the gap', detail: `You can still borrow ${Math.floor(econ.credit.room)} at ${(econ.credit.rate * 100).toFixed(2)}% a month (rating ${econ.credit.rating}). Better to fix the budget, but bonds buy time.`, action: 'Open the treasury', target: { desk: 'economy', tab: 'budget' } })
  }
  if (n.debt > 0 && n.inDebt && n.redMonths >= 1) {
    add('now', 85, { id: 'default', title: 'You are close to defaulting', detail: `You have been in the red for ${n.redMonths} month${n.redMonths === 1 ? '' : 's'} with ${Math.round(n.debt)} in bonds outstanding. At 3 you default and nobody will lend to you for two years.`, action: 'Open the budget', target: { desk: 'economy', tab: 'budget' } })
  }
  // An election
  const election = monthsToElection(s, nationId)
  if (election !== null && election <= 6 && n.stability < ELECTION.needed + 8) {
    add('soon', 52, { id: 'election', title: `An election is ${election === 0 ? 'this month' : `${election} months away`}`, detail: `Stability is ${Math.round(n.stability)}% and you need ${ELECTION.needed}% to win. Lower taxes or spend more on health.`, action: 'Open Government', target: { desk: 'economy', tab: 'government' } })
  }

  // Offers on the table
  const answered = new Set(pending.filter((o) => o.type === 'respond').map((o) => (o as { proposalId: string }).proposalId))
  const offers = s.proposals.filter((p) => p.to === nationId && !answered.has(p.id))
  if (offers.length > 0) {
    const first = offers[0]
    add('now', 30, {
      id: 'offers',
      title: offers.length === 1 ? `${s.nations[first.from]?.name ?? 'A nation'} is waiting for an answer` : `${offers.length} offers are waiting for an answer`,
      detail: 'Offers expire if you ignore them, and the sender remembers.',
      action: 'Read them',
      target: { desk: 'diplomacy', nation: first.from },
    })
  }

  // Wars
  const fresh = n.military.exposed < 0.95 && myUnits >= 0.1
  if (enemies.length > 0) {
    // The front that is closest to breaking.
    let best: { id: RegionId; frac: number; line: number; max: number } | null = null
    for (const r of Object.values(s.regions)) {
      if (!enemies.includes(r.owner) || !canAttackRegion(s, map, nationId, r.id).ok) continue
      const max = lineMax(s, map, r.id)
      const frac = Math.min(1, r.line / max)
      if (!best || frac < best.frac) best = { id: r.id, frac, line: Math.min(r.line, max), max }
    }
    if (best && fresh) {
      const f = forecastAttack(s, map, nationId, best.id, 'allin', 'assault', 6)
      const cracked = best.frac < 0.99
      if (f && f.winChance >= 0.5) {
        add(cracked ? 'now' : 'idea', cracked ? 45 : 70, {
          id: 'press',
          title: cracked ? `${name(best.id)}'s line is cracked` : `${name(best.id)} can be attacked`,
          detail: `Its Defense Line is at ${best.line.toFixed(1)} of ${best.max.toFixed(1)}${cracked ? ' and heals every quiet month' : ''}. Your odds are ${f.label.toLowerCase()}.`,
          action: 'Open the War Room',
          target: { desk: 'warRoom', region: best.id },
        })
      } else if (f) {
        add('soon', 35, {
          id: 'outgunned',
          title: `You cannot break ${name(best.id)} yet`,
          detail: `Even with everything you have, the odds are ${Math.round(f.winChance * 100)}%. Train more units, buy weapons, or make peace.`,
          action: 'Open Military',
          target: { desk: 'military', tab: 'forces' },
        })
      }
    }
    const threat = enemies.map((e) => ({ e, power: militaryPower(s, e) })).sort((a, b) => b.power - a.power)[0]
    if (threat && threat.power > myPower * 1.25) {
      add('now', 50, {
        id: 'threat',
        title: `${s.nations[threat.e].name} is stronger than you`,
        detail: `Their strength is ${threat.power.toFixed(0)} against your ${myPower.toFixed(0)}, and you are at war. Train units now or offer peace.`,
        action: 'Talk peace',
        target: { desk: 'diplomacy', nation: threat.e },
      })
    }
    if (n.warWeariness > 25) {
      const easiest = [...enemies].sort((a, b) => netWarScore(s, nationId, b) - netWarScore(s, nationId, a))[0]
      add('soon', 30, {
        id: 'weary',
        title: 'Your people are tired of war',
        detail: `War weariness is ${n.warWeariness.toFixed(0)} and it drags stability down. ${s.nations[easiest].name} is the war you are winning most.`,
        action: 'Talk peace',
        target: { desk: 'diplomacy', nation: easiest },
      })
    }
  }

  // Military upkeep of the basics
  const sheet = militarySheet(s, nationId)
  const freeSlots = sheet.trainingSlots - sheet.trainingUsed
  const cheapest = UNIT_TYPES.filter((u) => validateOrder(s, map, { type: 'queueTrain', nationId, unit: u }, pending) === null)
  if (freeSlots > 0 && cheapest.length > 0 && econ.netCapital > 2) {
    const atWar = enemies.length > 0
    add(atWar ? 'soon' : 'idea', atWar ? 25 : 40, {
      id: 'train',
      title: `${freeSlots} training ${freeSlots === 1 ? 'slot is' : 'slots are'} empty`,
      detail: `You can afford ${cheapest.map((u) => UNIT_SPECS[u].name.toLowerCase()).join(', ')}. A bigger military wins wars and deters them.`,
      action: 'Train units',
      target: { desk: 'military', tab: 'forces' },
    })
  }
  if (!n.military.commanderId && n.generals.length > 0 && myUnits > 0) {
    add('idea', 30, { id: 'commander', title: 'No commander is appointed', detail: 'A commander drills your least-trained units every month for free.', action: 'Appoint one', target: { desk: 'military', tab: 'forces' } })
  }
  const weapon = UNIT_TYPES.filter((u) => n.military.units[u] >= 1 && nextWeaponLevel(s, nationId, u).error === null && money >= weaponCost(n.military.weapons[u]) * 1.5).sort(
    (a, b) => n.military.units[b] - n.military.units[a],
  )[0]
  if (weapon) {
    add('idea', 20, { id: 'weapons', title: `Better weapons for your ${UNIT_SPECS[weapon].name.toLowerCase()}`, detail: `A weapon level adds 6% attack and defense to every ${UNIT_SPECS[weapon].name.toLowerCase()} unit, for good.`, action: 'Open Military', target: { desk: 'military', tab: 'forces' } })
  }

  // Research
  const queued = pending.some((o) => o.type === 'research')
  if (!queued) {
    const tech = TECHS.filter((t) => validateOrder(s, map, { type: 'research', nationId, techId: t.id }, pending) === null).sort((a, b) => a.cost - b.cost)[0]
    if (tech) add('idea', 50, { id: 'research', title: `You can research ${tech.name}`, detail: `You have ${Math.floor(n.resources.tp)} research. ${tech.description}`, action: 'Open Research', target: { desk: 'research' } })
  }

  // Cities and business
  if (money > 150 && econ.netCapital >= 0) {
    const grow = Object.values(s.regions)
      .filter((r) => r.owner === nationId)
      .flatMap((r) => r.cities.map((c) => ({ r, c })))
      .filter(({ r, c }) => validateOrder(s, map, { type: 'developCity', nationId, regionId: r.id, cityId: c.id }, pending) === null && cityDevelopCost(c) * 1.5 <= money)
      .sort((a, b) => a.c.level - b.c.level)[0]
    if (grow) add('idea', 38, { id: 'city', title: `${grow.c.name} could grow`, detail: `A bigger city adds workers and strengthens its ${grow.c.focus} focus. It costs ${cityDevelopCost(grow.c)}.`, action: 'Open Cities', target: { desk: 'economy', tab: 'country', region: grow.r.id } })
  }
  if (money > 250 && econ.netCapital > 5 && !n.inDebt) {
    const weakest = SECTOR_IDS.map((id) => ({ id, size: n.sectors[id] ?? 0 })).sort((a, b) => a.size - b.size)[0]
    if (weakest) add('idea', 28, { id: 'business', title: `Back your ${SECTORS[weakest.id].name.toLowerCase()} sector`, detail: `It is your smallest industry at ${weakest.size.toFixed(1)}. A grant of 100 makes it ${SECTORS[weakest.id].yields.replace('+', 'produce ')}.`, action: 'Open Business', target: { desk: 'economy', tab: 'business' } })
  }

  // Growth
  if (capital && econ.netCapital >= 0) {
    const options: BuildingType[] = econ.netFood < 1 ? ['farm'] : ['factory', 'university', 'farm', 'barracks', 'civic']
    const pick = options.find((b) => validateOrder(s, map, { type: 'build', nationId, regionId: capital, building: b }, pending) === null)
    if (pick && money >= buildingCost(pick, s.regions[capital].buildings[pick]) * 1.3) {
      add('idea', 45 + Math.min(30, money / 20), {
        id: 'build',
        title: `You have ${Math.floor(money)} money to invest`,
        detail: `A ${BUILDING_SPECS[pick].name.toLowerCase()} costs ${buildingCost(pick, s.regions[capital].buildings[pick])}. ${BUILDING_SPECS[pick].effect}`,
        action: 'Upgrade the country',
        target: { desk: 'economy', tab: 'country', region: capital },
      })
    }
  }

  // Expansion
  if (enemies.length === 0 && myUnits >= 1) {
    let target: { region: RegionId; owner: NationId; ratio: number } | null = null
    for (const r of Object.values(s.regions)) {
      const owner = r.owner
      if (owner === nationId || !s.nations[owner]?.alive || isAllied(s, nationId, owner) || hasPact(s, nationId, owner)) continue
      if (!canAttackRegion(s, map, nationId, r.id).ok) continue
      const defense = militaryPower(s, owner) + garrisonStrength(s, map, r.id) * 1.2
      const ratio = myPower / Math.max(0.5, defense)
      if (!target || ratio > target.ratio) target = { region: r.id, owner, ratio }
    }
    if (target && target.ratio >= 1.3) {
      add('idea', 35, {
        id: 'expand',
        title: `${name(target.region)} is your weakest neighbor`,
        detail: `You are about ${target.ratio.toFixed(1)} times as strong as ${s.nations[target.owner].name}. Declaring war costs influence, and every war has a monthly bill.`,
        action: 'Look at it',
        target: { desk: 'map', region: target.region },
      })
    } else if (target) {
      add('idea', 10, { id: 'grow', title: 'No neighbor is weak enough yet', detail: 'Build factories for income, then train a larger military before you pick a fight.', action: 'Open Military', target: { desk: 'military', tab: 'forces' } })
    }
  }
  if (enemies.length >= MAX_WARS) {
    add('soon', 5, { id: 'maxwars', title: `You are fighting ${MAX_WARS} wars`, detail: 'That is the most a country can fight at once. Each one bills you monthly.', action: 'See your wars', target: { desk: 'military', tab: 'wars' } })
  }

  out.sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1))
  return out.slice(0, limit)
}

/** First-game goals, ticked off from what the nation has actually done. */
export const OBJECTIVES: { id: Milestone; title: string; how: string; target: AdviceTarget }[] = [
  { id: 'build', title: 'Upgrade your country', how: 'Open Economy and buy a factory or a farm.', target: { desk: 'economy', tab: 'country' } },
  { id: 'train', title: 'Train a unit', how: 'Open Military and train infantry, tanks or planes.', target: { desk: 'military', tab: 'forces' } },
  { id: 'research', title: 'Research a technology', how: 'Open Research and pick one you can afford.', target: { desk: 'research' } },
  { id: 'war', title: 'Declare war on a neighbor', how: 'Click a country on the globe, then Declare war.', target: { desk: 'military', tab: 'wars' } },
  { id: 'win', title: 'Win a battle', how: 'Plan an attack in the War Room and push the Defense Line back.', target: { desk: 'military', tab: 'wars' } },
  { id: 'capture', title: 'Capture a country', how: 'Keep attacking until the Defense Line reaches zero.', target: { desk: 'military', tab: 'wars' } },
]
