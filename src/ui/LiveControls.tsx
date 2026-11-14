import { useEffect, useRef } from 'react'
import { incomingArmies } from '../engine/armies'
import { absDay, clockOf, dayDate, daysInMonth } from '../engine/calendar'
import { liveHold, useGame, type Hold } from '../store'
import { liveClock } from './liveClock'

/** The short reason, for the button itself. */
const HOLD_SHORT: Record<Hold, string> = {
  online: 'Online',
  over: 'Game over',
  event: 'Decide first',
  battle: 'Battle playing',
  report: 'Report open',
  planning: 'Planning',
  help: 'Reading',
}

const HOLD_TEXT: Record<Hold, string> = {
  online: '',
  over: 'The game is over',
  event: 'Decide first',
  battle: 'Battle playing',
  report: 'Reading the report',
  planning: 'Paused while you plan',
  help: 'Paused while you read',
}

/** The game's date, to the day. */
export function LiveDate() {
  const turn = useGame((s) => s.game?.turn ?? 1)
  const day = useGame((s) => s.game?.day ?? 0)
  return <>{dayDate(turn, day)}</>
}

/** How far through the month it is. It is drawn from the live clock directly, so a running game does not re-render it. */
export function MonthBar() {
  const ref = useRef<HTMLDivElement>(null)
  const turn = useGame((s) => s.game?.turn ?? 1)
  useEffect(() => {
    const start = absDay(turn, 0)
    const length = daysInMonth(turn)
    const draw = (t: number) => {
      if (ref.current) ref.current.style.transform = `scaleX(${Math.min(1, Math.max(0, (t - start) / length))})`
    }
    draw(liveClock.t)
    return liveClock.subscribe(draw)
  }, [turn])
  return (
    <div className="h-[3px] rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
      <div ref={ref} className="h-full origin-left bg-[#0a84ff]" style={{ transform: 'scaleX(0)' }} />
    </div>
  )
}

const Play = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
)
const Pause = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="4.5" width="4.5" height="15" rx="1" />
    <rect x="13.5" y="4.5" width="4.5" height="15" rx="1" />
  </svg>
)

const SPEEDS = [1, 2, 4] as const

/** The live game's clock: play and pause, how fast, and what is holding it. Replaces Next turn. */
export function LiveControls() {
  const running = useGame((s) => s.running)
  const speed = useGame((s) => s.settings.liveSpeed)
  const hold = useGame((s) => liveHold(s))
  const waiting = useGame((s) => s.orders.length)
  const turn = useGame((s) => s.game?.turn ?? 1)
  const day = useGame((s) => s.game?.day ?? 0)
  const note = useGame((s) => s.liveNote)
  const toggle = useGame((s) => s.togglePause)
  const setSpeed = useGame((s) => s.setSpeed)
  const openNote = useGame((s) => s.openNote)
  const left = daysInMonth(turn) - day
  const fresh = !running && !hold && turn === 1 && day === 0

  const status = hold
    ? HOLD_TEXT[hold]
    : !running
      ? fresh
        ? 'Press play to start the clock'
        : 'Paused'
      : waiting > 0
        ? `${waiting} order${waiting === 1 ? '' : 's'} on ${dayDate(turn + 1, 0)}`
        : `${left} day${left === 1 ? '' : 's'} left in the month`

  return (
    <div className="hud-next hud-live glass rounded-2xl p-2 pointer-events-auto flex flex-col gap-1.5 min-w-[196px]">
      <div className="flex items-stretch gap-1.5">
        <button className={`btn btn-primary px-3 py-2.5 flex-1 flex items-center justify-center gap-1.5 text-[15px] ${fresh ? 'pulse-cta' : ''}`} disabled={!!hold} onClick={toggle} aria-label={running ? 'Pause (Space)' : 'Play (Space)'} title={running ? 'Pause (Space)' : 'Play (Space)'}>
          {hold ? null : running ? <Pause /> : <Play />}
          <span>{hold ? HOLD_SHORT[hold] : running ? 'Pause' : 'Play'}</span>
        </button>
        <div className="flex gap-1" role="radiogroup" aria-label="Game speed">
          {SPEEDS.map((n, i) => (
            <button key={n} role="radio" aria-checked={speed === n} className={`btn px-2.5 py-2.5 text-[14px] min-w-[38px] ${speed === n ? 'btn-primary' : 'btn-quiet'}`} disabled={!!hold && hold !== 'planning' && hold !== 'help'} onClick={() => setSpeed(n)} title={`${n}× speed (${i + 1})`}>
              {n}×
            </button>
          ))}
        </div>
      </div>
      <div className="hud-live-status px-1 text-center text-[12px] text-white/70" aria-live="polite">
        {status}
      </div>
      {note && (
        <button className="hud-live-status text-[12px] text-[#6cb4ff] underline underline-offset-2" onClick={openNote}>
          Read the {dayDate(note.turn, 0).split(' ')[1]} report
        </button>
      )}
    </div>
  )
}

/** A warning when enemy armies are marching on your countries, with the time the first has left. Opens the Armies list. */
export function IncomingChip() {
  const armies = useGame((s) => s.game?.armies)
  const game = useGame((s) => s.game)
  const open = useGame((s) => s.openMilitary)
  if (!game || !armies) return null
  const mine = incomingArmies(game, game.playerId).filter((a) => a.nationId !== game.playerId)
  if (mine.length === 0) return null
  const now = clockOf(game)
  const first = Math.max(0, Math.ceil(Math.min(...mine.map((a) => a.end)) - now))
  return (
    <button className="advice-pill pointer-events-auto live-alert" onClick={() => open('armies')} title="See the armies marching on you">
      <span className="w-2 h-2 rounded-full shrink-0 bg-[#ff453a]" />
      <span className="truncate">
        {mine.length === 1 ? '1 enemy army incoming' : `${mine.length} enemy armies incoming`} · {mine.length === 1 ? '' : 'first in '}
        {first} day{first === 1 ? '' : 's'}
      </span>
      <span className="text-white/65 shrink-0">Armies ›</span>
    </button>
  )
}
