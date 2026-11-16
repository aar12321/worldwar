import { MW, rungOf } from '../data/missileWar'
import { MISSILES } from '../data/missiles'
import { airReach } from '../engine/aircraft'
import { enemiesOf } from '../engine/helpers'
import { freeUnits } from '../engine/deployment'
import { buildRoom, launchSite, missileKinds, missileStock, programLevel } from '../engine/missiles'
import { doctrineOf, interceptorCap, interceptorsOf, ledgerOf, radarLevel, raidBase, tensionOf, trucePair } from '../engine/missileWar'
import type { GameState, Nation, NationId, Order, SalvoReport, WorldMap } from '../engine/types'
import { flightsFor } from './missileFx'

/** Plain words for the missile war: the war's status, the next steps, and a readable line for every salvo. Pure, so they are tested. */

export interface WarStatus {
  tension: number
  rung: number
  rungName: string
  incoming: number
  outgoing: number
  /** Millions killed by you and lost to the enemy, and the exchange ratio (killed per lost, null with nothing lost yet). */
  killed: number
  lost: number
  exchange: number | null
  shotDown: number
  hits: number
  fired: number
  lineDealt: number
  lineTaken: number
  trucesWith: NationId[]
}

export function warStatus(game: GameState, player: Nation): WarStatus {
  const led = ledgerOf(player)
  const tension = tensionOf(game)
  const rung = rungOf(tension)
  const trucesWith = enemiesOf(game, player.id).filter((e) => trucePair(game, player.id, e) !== null)
  return {
    tension,
    rung,
    rungName: MW.ladder[rung].name,
    incoming: flightsFor(game, player.id, 'incoming').length,
    outgoing: flightsFor(game, player.id, 'outgoing').length,
    killed: led.killed,
    lost: led.lost,
    exchange: led.lost > 0.001 ? led.killed / led.lost : null,
    shotDown: led.shotDown,
    hits: led.hits,
    fired: led.fired,
    lineDealt: led.lineDealt,
    lineTaken: led.lineTaken,
    trucesWith,
  }
}

export interface Step {
  id: string
  /** What to do, in a sentence, and why. */
  text: string
  /** The order that does it, if one button does. */
  order?: Order
  /** Where to go to do it, if it takes choosing. */
  go?: 'program' | 'systems' | 'warroom' | 'deploy' | 'war'
  /** The country to open the War Room on. */
  target?: string
  tone: 'urgent' | 'do' | 'idea'
}

/**
 * The next things worth doing in the missile war, most pressing first. It replaces "invest and wait": each line is something to press
 * now, with the reason. At most `limit` are shown.
 */
export function nextSteps(game: GameState, map: WorldMap, player: Nation, live: boolean, limit = 6): Step[] {
  const out: Step[] = []
  const id = player.id
  const foes = enemiesOf(game, id).filter((e) => game.nations[e]?.alive)
  const level = programLevel(player)
  const incoming = flightsFor(game, id, 'incoming')
  const money = player.resources.capital
  const stock = missileKinds(player).reduce((sum, k) => sum + missileStock(player, k), 0)
  const theirs = Math.max(0, ...foes.map((e) => Object.values(game.nations[e].arsenal ?? {}).reduce((a, b) => a + b, 0) + game.nations[e].military.units.missile))
  if (live && incoming.length && player.military.units.fighter >= 0.5) {
    const f = incoming.find((x) => !x.scrambled)
    if (f) out.push({ id: 'scramble', text: `A salvo of ${f.count} is on its way. Scramble your fighters against it.`, order: { type: 'scramble', nationId: id, flightId: f.id }, tone: 'urgent' })
  }
  if (incoming.length && interceptorCap(player) > 0 && interceptorsOf(player) < Math.min(interceptorCap(player), incoming.reduce((sum, f) => sum + f.count, 0) * 1.2)) {
    const room = interceptorCap(player) - interceptorsOf(player)
    if (room >= 1) out.push({ id: 'rounds-now', text: `The incoming salvo asks for more rounds than the store holds (${interceptorsOf(player)} of ${interceptorCap(player)}). Restock now.`, order: { type: 'missileDefense', nationId: id, item: 'interceptors', count: Math.min(room, MW.roundsMaxOrder) }, tone: 'urgent' })
  }
  if (foes.length && level === 0 && stock === 0) out.push({ id: 'program', text: 'You are at war and have no missiles. Raise the missile program to level 1 to build cruise missiles.', go: 'program', tone: 'do' })
  if (foes.length && level >= 1 && buildRoom(player, game.turn) > 0 && stock < 6 && money > 100) out.push({ id: 'build', text: `You have ${stock} missiles in store and room to build ${buildRoom(player, game.turn)} this month.`, go: 'program', tone: 'do' })
  if (foes.length && stock >= 1) {
    // A target in reach: the first enemy country a launch site reaches.
    const anyKind = missileKinds(player).find((k) => missileStock(player, k) >= 1)
    const target = anyKind && Object.values(game.regions).find((r) => foes.includes(r.owner) && launchSite(game, map, id, r.id, anyKind))
    if (target) out.push({ id: 'launch', text: `${stock} missiles are ready, and ${map.regions[target.id].name} is in reach. Open the War Room to fire.`, go: 'warroom', target: target.id, tone: 'do' })
  }
  if (foes.length && theirs >= 4 && (freeUnits(game, id).air >= 0.25 || stock >= 3)) out.push({ id: 'counterforce', text: `An enemy holds about ${Math.round(theirs)} missiles. Counterforce (aim at launch sites) or a bomber raid destroys the store before it is used.`, go: 'warroom', tone: 'do' })
  if (foes.length && radarLevel(player) < 1 && money > MW.radarMoney[0]) out.push({ id: 'radar', text: 'No early-warning radar: you will not see a salvo until it lands. Level 1 shows them the day they leave.', order: { type: 'missileDefense', nationId: id, item: 'radar' }, tone: 'do' })
  if (interceptorCap(player) > 0 && interceptorCap(player) - interceptorsOf(player) >= 4) {
    const room = interceptorCap(player) - interceptorsOf(player)
    out.push({ id: 'rounds', text: `The interceptor store is at ${interceptorsOf(player)} of ${interceptorCap(player)} rounds. A shield with no rounds stops nothing.`, order: { type: 'missileDefense', nationId: id, item: 'interceptors', count: Math.min(room, MW.roundsMaxOrder) }, tone: 'do' })
  }
  if (foes.length && (player.systems?.shield ?? 0) < 1 && theirs >= 3) out.push({ id: 'shield', text: 'An enemy has missiles and you have no Interceptor Shield. Raise one under Systems.', go: 'systems', tone: 'do' })
  if (foes.length && doctrineOf(player) === 'hold' && stock >= 3) out.push({ id: 'doctrine', text: 'Your doctrine is Hold fire. A Retaliate doctrine answers a strike on its own.', order: { type: 'setDoctrine', nationId: id, doctrine: 'retaliate' }, tone: 'idea' })
  if (player.military.deployment === undefined && foes.length && player.military.units.fighter >= 1) out.push({ id: 'patrol', text: 'Post fighters on air patrol (Deployment): patrols are already aloft when a salvo arrives.', go: 'deploy', tone: 'idea' })
  if (foes.length && tensionOf(game) >= MW.truceTension[1]) {
    const e = foes.find((x) => !game.humans.includes(x) && trucePair(game, id, x) === null)
    if (e) out.push({ id: 'truce', text: `World tension is ${Math.round(tensionOf(game))} (${MW.ladder[rungOf(tensionOf(game))].name}). Offer ${game.nations[e].name} a missile ceasefire.`, order: { type: 'missileTruce', nationId: id, target: e }, tone: 'idea' })
  }
  const rank = { urgent: 0, do: 1, idea: 2 }
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, limit)
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** One salvo or raid in plain words: what left, what stopped it, what got through and what it did. */
export function salvoLine(r: SalvoReport, names: (id: NationId) => string): string {
  const who = names(r.from)
  const what = r.weapon === 'raid' ? `${r.fired.toFixed(1)} bomber divisions` : `${r.fired} ${MISSILES[r.kind ?? 'cruise'].name.toLowerCase()}${r.fired === 1 ? '' : 's'}`
  const stops = [r.shield > 0.005 && `shield ${pct(r.shield)}`, r.batteries > 0.005 && `batteries ${pct(r.batteries)}`, r.fighters > 0.005 && `fighters ${pct(r.fighters)}`, r.patrol > 0.005 && `patrols ${pct(r.patrol)}`].filter(Boolean)
  const hit = r.weapon === 'raid' ? `${r.hit.toFixed(1)} divisions got through` : `${r.hit} of ${r.fired} got through`
  const out = [r.dead >= 0.05 && `${r.dead.toFixed(1)}M dead`, r.line >= 0.05 && `line -${r.line.toFixed(1)}`, r.stock >= 0.1 && `${r.stock.toFixed(1)} missiles destroyed in store`, r.site && 'launch site shut', r.buildings > 0 && `${r.buildings} buildings`, r.aircraftLost >= 0.05 && `${r.aircraftLost.toFixed(2)} aircraft lost`].filter(Boolean)
  return `${who}${r.auto ? ' (answering)' : ''}: ${what} at ${r.place}${r.aim === 'site' ? ' (launch sites)' : ''}. ${stops.length ? `Stopped by ${stops.join(', ')}. ` : ''}${hit}${out.length ? `: ${out.join(', ')}` : ''}.${r.scrambled ? ' Fighters were scrambled.' : ''}${r.coverage < 0.999 ? ' The shield ran short of rounds.' : ''}`
}

/** Whether a raid could even take off for a target: used to explain a disabled button. */
export function raidReach(game: GameState, map: WorldMap, player: Nation, target: string): string | null {
  if (!raidBase(game, map, player.id, target)) return `Out of range: bombers reach ${Math.round(airReach(player))} km from a country with a factory`
  if (freeUnits(game, player.id).air < MW.raid.minBombers) return 'Needs strike aircraft at home'
  return null
}
