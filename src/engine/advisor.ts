import { agencyName } from '../data/agencies'
import { ELECTION } from '../data/government'
import { SECTORS, SECTOR_IDS } from '../data/business'
import { MISSILES, MISSILE_TYPES } from '../data/missiles'
import { TECHS } from '../data/techTree'
import { BUILDING_SPECS, UNIT_SPECS, buildingCost, weaponCost } from '../data/unitTypes'
import { nextWeaponLevel } from './arms'
import { incomingArmies } from './armies'
import { absDate, clockOf, isLive } from './calendar'
import { COALITION } from '../data/coalition'
import { NUCLEAR } from '../data/nuclear'
import { activePlans, strikeDate, strikeMonth, threatOf } from './coalition'
import { nuclearThreats } from './nuclear'
import { computeEconomy, lineMax } from './economy'
import { cityDevelopCost } from './cities'
import { enemiesOf, hasPact, isAllied, maxWars, totalUnits } from './helpers'
import { factionOf, votesWaiting } from './factions'
import { homePower, militaryPower, militarySheet } from './militaryStats'
import { fundMissilesCost, launchSite, missileStock, programLevel, recentAttackers } from './missiles'
import { validateOrder } from './orders'
import { spaceAdvice } from './space'
import { monthsToElection } from './politics'
import { ACADEMY, PROJECT_LEVELS, PROJECTS, programCost } from '../data/projects'
import { TIERS } from '../data/empire'
import { empireCount, tierOf } from './empire'
import { academyCost, activeProjects, levelCost, levelMonths, projectLevel, projectProblem } from './industry'
import { campaignPrice, campaignProblem } from './society'
import { activeLocal, localLevel, localProblem } from './works'
import { electionNeed } from './people'
import type { BuildingType, GameState, Milestone, NationId, Order, ProjectId, RegionId, WorldMap } from './types'
import { UNIT_TYPES } from './types'
import { threatWatch } from './threats'
import { canAttackRegion, forecastAttack, garrisonStrength } from './warfare'
import { netWarScore } from './warscore'

/** The parts of the People tab. */
export type PeopleSection = 'overview' | 'health' | 'learning' | 'work' | 'family' | 'safety' | 'campaigns'

/** Where an advice button takes the player. The screens turn this into a panel, tab or window. */
export type AdviceTarget =
  | { desk: 'economy'; tab: 'country' | 'people' | 'budget' | 'bank' | 'business' | 'projects' | 'market' | 'stocks' | 'government' | 'space'; region?: RegionId; /** Which part of the People tab. */ section?: PeopleSection }
  | { desk: 'empire'; tab: 'overview' | 'provinces' | 'world' | 'reaction' }
  | { desk: 'military'; tab: 'forces' | 'deploy' | 'wars' | 'agencies' | 'systems' | 'armies' }
  | { desk: 'research' }
  | { desk: 'diplomacy'; nation?: NationId }
  | { desk: 'faction' }
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

  // Live games: armies marching on you, and what you can still do about them.
  for (const army of incomingArmies(s, nationId).filter((a) => a.nationId !== nationId)) {
    // The date, not a countdown: the advice is worked out on quiet days only, and a date stays true while the clock runs.
    const days = Math.max(0, Math.ceil(army.end - clockOf(s)))
    const home = totalUnits(n.military.units)
    const theirs = totalUnits(army.units)
    add('now', 120 - Math.min(60, days * 6), {
      id: `incoming-${army.id}`,
      title: `${s.nations[army.nationId]?.name ?? 'An enemy'} is marching on ${name(army.target)}`,
      detail: `${theirs.toFixed(1)} divisions arrive on ${absDate(Math.ceil(army.end))}, against ${home.toFixed(1)} at home. Call your armies back, raise a shield, fire missiles, or offer peace: they answer within a day.`,
      action: 'See the armies',
      target: { desk: 'military', tab: 'armies' },
    })
  }

  // Active military: a rival that can reach you with nobody watching, and forces that have never been stationed.
  const watch = threatWatch(s, map, nationId)
  const danger = watch.find((x) => x.level === 'high')
  if (danger) {
    add('now', 95, { id: `watch-${danger.nation}-${danger.route}`, title: `${s.nations[danger.nation]?.name ?? 'A rival'} can reach you and the way in is not guarded`, detail: danger.text, action: 'Post forces', target: { desk: 'military', tab: 'deploy' } })
  } else if (!n.military.deployment && myUnits >= 3 && (watch.length > 0 || enemies.length > 0)) {
    add('idea', 36, { id: 'station-forces', title: 'Station your forces', detail: 'Nothing of yours is on patrol or guarding a border, so a rival that strikes first meets no garrison and no patrols. Post part of your fleet, air force and troops, and keep the rest in reserve to attack with.', action: 'Open Deployment', target: { desk: 'military', tab: 'deploy' } })
  }

  // Struck with missiles lately: answer in kind if you can, or build the means. The same goes for turn and live games.
  for (const attackerId of recentAttackers(s, n, 2)) {
    const ago = s.turn - (n.struckBy?.[attackerId] ?? s.turn)
    const foe = s.nations[attackerId]?.name ?? 'An enemy'
    const stocked = MISSILE_TYPES.filter((k) => missileStock(n, k) >= 1)
    // The country that took the most damage to answer at: the foe's strongest line that one of your missiles reaches.
    const answer = Object.values(s.regions)
      .filter((r) => r.owner === attackerId && map.regions[r.id])
      .sort((a, b) => b.line - a.line || (a.id < b.id ? -1 : 1))
      .find((r) => stocked.some((k) => launchSite(s, map, nationId, r.id, k)))
    const urgency = ago <= 1 ? 'now' : 'soon'
    if (answer) {
      const held = stocked.map((k) => `${missileStock(n, k)} ${MISSILES[k].name.toLowerCase()}${missileStock(n, k) === 1 ? '' : 's'}`).join(', ')
      add(urgency, 85 - ago * 10, {
        id: `struck-${attackerId}`,
        title: `${foe} struck you with missiles`,
        detail: `You hold ${held}. Answer from the War Room: ${name(answer.id)} is in range${(n.systems?.shield ?? 0) < 1 && n.techs.includes('frontier_missile_defense') ? ', and an Interceptor Shield would stop part of what comes next' : ''}.`,
        action: 'Answer in the War Room',
        target: { desk: 'warRoom', region: answer.id },
      })
    } else {
      const level = programLevel(n)
      const cost = fundMissilesCost(n)
      const afford = level < 3 && money >= cost.capital && n.resources.tp >= cost.tp
      add(urgency, 80 - ago * 10, {
        id: `struck-${attackerId}`,
        title: `${foe} struck you with missiles`,
        detail:
          stocked.length > 0
            ? `You hold missiles but none reach ${foe} from a country with a factory. Build in range, or raise the missile program for longer reach.`
            : level === 0
              ? `You have none to answer with. Raise the missile program (${cost.capital} money, ${cost.tp} research) to build cruise missiles${(n.systems?.shield ?? 0) < 1 && n.techs.includes('frontier_missile_defense') ? ', and buy an Interceptor Shield to stop part of theirs' : ''}.`
              : afford
                ? `You have none left. Build more from the program, or raise it to level ${level + 1} for ${cost.capital} money and ${cost.tp} research.`
                : `You have none left. Build more from the program.`,
        action: level === 0 || afford ? 'Open the program' : 'Build missiles',
        target: { desk: 'military', tab: 'systems' },
      })
    }
  }

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
    add('now', 70, { id: 'unrest', title: 'The country is close to revolt', detail: `Stability is ${Math.round(n.stability)}%. Below 30% rebels rise. See what is pulling it down, then pick a lever: lower taxes, programs for calm, a celebration.`, action: 'See why', target: { desk: 'economy', tab: 'people', section: 'overview' } })
  } else if (econ.stabilityTarget < 40 && econ.stabilityTarget < n.stability - 3) {
    add('soon', 40, { id: 'sliding', title: 'Stability is sliding', detail: `It is ${Math.round(n.stability)}% and heading to ${Math.round(econ.stabilityTarget)}%. See what is pulling it down.`, action: 'See why', target: { desk: 'economy', tab: 'people', section: 'overview' } })
  }
  // Care for the people: programs for calm, and a celebration when it is needed now.
  if (n.stability < 55 && econ.society.bill === 0 && econ.netCapital > 10 && money > 150 && n.resources.pp >= 5) {
    add('idea', 38, { id: 'calm-programs', title: 'Spend on calm', detail: `Stability is ${Math.round(n.stability)}%. Festivals, fair wages and community policing buy calm for a few coins a month each. Look under Safety and Work.`, action: 'Open Safety', target: { desk: 'economy', tab: 'people', section: 'safety' } })
  }
  if (n.stability < 45 && !campaignProblem(n, 'celebration') && money > campaignPrice(s, n, 'celebration') + 100) {
    add('idea', 41, { id: 'celebration', title: 'A national celebration would steady the country', detail: `It costs ${campaignPrice(s, n, 'celebration')} money and lifts stability at once and for six months.`, action: 'Open Campaigns', target: { desk: 'economy', tab: 'people', section: 'campaigns' } })
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
  const need = Math.round(electionNeed(n, ELECTION.needed))
  if (election !== null && election <= 6 && n.stability < need + 8) {
    add('soon', 52, { id: 'election', title: `An election is ${election === 0 ? 'this month' : `${election} months away`}`, detail: `Stability is ${Math.round(n.stability)}% and you need ${need}% to win. Lower taxes, or spend on pensions, housing and health. Unemployment raises the bar.`, action: 'Open Government', target: { desk: 'economy', tab: 'government' } })
  }

  // The people: staffing, health, schools, jobs, epidemics
  const cov = econ.coverage
  if (econ.buildings.factory > 0 && cov.engineers < 0.9) {
    add(cov.engineers < 0.7 ? 'now' : 'soon', 48, { id: 'engineers', title: 'Your factories are short of engineers', detail: `They are ${Math.round(cov.engineers * 100)}% staffed, so factories run at ${Math.round(econ.factoryStaff * 100)}%. Switch the schools to an Engineering focus, or raise school spending.`, action: 'Open People', target: { desk: 'economy', tab: 'people' } })
  }
  if (econ.buildings.university > 0 && cov.scientists < 0.9) {
    add('soon', 36, { id: 'scientists', title: 'Your universities are short of scientists', detail: `They run at ${Math.round(econ.researchStaff * 100)}%. A Science focus and university-level schools raise more.`, action: 'Open People', target: { desk: 'economy', tab: 'people' } })
  }
  if (econ.buildings.hospital > 0 && cov.doctors < 0.9) {
    add('soon', 34, { id: 'doctors', title: 'Your hospitals lack doctors', detail: `Hospitals only help when doctors staff them (${Math.round(cov.doctors * 100)}% now). A Medicine focus trains more.`, action: 'Open People', target: { desk: 'economy', tab: 'people' } })
  }
  if (n.people.epidemic > 0.05) {
    add('now', 78, { id: 'epidemic', title: 'An epidemic is spreading', detail: `Severity ${Math.round(n.people.epidemic * 100)}%. It costs lives, output and calm. ${n.programs.quarantine ? 'The quarantine is helping.' : 'A quarantine ends it sooner, at a price.'}`, action: 'Open People', target: { desk: 'economy', tab: 'people' } })
  } else if (!n.programs.quarantine) {
    const sick = new Set<NationId>()
    for (const r of Object.values(s.regions)) {
      if (r.owner !== nationId) continue
      for (const nb of map.regions[r.id]?.neighbors ?? []) {
        const o = s.regions[nb]?.owner
        if (o && o !== nationId && (s.nations[o]?.people?.epidemic ?? 0) > 0.2) sick.add(o)
      }
    }
    if (sick.size > 0) add('soon', 42, { id: 'epidemic-near', title: 'An epidemic next door', detail: `${[...sick].map((id) => s.nations[id].name).join(', ')} ${sick.size === 1 ? 'has' : 'have'} an epidemic on your border. A quarantine makes it far less likely to cross.`, action: 'Open People', target: { desk: 'economy', tab: 'people' } })
  }
  if (n.people.unemployment > 0.1) {
    add(n.people.unemployment > 0.18 ? 'now' : 'soon', 44, { id: 'jobs', title: `${Math.round(n.people.unemployment * 100)}% of people are out of work`, detail: 'The jobless pay no tax and are angry. More factories and farms, lower interest rates and generous jobless support help.', action: 'Open People', target: { desk: 'economy', tab: 'people' } })
  }
  if (n.people.health < 0.4) {
    add('soon', 40, { id: 'health', title: 'Your people are unwell', detail: `Health is ${Math.round(n.people.health * 100)}%: shorter lives, fewer children, weaker soldiers. Spend on health, build hospitals, research Sanitation.`, action: 'Open People', target: { desk: 'economy', tab: 'people' } })
  }
  if (n.people.schooling < 0.35 && econ.netCapital > 2) {
    add('idea', 30, { id: 'schools', title: 'Few of your people are schooled', detail: 'Schools lift every skill, and research with them.', action: 'Open People', target: { desk: 'economy', tab: 'people' } })
  }

  // Money and the bank
  if (n.bank.inflation > 6) {
    add(n.bank.inflation > 12 ? 'now' : 'soon', 56, { id: 'inflation', title: `Prices are rising ${n.bank.inflation.toFixed(1)}% a year`, detail: `Inflation eats ${Math.round((1 - econ.realIncome) * 100)}% of income and costs stability. ${tierOf(n).rate ? 'Raise the interest rate and stop printing.' : 'Stop printing and bring down war spending; a Regional power can raise rates.'}`, action: 'Open the Bank', target: { desk: 'economy', tab: 'bank' } })
  }
  if (n.bank.currency < 0.8) {
    add('soon', 38, { id: 'currency', title: 'Your currency is weak', detail: `At ${n.bank.currency.toFixed(2)}, imports cost more. It follows high inflation, war, sanctions and weak credit.`, action: 'Open the Bank', target: { desk: 'economy', tab: 'bank' } })
  }
  const dueSoon = n.bonds.filter((b) => !b.war && b.due - s.turn <= 1 && b.due >= s.turn)
  if (dueSoon.length > 0) {
    const sum = dueSoon.reduce((a, b) => a + b.amount, 0)
    add(money < sum && econ.credit.room < sum ? 'now' : 'soon', 46, { id: 'bonds-due', title: `${Math.round(sum)} in bonds come due ${dueSoon[0].due <= s.turn ? 'this month' : 'next month'}`, detail: econ.credit.room >= sum ? 'Lenders would roll them over. If your credit slips, they must be paid from the treasury.' : 'Lenders may not roll them over, so they would come out of the treasury.', action: 'Open the Bank', target: { desk: 'economy', tab: 'bank' } })
  }
  if (enemies.length > 0 && money < 60 && n.stability >= 40 && n.bank.warBonds < econ.gross) {
    add('idea', 32, { id: 'war-bonds', title: 'Sell war bonds', detail: 'People will lend to their country in wartime at a low rate, and each issue calms the streets a little.', action: 'Open the Bank', target: { desk: 'economy', tab: 'bank' } })
  }
  if (tierOf(n).wealthFund && money > 600 && enemies.length === 0) {
    add('idea', 22, { id: 'fund', title: 'Put spare money to work', detail: 'A wealth fund earns the world rate plus the exchange\'s gains, and lifts your credit.', action: 'Open the Bank', target: { desk: 'economy', tab: 'bank' } })
  }

  // Projects, research programs, the academy
  const slots = tierOf(n).projectSlots
  if (activeProjects(n).length < slots && econ.netCapital > 8 && money > 200) {
    const open = (Object.keys(PROJECTS) as (keyof typeof PROJECTS)[]).find((id) => !n.projects[id] && projectProblem(s, map, n, id) === null)
    if (open) add('idea', 33, { id: 'project', title: `You can start the ${PROJECTS[open].name.toLowerCase()}`, detail: `${PROJECTS[open].effect} It takes about ${PROJECTS[open].months} months and ${PROJECTS[open].cost} money.`, action: 'Open Projects', target: { desk: 'economy', tab: 'projects' } })
    else {
      // Everything open is built: the next level of something is the next best use of the money.
      const up = (Object.keys(PROJECTS) as ProjectId[]).find((id) => projectLevel(n, id) === 1 && projectProblem(s, map, n, id) === null && money > levelCost(id, 2) * 1.5)
      if (up) add('idea', 27, { id: 'project-up', title: `Build up the ${PROJECTS[up].name.toLowerCase()}`, detail: `A second level is worth ${PROJECT_LEVELS.power[2]} times the first. It takes about ${levelMonths(up, 2)} months and ${levelCost(up, 2)} money.`, action: 'Open Projects', target: { desk: 'economy', tab: 'projects' } })
    }
  }
  // Projects in the countries it holds: a cultural centre for land still settling.
  if (activeLocal(s, nationId).length < tierOf(n).localSlots && money > 150 && econ.netCapital > 6) {
    const loose = Object.values(s.regions)
      .filter((r) => r.owner === nationId && r.integration < 0.7 && localLevel(r, 'culturalCentre') === 0 && !r.works?.culturalCentre)
      .sort((a, b) => a.integration - b.integration || (a.id < b.id ? -1 : 1))[0]
    if (loose && localProblem(s, map, n, 'culturalCentre', loose.id) === null) {
      add('idea', 34, { id: 'cultural-centre', title: `A cultural centre would settle ${name(loose.id)} faster`, detail: 'Conquered land produces little until it settles. A cultural centre there makes it settle half again as fast, and rebels rarer.', action: 'Open Projects', target: { desk: 'economy', tab: 'projects', region: loose.id } })
    }
  }
  const techLeft = TECHS.some((t) => !n.techs.includes(t.id) && t.requires.every((r) => n.techs.includes(r)))
  if (!techLeft && n.resources.tp >= programCost(Math.min(n.research2.productivity, 9))) {
    add('idea', 31, { id: 'programs', title: 'Spare research has somewhere to go', detail: 'Future programs raise output, health or weapons a little with every level.', action: 'Open Research', target: { desk: 'research' } })
  }
  if (n.academy < tierOf(n).academyMax && n.people.schooling >= (ACADEMY.schooling[n.academy] ?? 1) && money > academyCost(n) + 100 && myUnits >= 3) {
    add('idea', 24, { id: 'academy', title: 'Expand the military academy', detail: 'Recruits join already drilled, and drill and combined arms improve.', action: 'Open Military', target: { desk: 'military', tab: 'forces' } })
  }

  // The empire
  if (econ.admin.over > 0.5) {
    add(econ.admin.over > 3 ? 'now' : 'soon', 50, { id: 'admin', title: 'Your empire is stretched thin', detail: `Your officials can run ${econ.admin.capacity.toFixed(0)} countries' worth and you ask ${econ.admin.load.toFixed(0)} of them. Stability -${econ.admin.stability.toFixed(0)}, output -${Math.round(econ.admin.output * 100)}%. Civic halls, governors, regional capitals and digital government help.`, action: 'Open the Empire', target: { desk: 'empire', tab: 'provinces' } })
  }
  const count = empireCount(s, nationId)
  const nextTier = TIERS.find((t) => t.id === tierOf(n).id + 1)
  if (nextTier && nextTier.countries - count === 1) {
    add('idea', 26, { id: 'next-tier', title: `One more country makes you a ${nextTier.name}`, detail: 'A bigger empire opens new powers: bank, projects, wealth fund, laws and more.', action: 'See what it opens', target: { desk: 'empire', tab: 'overview' } })
  }
  if (tierOf(n).regionalCapitals > n.regionalCapitals.length && econ.admin.load > econ.admin.capacity * 0.8) {
    add('idea', 27, { id: 'regional-capital', title: 'Name a regional capital', detail: 'A regional capital carries no administration load and settles nearby land faster.', action: 'Open the Empire', target: { desk: 'empire', tab: 'provinces' } })
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

  // Factions: votes waiting on you, invitations, and a faction army with no war to fight.
  const waiting = votesWaiting(s, nationId, pending)
  if (waiting.length > 0) {
    const { faction, proposal } = waiting[0]
    const left = Math.max(0, proposal.expires - s.turn) + 1
    add('now', 40, {
      id: 'faction-vote',
      title: proposal.kind === 'war' ? `${faction.name} votes on war with ${s.nations[proposal.target!]?.name ?? 'a country'}` : `${faction.name} votes on a supply contract`,
      detail: `${waiting.length > 1 ? `${waiting.length} votes need you. ` : ''}${s.nations[proposal.by]?.name ?? 'A member'} put it forward. It is decided when the month ends or earlier if the count is settled, and at the latest in ${left} month${left === 1 ? '' : 's'}.`,
      action: 'Vote',
      target: { desk: 'faction' },
    })
  }
  const invite = (s.factions ?? []).find((f) => !factionOf(s, nationId) && f.invites.some((i) => i.nation === nationId && i.expires >= s.turn))
  if (invite && !pending.some((o) => o.type === 'factionJoin')) {
    add('soon', 25, { id: 'faction-invite', title: `${invite.name} invited you`, detail: 'Members pool money, materials and soldiers and vote on wars together. You can leave later and take back your share.', action: 'See the invitation', target: { desk: 'faction' } })
  }

  // Quantum Codebreaking: where an enemy could strike next month, and how likely it is to work.
  const quantum = n.systems?.quantum ?? 0
  if (quantum > 0 && enemies.length > 0) {
    const threats: { region: RegionId; enemy: NationId; chance: number }[] = []
    for (const e of enemies) {
      for (const r of Object.values(s.regions)) {
        if (r.owner !== nationId || !canAttackRegion(s, map, e, r.id).ok) continue
        const f = forecastAttack(s, map, e, r.id, 'main', 'assault', 8)
        if (f && f.winChance >= 0.45) threats.push({ region: r.id, enemy: e, chance: f.winChance })
      }
    }
    threats.sort((a, b) => b.chance - a.chance || (a.region < b.region ? -1 : 1))
    const shown = threats.slice(0, quantum === 1 ? 1 : quantum === 2 ? 2 : 5)
    if (shown.length > 0) {
      const top = shown[0]
      add('soon', 45, {
        id: 'quantum-threat',
        title: `Intercepted: ${s.nations[top.enemy]?.name ?? 'an enemy'} could take ${name(top.region)}`,
        detail: `Quantum Codebreaking reads their plans: about ${Math.round(top.chance * 100)}% to win there next month${shown.length > 1 ? `, and ${shown.length - 1} more front${shown.length > 2 ? 's' : ''} at risk` : ''}. Reinforce it, or strike first.`,
        action: 'See the country',
        target: { desk: 'map', region: top.region },
      })
    }
  }

  // Nuclear missiles on their way to your countries, in a live game: the one warning that matters more than any other.
  for (const f of s.nukes ?? []) {
    if (s.regions[f.target]?.owner !== nationId || f.nationId === nationId) continue
    add('now', 300 - Math.min(40, Math.max(0, f.lands - clockOf(s)) * 4), {
      id: `incoming-nuke-${f.id}`,
      title: `A nuclear missile from ${s.nations[f.nationId]?.name ?? 'an enemy'} is heading for ${name(f.target)}`,
      detail: `It lands on ${absDate(Math.ceil(f.lands))}. An Interceptor Shield stops only a part of it. Peace before it lands calls it off: offer terms now, and bring what you can out of the country.`,
      action: 'Offer peace',
      target: { desk: 'diplomacy', nation: f.nationId },
    })
  }
  // An enemy that holds the bomb.
  const bombers = nuclearThreats(s, nationId)
  if (bombers.length > 0) {
    const who = s.nations[bombers[0]]?.name ?? 'An enemy'
    add('soon', 80, {
      id: 'enemy-bomb',
      title: `${who} has a nuclear warhead and is at war with you`,
      detail: `A desperate or provoked Hard rival may use it${isLive(s) ? `; you would get ${NUCLEAR.flightDays} days of warning` : ''}. A shield stops only a quarter of it. The surest defense is peace, or sparing it a reason.`,
      action: 'See the war',
      target: { desk: 'diplomacy', nation: bombers[0] },
    })
  }

  // The world is watching a growing power: a joint strike being prepared, or rising alarm.
  if (n.tier >= 2) {
    const plan = activePlans(s, nationId)[0]
    if (plan) {
      const left = Math.max(0, strikeMonth(s, plan) - s.turn)
      add(left <= 1 ? 'now' : 'soon', 95 - left * 10, {
        id: 'coalition-plan',
        title: `${plan.members.length} rivals plan to strike you together${left === 0 ? ' this month' : ` in ${left} month${left === 1 ? '' : 's'}`}`,
        detail: `${plan.members.map((m) => s.nations[m]?.name ?? m).join(', ')} will attack ${name(plan.focus[0])} and your other weak borders on the same ${isLive(s) ? `day (${strikeDate(s, plan)})` : 'month'}. Strengthen those borders, offer pacts, or break their treaty before it comes.`,
        action: 'See the world\'s reaction',
        target: { desk: 'empire', tab: 'reaction' },
      })
    } else {
      const threat = threatOf(s, map, nationId, { output: false })
      if (threat.pressure >= COALITION.planFrom) {
        add('soon', 25 + Math.round(threat.pressure * 20), {
          id: 'coalition-alarm',
          title: `The world is ${threat.level >= 3 ? 'uniting against you' : 'alarmed by your growth'}`,
          detail: `Your threat is ${Math.round(threat.score)} of 100 (${threat.levelName.toLowerCase()}). Rivals are drawing together and may strike first. Pacts, aid and a better reputation calm them.`,
          action: 'See the world\'s reaction',
          target: { desk: 'empire', tab: 'reaction' },
        })
      }
    }
  }

  // Idle agencies
  if (n.agencies.foreign.level >= 1 && s.turn >= 3 && !pending.some((o) => o.type === 'operation')) {
    add('idea', 4, { id: 'agencies', title: `${agencyName(n.name, 'foreign')} has teams with nothing to do`, detail: 'Gather intelligence on a rival, build a case for war, or quietly weaken an enemy. Operations show their odds first.', action: 'Open the agencies', target: { desk: 'military', tab: 'agencies' } })
  }

  // Trouble in the world that you could answer
  const answeredCrises = new Set(pending.filter((o) => o.type === 'crisisAction').map((o) => (o as { crisisId: string }).crisisId))
  const open = s.crises.find((c) => c.stage >= 1 && c.nation !== nationId && c.rival !== nationId && !c.answered.includes(nationId) && !answeredCrises.has(c.id))
  if (open) {
    const who = s.nations[open.nation]?.name ?? 'A nation'
    add('soon', 20, {
      id: 'crisis',
      title: open.kind === 'unrest' ? `Unrest in ${who}` : `${s.nations[open.rival ?? '']?.name ?? 'A neighbor'} threatens ${who}`,
      detail: open.stage >= 2 ? 'It is on the brink. Help now, or watch it boil over. Taking a side is remembered.' : 'Trouble is building in the news. A friendly hand now may stop it.',
      action: 'See the crisis',
      target: { desk: 'diplomacy', nation: open.nation },
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
    if (weakest) add('idea', 28, { id: 'business', title: `Back your ${SECTORS[weakest.id].name.toLowerCase()} sector`, detail: `It is your smallest industry, at size ${weakest.size.toFixed(1)}. A grant makes it bigger, and each size it grows adds ${SECTORS[weakest.id].yields.replace(/^\+/, '')}.`, action: 'Open Business', target: { desk: 'economy', tab: 'business' } })
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
      const defense = homePower(s, owner) + garrisonStrength(s, map, r.id) * 1.2
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
  if (enemies.length >= maxWars(s, nationId)) {
    add('soon', 5, { id: 'maxwars', title: `You are fighting ${enemies.length} wars`, detail: 'That is the most a country can fight at once. Each one bills you monthly.', action: 'See your wars', target: { desk: 'military', tab: 'wars' } })
  }

  // The space program: samples waiting, worlds to claim, outposts running dry.
  if (n.space) for (const a of spaceAdvice(s, n, econ.workforce)) add(a.urgency, a.bonus, { id: a.id, title: a.title, detail: a.detail, action: a.action, target: a.target })

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
