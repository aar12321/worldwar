import { UNIT_SPECS } from '../data/unitTypes'
import { absDate } from '../engine/calendar'
import { lineMax } from '../engine/economy'
import type { LiveEvent, LiveStep } from '../engine/live'
import type { BattleReport, GameState, NationId } from '../engine/types'
import { getWorld } from '../map/world'
import { battleLine, scenesFor } from './battleText'
import { useFx } from './globeBridge'

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
        const involved = b.attacker.nationId === player || b.defender.nationId === player
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
        const line = battleLine(b, game, player)
        say(line.good ? 'success' : 'error', line.text)
        break
      }
      case 'launched':
        // An army coming for you is news. The armies the AI sends at each other are not.
        if (e.army.nationId !== player && game.regions[e.army.target]?.owner === player) say('error', `${nation(e.army.nationId)} has sent an army against ${place(e.army.target)}. It arrives ${absDate(e.army.end)}.`)
        break
      case 'turnedBack':
        if (e.army.nationId === player && e.why !== 'recalled') say('info', e.why === 'peace' ? `Your army heading for ${place(e.army.target)} turned back: the war is over.` : `Your army heading for ${place(e.army.target)} turned back: it is already yours.`)
        break
      case 'home':
        if (e.army.nationId === player) say('info', `Your army is back from ${place(e.army.target)}.`)
        break
      case 'missile': {
        const target = e.flight.target
        const impact = map.regions[target]
        if (e.landed && impact) {
          useFx.getState().addRing({ lat: impact.lat, lng: impact.lng, color: '#ff9f0a', maxRadius: 2.6 }, 1600)
          if (e.flight.nationId === player) say('success', `Your missiles hit ${place(target)}.`)
          else if (game.regions[target]?.owner === player) say('error', `Missiles from ${nation(e.flight.nationId)} hit ${place(target)}.`)
        } else if (e.flight.nationId === player) say('error', `Your missiles were wasted: the war ended before they landed.`)
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

  // At most one note of each kind a day, so a busy front at 4x does not bury the screen.
  if (lines.error.length) toast(lines.error.length > 2 ? `${lines.error[0]} (and ${lines.error.length - 1} more)` : lines.error.join(' '), 'error', 6500)
  if (lines.success.length) toast(lines.success.length > 2 ? `${lines.success[0]} (and ${lines.success.length - 1} more)` : lines.success.join(' '), 'success', 5000)
  if (lines.info.length) toast(lines.info.length > 2 ? `${lines.info[0]} (and ${lines.info.length - 1} more)` : lines.info.join(' '), 'info', 4000)
  return { fxQueue: queue, recentBattles: recent, mine }
}
