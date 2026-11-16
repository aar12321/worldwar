import { PRESENCE, ALERT } from '../data/presence'
import { UNIT_SPECS } from '../data/unitTypes'
import { GROUND_UNITS } from '../data/deployment'
import { borderCover, garrisonDivisions } from '../engine/deployment'
import { deploymentView, hasIntel, showDivisions } from '../engine/intel'
import { atWar, forceUnits, formatDivisions } from '../engine/helpers'
import { alertOf, chokeStatus, readinessOf, showCost } from '../engine/presence'
import type { GameState, NationId, Order } from '../engine/types'
import { getWorld } from '../map/world'
import type { CardRef } from './globe/presenceLayer'

const { map } = getWorld()
const pct = (v: number) => `${Math.round(v * 100)}%`

export interface Row {
  label: string
  value: string
}

export interface Built {
  title: string
  subtitle: string
  what: string
  rows: Row[]
  orders: { order: Order; label: string; effect?: string; cost?: string }[]
  /** Where the forces are set, for a button that opens it. */
  tab?: 'deploy' | 'theatres' | 'forces' | 'wars'
}

/** What a unit card says, worked out from the live game. Pure, so the card can be tested without a browser. */
export function buildCard(game: GameState, card: CardRef): Built | null {
  const player = game.playerId
  const n = game.nations[card.nation]
  if (!n?.alive) return null
  const mine = card.nation === player
  const exact = mine || hasIntel(game, player, card.nation)
  const d = n.military.deployment
  const view = deploymentView(game, player, card.nation)
  const force = forceUnits(game, card.nation)
  const led = game.presence?.[card.nation]
  const quality = exact ? 'Exact: you have intelligence on them' : 'A rounded guess: you have no intelligence on them'
  const owner = mine ? 'Yours' : n.name
  const readiness = `${Math.round(readinessOf(d))} of 100 (${ALERT[alertOf(d)].name.toLowerCase()})`
  const recall = (patch: Partial<{ coastal: number; subs: number; air: number }>, border?: NationId): Order | null =>
    d && mine
      ? { type: 'setDeployment', nationId: player, coastal: d.coastal, subs: d.subs, air: d.air, border: border ? Object.fromEntries(Object.entries(d.border).filter(([k]) => k !== border)) : { ...d.border }, ...patch }
      : null
  const orders: Built['orders'] = []
  const push = (order: Order | null, label: string, effect?: string, cost?: string) => order && orders.push({ order, label, effect, cost })

  switch (card.kind) {
    case 'fleet':
    case 'sub': {
      const sub = card.kind === 'sub'
      const upkeep = force.naval * (sub ? d?.subs ?? 0 : d?.coastal ?? 0) * UNIT_SPECS.naval.upkeep
      if (mine) push(recall(sub ? { subs: 0 } : { coastal: 0 }), sub ? 'Recall the screen' : 'Recall the patrol', 'The ships return to the reserve and can attack again next month. Takes effect at once.')
      return {
        title: sub ? `${owner} submarine screen` : `${owner} coastal patrol`,
        subtitle: quality,
        what: sub
          ? 'Hunts for rival fleets and landings far out, learns what neighbors keep on station, and sinks part of a landing from the open sea. It cannot attack while it holds this post.'
          : 'Escorts the sea trade, holds the straits beside your coast, blockades an enemy at war and sinks part of a landing across a sea lane. It cannot attack while it holds this post.',
        rows: [
          { label: 'Strength', value: `${showDivisions(sub ? view.subs : view.coastal, exact)} divisions of warships` },
          ...(mine ? [{ label: 'Upkeep', value: `${upkeep.toFixed(1)} a month` }, { label: 'Readiness', value: readiness }, { label: 'Trade protected so far', value: String(Math.round(led?.trade ?? 0)) }] : []),
          ...(mine ? [{ label: 'Enemy trade denied', value: String(Math.round(led?.blockaded ?? 0)) }] : []),
        ],
        orders,
        tab: 'deploy',
      }
    }
    case 'air': {
      const upkeep = (force.fighter * UNIT_SPECS.fighter.upkeep + force.drone * UNIT_SPECS.drone.upkeep) * (d?.air ?? 0)
      if (mine) push(recall({ air: 0 }), 'Recall the air patrol', 'The aircraft return to the reserve. Takes effect at once.')
      return {
        title: `${owner} air patrol`,
        subtitle: quality,
        what: 'Flies a circuit over the capital: shoots down part of a missile salvo and of a landing by air, watches the neighbors from above, and counts sorties. It cannot strike while it holds this post.',
        rows: [
          { label: 'Strength', value: `${showDivisions(view.air, exact)} divisions of fighters and drones` },
          ...(mine ? [{ label: 'Upkeep', value: `${upkeep.toFixed(1)} a month` }, { label: 'Readiness', value: readiness }, { label: 'Sorties flown', value: String(Math.round(led?.sorties ?? 0)) }] : []),
        ],
        orders,
        tab: 'deploy',
      }
    }
    case 'garrison': {
      const other = card.other ?? ''
      const on = exact ? garrisonDivisions(game, card.nation, other) : (view.border[other] ?? 0)
      const share = d?.border[other] ?? 0
      const ground = GROUND_UNITS.reduce((t, k) => t + force[k], 0)
      const upkeep = GROUND_UNITS.reduce((t, k) => t + force[k] * UNIT_SPECS[k].upkeep, 0) * share
      const cov = exact ? borderCover(game, map, card.nation, other) : 0
      if (mine) {
        push(recall({}, other), `Recall the garrison`, `The troops on the ${game.nations[other]?.name ?? other} border return to the reserve.`)
        if (!atWar(game, player, other)) {
          const o: Order = { type: 'showOfForce', nationId: player, kind: 'ground', target: other }
          push(o, 'Mass troops on the border (show of force)', 'Shows strength. Raises their tension, lowers their opinion of you, trains the garrison.', `${showCost(game, o as Extract<Order, { type: 'showOfForce' }>)} money`)
        }
      }
      return {
        title: `${owner} garrison facing ${game.nations[other]?.name ?? other}`,
        subtitle: quality,
        what: 'Holds the border: it fights harder on its own post, adds to the Defense Line, blunts a surprise attack and turns back provocations. It cannot attack while it holds this post.',
        rows: [
          { label: 'Strength', value: `${showDivisions(on, exact)} divisions${ground > 0 && mine ? ` (${pct(share)} of ground forces)` : ''}` },
          ...(exact ? [{ label: 'Cover', value: `${pct(cov)} of what the border needs` }] : []),
          ...(mine ? [{ label: 'Upkeep', value: `${upkeep.toFixed(1)} a month` }, { label: 'Readiness', value: readiness }, { label: 'Incidents deterred', value: String(Math.round(led?.deterred ?? 0)) }] : []),
        ],
        orders,
        tab: 'deploy',
      }
    }
    case 'choke': {
      const c = chokeStatus(game, map).find((x) => x.id === card.id)
      if (!c) return null
      const holder = c.holder ? game.nations[c.holder] : null
      const lines = Object.entries(c.power).sort((a, b) => b[1] - a[1])
      return {
        title: c.name,
        subtitle: `${map.regions[c.a].name} and ${map.regions[c.b].name}`,
        what: `A narrow sea between two shores. The nation whose patrols are ${PRESENCE.chokeEdge} times as strong as the other shore's holds it: its sea trade is worth ${Math.round(PRESENCE.chokeValue * 100)}% more, and a fleet at war can close it to an enemy.`,
        rows: [
          { label: 'Held by', value: holder ? (holder.id === player ? 'You' : holder.name) : c.contested ? 'Contested: both shores patrol it' : 'Nobody' },
          ...lines.map(([id, p]) => ({ label: `${id === player ? 'Your' : game.nations[id]?.name} patrols here`, value: p.toFixed(1) })),
        ],
        orders: [],
        tab: 'deploy',
      }
    }
    case 'front': {
      const other = card.other ?? ''
      return {
        title: `Front: ${game.nations[card.nation]?.name} and ${game.nations[other]?.name}`,
        subtitle: 'At war',
        what: 'The border where the two sides fight. A supply line runs from your capital to it. Strong garrisons and high alert make it harder to break; a large reserve presses it.',
        rows: [{ label: 'Your garrison there', value: mine ? `${formatDivisions(garrisonDivisions(game, player, other))} divisions` : 'n/a' }],
        orders: [],
        tab: 'wars',
      }
    }
    case 'base':
      return { title: `${n.name}'s naval base`, subtitle: quality, what: 'Where the fleet is kept. A raid by sea can meet it; its patrols run from here.', rows: [{ label: 'On patrol', value: `${showDivisions(view.coastal + view.subs, exact)} divisions` }], orders: [], tab: 'theatres' }
  }
}

