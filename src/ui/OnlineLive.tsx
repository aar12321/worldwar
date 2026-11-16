import { daysInMonth } from '../engine/calendar'
import type { LiveSpeed } from '../net/protocol'
import { useGame } from '../store'
import { OnlinePeople } from './Online'
import { clockLine, syncLine } from './onlineLiveText'

const SPEEDS: LiveSpeed[] = [1, 2, 4]

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

const TONE = { ok: '#30d158', warn: '#ffd60a', bad: '#ff453a', info: 'rgba(255,255,255,0.7)' } as const

/** The live game with friends: one shared clock, who holds it, and whether this screen is in step with the host. */
export function OnlineLiveControls() {
  const online = useGame((s) => s.online)
  const turn = useGame((s) => s.game?.turn ?? 1)
  const day = useGame((s) => s.game?.day ?? 0)
  const over = useGame((s) => (s.game?.outcome ?? 'playing') !== 'playing')
  const control = useGame((s) => s.online?.lobby?.settings.liveControl ?? 'host')
  const toggle = useGame((s) => s.togglePause)
  const setSpeed = useGame((s) => s.setSpeed)
  const note = useGame((s) => s.liveNote)
  const openNote = useGame((s) => s.openNote)
  if (!online) return null
  const clock = online.clock
  const running = !!clock?.running
  const speed = clock?.speed ?? 1
  const mayAct = online.host || control === 'vote'
  const left = daysInMonth(turn) - day
  const line = clockLine(clock, online, left)
  const sync = syncLine(online.live, online.connection, online.host)
  const pending = online.live?.pending ?? 0
  const askLabel = (base: string) => (mayAct ? base : `Ask: ${base}`)
  const fresh = !running && (clock?.why === 'start' || !clock?.by)

  return (
    <div className="hud-next hud-live glass rounded-2xl p-2 pointer-events-auto flex flex-col gap-1.5 min-w-[196px] max-w-[260px]" data-testid="online-live">
      <div className="flex items-center justify-between gap-2 px-1 max-sm:flex-col max-sm:items-start max-sm:justify-center max-sm:gap-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] text-[#ff6961]" aria-label="Live game">
          <span className="inline-block w-2 h-2 rounded-full bg-[#ff453a]" aria-hidden="true" />
          LIVE
        </span>
        <span className="text-[11px] text-white/60 tracking-[0.12em] max-sm:hidden">Room {online.code}</span>
        <span className="sm:hidden inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TONE[sync.tone] }} role="img" aria-label={sync.text} title={sync.text} data-testid="sync-dot" />
      </div>
      <div className="flex items-stretch gap-1.5">
        <button
          className={`btn btn-primary px-3 py-2.5 flex-1 flex items-center justify-center gap-1.5 text-[15px] ${fresh && online.host ? 'pulse-cta' : ''}`}
          disabled={over}
          onClick={toggle}
          aria-label={running ? 'Pause (Space)' : 'Play (Space)'}
          title={mayAct ? (control === 'vote' ? 'Everyone here must agree (more than half)' : 'You are the host') : 'Only the host sets the clock: this asks them'}
        >
          {running ? <Pause /> : <Play />}
          <span>{over ? 'Game over' : running ? askLabel('Pause') : askLabel('Play')}</span>
        </button>
        <div className="flex gap-1" role="radiogroup" aria-label="Game speed">
          {SPEEDS.map((n, i) => (
            <button key={n} role="radio" aria-checked={speed === n} className={`btn px-2.5 py-2.5 text-[14px] min-w-[38px] ${speed === n ? 'btn-primary' : 'btn-quiet'}`} disabled={over} onClick={() => setSpeed(n)} title={`${n}× speed (${i + 1})${mayAct ? '' : ': asks the host'}`}>
              {n}×
            </button>
          ))}
        </div>
      </div>
      <div className="hud-live-status px-1 text-center text-[12px] font-medium" style={{ color: TONE[line.tone] }} role="status" aria-live="polite" data-testid="clock-line">
        {line.text}
      </div>
      <div className="hud-live-status px-1 text-center text-[11px] leading-tight" style={{ color: TONE[sync.tone] }} role="status" data-testid="sync-line">
        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: TONE[sync.tone] }} aria-hidden="true" />
        {sync.text}
      </div>
      {pending > 0 && (
        <div className="hud-live-status px-1 text-center text-[11px] text-white/70" aria-live="polite">
          {pending} order{pending === 1 ? '' : 's'} on the way to the host
        </div>
      )}
      {note && (
        <button className="hud-live-status text-[12px] text-[#6cb4ff] underline underline-offset-2" onClick={openNote}>
          Read the month’s report
        </button>
      )}
      <div className="max-sm:w-[96px] max-sm:shrink-0 max-sm:[&>button]:px-2 max-sm:[&>button]:text-[12px] max-sm:[&>button]:leading-tight">
        <OnlinePeople />
      </div>
    </div>
  )
}
