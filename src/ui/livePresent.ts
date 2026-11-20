import { useFxPrefs } from '../fx/settings'
import { PROPOSAL_LABELS, UNIT_SPECS } from '../data/unitTypes'
import { absDate } from '../engine/calendar'
import { lineMax } from '../engine/economy'
import { guessDivisions, hasIntel, showDivisions } from '../engine/intel'
import { totalUnits } from '../engine/helpers'
import type { LiveEvent, LiveStep } from '../engine/live'
import type { Army, BattleReport, Dispatch, GameState, NationId, Order, Proposal, WorldMap } from '../engine/types'
import { offerIsMoot } from '../engine/offers'
import { validateOrder } from '../engine/orders'
import { getWorld } from '../map/world'
import { battleLine, scenesFor } from './battleText'
import { useFx } from './globeBridge'
import { landedEffect, missileName } from './missileText'
import { salvoLine } from './missileWarText'
import { programNews } from '../engine/missileProgram'

type Tone = 'info' | 'error' | 'success'

export interface LivePresented {
  /** The battle window's queue, with any new battles of the player's that are to play there. */
  fxQueue: BattleReport[]
  /** The player's last battles, newest first. */
  recentBattles: BattleReport[]
  /** The player's battles in this step, for the month's report. */
  mine: BattleReport[]
}

interface Args {
  step: LiveStep
  player: NationId
  /** The game before the step, to see who held a country then. */
  before: GameState
  fxQueue: BattleReport[]
  recentBattles: BattleReport[]
  settings: { battleScenes: 'all' | 'mine' | 'off'; pauseOnBattles: boolean; reducedMotion: boolean }
  toast: (text: string, tone: Tone, ms?: number) => void
}

const LOG_SIZE = 12

/** Why an army turned back, finishing "Your army heading for X turned back: ...". */
export const TURN_BACK: Partial<Record<NonNullable<Army['outcome']>, string>> = {
  peace: 'the war is over',
  taken: 'it is already yours',
  changed: 'another nation holds it now',
  cut: 'the country it set out from was lost, so it could not be supplied',
}

/** Rings and a shake where a fight happens, one burst for each round. */
function battleFx(b: BattleReport, mine: boolean, color: string, reduced: boolean) {
  const place = getWorld().map.regions[b.regionId]
  if (!place) return
  const fx = useFx.getState()
  const burst = (i: number) => {
    const damage = b.rounds[i] ? b.rounds[i].attackerDamage + b.rounds[i].defenderDamage : 1
    fx.addRing({ lat: place.lat, lng: place.lng, color: i === 2 ? '#ff2d95' : '#ffb340', maxRadius: 2 + Math.min(4, damage / 3) }, 1400)
  }
  const rounds = Math.max(1, Math.min(4, b.rounds.length))
  if (reduced) burst(0)
  else for (let i = 0; i < rounds; i++) setTimeout(() => burst(i), i * 350)
  if (b.captured) setTimeout(() => fx.addRing({ lat: place.lat, lng: place.lng, color, maxRadius: 3.4 }, 2000), reduced ? 0 : rounds * 350)
  if (mine && !reduced) fx.shake(b.captured ? 1.0 : 0.55)
}

/**
 * Turns a day's events into what the player sees: a few merged toasts, effects on the globe, and the player's own battles,
 * which go to the battle window only when "Pause on my battles" is on.
 */
export function presentLiveStep({ step, player, before, fxQueue, recentBattles, settings, toast }: Args): LivePresented {
  const { map } = getWorld()
  const game = step.state
  const lines: Record<Tone, string[]> = { info: [], error: [], success: [] }
  const say = (tone: Tone, text: string) => lines[tone].push(text)
  const place = (id: string) => map.regions[id]?.name ?? id
  const nation = (id: string) => game.nations[id]?.name ?? before.nations[id]?.name ?? id
  const mine: BattleReport[] = []
  let queue = fxQueue
  let recent = recentBattles

  for (const e of step.events as LiveEvent[]) {
    switch (e.kind) {
      case 'battle': {
        const b = e.report
        // A bloc's joint operation fights under its lead member's flag: the others who sent divisions fought it too.
        const joint = b.attacker.nationId === player ? null : jointShare(game, b.id, player)
        const involved = b.attacker.nationId === player || b.defender.nationId === player || !!joint
        battleFx(b, involved, game.nations[player]?.color ?? '#fff', settings.reducedMotion)
        if (!involved) break
        mine.push(b)
        recent = [b, ...recent].slice(0, LOG_SIZE)
        const max = lineMax(game, map, b.regionId)
        useFx.getState().addBattle(
          { id: b.id, lat: map.regions[b.regionId].lat, lng: map.regions[b.regionId].lng, place: place(b.regionId), before: b.lineBefore ?? max, after: b.lineAfter ?? max, max: b.lineMax ?? max, captured: b.captured, attackerWon: b.winner === 'attacker', mine: true },
          settings.reducedMotion ? 3500 : 5200,
        )
        // The country keeps its old color until the bar has drained and the verdict is in.
        if (b.captured && !settings.pauseOnBattles) {
          const old = before.nations[b.defender.nationId]?.color
          if (old) useFx.getState().hold(b.regionId, old, settings.reducedMotion ? 0 : 1500)
        }
        if (settings.pauseOnBattles) {
          const scene = scenesFor(settings.battleScenes, player, [b])
          queue = [...queue, ...scene]
        }
        const line = joint ? jointLine(joint, place(b.regionId)) : battleLine(b, game, player)
        say(line.good ? 'success' : 'error', line.text)
        break
      }
      case 'launched':
        // An army coming for you is news. The armies the AI sends at each other are not.
        if (e.army.nationId !== player && game.regions[e.army.target]?.owner === player) say('error', `${nation(e.army.nationId)} has sent an army against ${place(e.army.target)}. It arrives ${absDate(e.army.end)}.`)
        break
      case 'turnedBack':
        if (e.army.nationId === player && e.why !== 'recalled') say(e.why === 'cut' ? 'error' : 'info', `Your army heading for ${place(e.army.target)} turned back: ${TURN_BACK[e.why] ?? 'its reason to fight is gone'}.`)
        break
      case 'home':
        if (e.army.nationId === player) say('info', `Your army is back from ${place(e.army.target)}.`)
        break
      case 'missile': {
        const target = e.flight.target
        const impact = map.regions[target]
        const kind = e.flight.kind ?? 'hypersonic'
        // "4 cruise missiles" / "1 hypersonic missile": the kind and the number, so a retaliation is plain to read.
        const salvo = `${e.flight.count} ${missileName(kind, e.flight.count)}`
        if (e.landed && impact) {
          // The salvo's own report says what stopped it and what got through; without one (an old save) the short line stands.
          const rep = [...(game.salvos ?? [])].reverse().find((r) => r.weapon === 'missile' && r.from === e.flight.nationId && r.region === target)
          const detail = rep ? salvoLine(rep, (id) => (id === player ? 'You' : nation(id))) : null
          if (e.flight.nationId === player) say('success', detail ?? `Your ${salvo} hit ${place(target)}: ${landedEffect(kind)}.`)
          else if (game.regions[target]?.owner === player) say('error', `${detail ?? `${nation(e.flight.nationId)} struck ${place(target)} with ${salvo}: ${landedEffect(kind)}.`} Answer from the Missile War tab.`)
        } else if (e.flight.nationId === player) say('error', `Your ${salvo} were wasted: ${e.why === 'taken' ? `${place(target)} was already yours when they landed` : e.why === 'changed' ? `${place(target)} changed hands before they landed` : 'the war ended before they landed'}.`)
        break
      }
      case 'nukeLaunched': {
        if (e.flight.nationId === player) break
        if (e.flight.foe === player) say('error', `ALERT: ${nation(e.flight.nationId)} has launched a nuclear missile at ${place(e.flight.target)}. It lands ${absDate(e.flight.lands)}. Offer peace now: a war that ends first calls it off.`)
        else say('info', `${nation(e.flight.nationId)} has launched a nuclear missile at ${place(e.flight.target)}.`)
        break
      }
      case 'nuke': {
        const target = e.flight.target
        const impact = map.regions[target]
        const victim = e.flight.foe
        if (e.landed && impact) {
          // The whole world sees it: rings that reach across the globe and a long shake.
          const fx = useFx.getState()
          if (useFxPrefs.getState().quality === 'off') for (let i = 0; i < 3; i++) fx.addRing({ lat: impact.lat, lng: impact.lng, color: i === 1 ? '#ffffff' : '#ff2d95', maxRadius: 8 + i * 3 }, 2600 + i * 500)
          if (!settings.reducedMotion && useFxPrefs.getState().quality === 'off') fx.shake(1.5)
          if (e.flight.nationId === player) say('error', `Your missile destroyed ${place(target)}. The world's strongest powers are at war with you.`)
          else if (victim === player) say('error', `NUCLEAR STRIKE: ${nation(e.flight.nationId)} destroyed ${place(target)}.`)
          else say('error', `${nation(e.flight.nationId)} used a nuclear weapon on ${place(target)}. The world is in shock.`)
        } else if (e.flight.nationId === player) say('info', `Your nuclear missile did not land: ${e.why === 'taken' ? `${place(target)} was already yours` : e.why === 'changed' ? `${place(target)} changed hands` : 'the war ended first'}.`)
        else if (victim === player) say('success', `The nuclear missile aimed at ${place(target)} was called off: ${e.why === 'peace' ? 'the war ended' : 'the target changed'}.`)
        break
      }
      case 'contact': {
        // Early warning: the patrols of a nation that watches its waters sight a landing force the day it sets out.
        if (e.watcher !== player) break
        const exact = hasIntel(game, player, e.army.nationId)
        const size = totalUnits(e.army.units)
        const seen = showDivisions(exact ? size : guessDivisions(game, player, e.army.nationId, 'contact', size), exact)
        const impact = map.regions[e.army.target]
        if (impact) useFx.getState().addRing({ lat: impact.lat, lng: impact.lng, color: '#64d2ff', maxRadius: 3.4 }, 2200)
        say('error', `Your patrols sighted ${nation(e.army.nationId)}'s landing force (${seen} divisions) heading for ${place(e.army.target)}. It arrives ${absDate(e.army.end)}. Your patrols should sink about ${Math.round(e.expected * 100)}% of it.`)
        break
      }
      case 'intercept': {
        const impact = map.regions[e.place]
        if (impact) useFx.getState().addRing({ lat: impact.lat, lng: impact.lng, color: '#64d2ff', maxRadius: 3 }, 1800)
        if (e.by === player) say('success', `Your patrols intercepted ${nation(e.against)}'s landing on ${place(e.place)} and sank ${e.sunk.toFixed(1)} divisions of it.`)
        else if (e.against === player) say('error', `${nation(e.by)}'s patrols intercepted your landing on ${place(e.place)}: ${e.sunk.toFixed(1)} divisions were lost at sea.`)
        break
      }
      case 'trained': {
        const mineJobs = e.jobs.filter((j) => j.nationId === player)
        if (mineJobs.length === 0) break
        const counts = new Map<string, number>()
        for (const j of mineJobs) counts.set(j.unit, (counts.get(j.unit) ?? 0) + 1)
        const text = [...counts].map(([unit, n]) => `${n} ${UNIT_SPECS[unit as keyof typeof UNIT_SPECS]?.name ?? unit}`).join(', ')
        say('info', `Training finished: ${text} joined your military.`)
        const capital = map.regions[game.nations[player]?.capital ?? '']
        if (capital) useFx.getState().addPop({ lat: capital.lat, lng: capital.lng, text: `+${text}` }, settings.reducedMotion ? 2600 : 2400)
        break
      }
    }
  }

  // The missile program: a facility opened, a project ready for its test, a test that worked or failed, staff poached.
  for (const n of programNews(before, game, player)) say(n.tone, n.text)

  // At most one note of each kind a day, so a busy front at 4x does not bury the screen.
  if (lines.error.length) toast(lines.error.length > 2 ? `${lines.error[0]} (and ${lines.error.length - 1} more)` : lines.error.join(' '), 'error', 6500)
  if (lines.success.length) toast(lines.success.length > 2 ? `${lines.success[0]} (and ${lines.success.length - 1} more)` : lines.success.join(' '), 'success', 5000)
  if (lines.info.length) toast(lines.info.length > 2 ? `${lines.info[0]} (and ${lines.info.length - 1} more)` : lines.info.join(' '), 'info', 4000)
  return { fxQueue: queue, recentBattles: recent, mine }
}

/**
 * Live games with friends: a friend's warlike order, in one line as this player should hear it ("Germany declared war on you!"),
 * red when it is aimed at this player. Null for orders that are not worth interrupting for.
 */
export function friendLine(after: GameState, order: Order): OrderNews | null {
  const { map } = getWorld()
  const me = after.playerId
  const who = after.nations[order.nationId]?.name ?? order.nationId
  const place = (id: string) => map.regions[id]?.name ?? id
  const mine = (region: string) => after.regions[region]?.owner === me
  switch (order.type) {
    case 'declareWar':
      return order.target === me ? { text: `${who} declared war on you!`, tone: 'error' } : { text: `${who} declared war on ${after.nations[order.target]?.name ?? order.target}.`, tone: 'info' }
    case 'attack': {
      const army = [...(after.armies ?? [])].reverse().find((a) => a.nationId === order.nationId && a.target === order.target)
      const when = army ? ` It arrives ${absDate(army.end)}.` : ''
      return mine(order.target) ? { text: `${who} is marching on ${place(order.target)}.${when}`, tone: 'error' } : { text: `${who} sent an army against ${place(order.target)}.${when}`, tone: 'info' }
    }
    case 'strike':
      return { text: `${who} fired missiles at ${place(order.target)}.`, tone: mine(order.target) ? 'error' : 'info' }
    case 'raid':
      return { text: `${who} sent bombers against ${place(order.target)}.`, tone: mine(order.target) ? 'error' : 'info' }
    case 'nuke':
      return { text: `${who} launched a nuclear missile at ${place(order.target)}!`, tone: 'error' }
    case 'recall':
      return { text: `${who} called an army back.`, tone: 'info' }
    default:
      return null
  }
}

/** This player's part in the joint operation that fought battle `battleId`, if their bloc ran it and they sent divisions. */
export function jointShare(game: GameState, battleId: string, player: NationId): { bloc: string; won: boolean; captured: boolean; sent: number; lost: number } | null {
  for (const f of game.factions ?? []) {
    if (!f.members.includes(player)) continue
    const r = f.bloc?.ops?.find((o) => o.result?.battleId === battleId)?.result
    const mine = r?.members[player]
    if (r && mine) return { bloc: f.name, won: r.won, captured: r.captured, sent: mine.sent, lost: mine.lost }
  }
  return null
}

/** The line for a member of a joint operation who did not lead it. */
export function jointLine(j: NonNullable<ReturnType<typeof jointShare>>, place: string): { text: string; good: boolean } {
  const how = j.captured ? `took ${place}` : j.won ? `won the battle for ${place}` : `was repulsed at ${place}`
  return { text: `${j.bloc}'s joint operation ${how}. You sent ${j.sent.toFixed(1)} divisions and ${j.lost < 0.05 ? 'lost none' : `lost ${j.lost.toFixed(1)}`}.`, good: j.won }
}

/** Answers are written for the side that asked ("Germany accepted your invitation"): the one who answered is not shown its own answer. */
const REPLIES = new Set<Dispatch['kind']>(['accepted', 'rejected', 'joined', 'ignored'])

/** Whether a diplomatic note is this player's news: sent to them, or their own act told in the third person (never their own answer). */
export const newsFor = (d: Dispatch, player: NationId) => d.to === player || (d.from === player && !REPLIES.has(d.kind))

/** How a diplomatic note reads: good news green, bad news red. */
export const DISPATCH_TONE: Record<Dispatch['kind'], 'info' | 'error' | 'success'> = {
  proposal: 'info',
  accepted: 'success',
  joined: 'success',
  completed: 'success',
  rejected: 'error',
  ignored: 'error',
  broken: 'error',
  expired: 'error',
}

export interface OrderNews {
  text: string
  tone: 'info' | 'error' | 'success'
  /** Who sent an offer that waits for this player's answer (the toast then has a button to answer it). */
  open?: NationId
}

/**
 * Live games with friends: the notes an order brought this player, on the day it happened. A friend's offer waits for an
 * answer, a rival's answer to this player's offer comes back at once, and an offer this player sent to a friend is on its way.
 * Only notes the order itself added (same month) count; the month's end has its own summary.
 */
export function orderNews(before: GameState | null, after: GameState, own: boolean, order?: Order, map: WorldMap = getWorld().map): OrderNews[] {
  if (!before || before.turn !== after.turn) return []
  const player = after.playerId
  const name = (id: NationId) => after.nations[id]?.name ?? id
  const fresh = after.dispatches.slice(before.dispatches.length).filter((d) => newsFor(d, player))
  const out: OrderNews[] = []
  // A Clear on an offer that became impossible (both already allied, say) is a tidy-up, not a snub: it reads as one.
  const cleared = clearedOffer(before, map, order)
  for (const d of fresh) {
    if (cleared && d.kind === 'rejected' && d.from === cleared.to && d.to === cleared.from && d.proposalKind === cleared.kind) {
      out.push({ text: `${name(d.from)} cleared ${name(d.to)}'s ${PROPOSAL_LABELS[cleared.kind].toLowerCase()} offer: it was no longer possible (${cleared.why.charAt(0).toLowerCase()}${cleared.why.slice(1)}).`, tone: 'info' })
    } else if (d.kind === 'proposal' && d.from === player) {
      if (own) out.push({ text: `Offer sent to ${name(d.to)}. They answer from their Diplomacy desk.`, tone: 'success' })
    } else if (d.kind === 'proposal' && d.to === player) out.push({ text: d.text, tone: 'info', open: d.from })
    else out.push({ text: d.text, tone: DISPATCH_TONE[d.kind] })
  }
  return out.slice(-3)
}

/** The offer a `respond` order turned down because it could no longer be accepted, with the reason, or null. */
function clearedOffer(before: GameState, map: WorldMap, order?: Order): { from: NationId; to: NationId; kind: Proposal['kind']; why: string } | null {
  if (!order || order.type !== 'respond' || order.accept) return null
  const p = before.proposals.find((x) => x.id === order.proposalId)
  if (!p || !offerIsMoot(before, map, p)) return null
  const why = validateOrder(before, map, { type: 'respond', nationId: p.to, proposalId: p.id, accept: true }) ?? ''
  return { from: p.from, to: p.to, kind: p.kind, why }
}
