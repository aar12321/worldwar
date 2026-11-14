import { isLive } from '../engine/calendar'
import { OBJECTIVES, type Advice } from '../engine/advisor'
import { controlled } from '../engine/victory'
import { useGame } from '../store'
import { useAdvice, usePlayerView } from './hooks'
import { PanelShell } from './panel'

const URGENCY: Record<Advice['urgency'], { label: string; color: string }> = {
  now: { label: 'Needs you now', color: '#ff453a' },
  soon: { label: 'Coming up', color: '#ffd60a' },
  idea: { label: 'Good move', color: '#30d158' },
}

/** Advice cards. Each one says what is going on and has one button that takes you to the fix. */
export function AdviceList({ items, compact = false }: { items: Advice[]; compact?: boolean }) {
  const goTo = useGame((s) => s.goTo)
  const live = useGame((s) => !!s.game && isLive(s.game))
  if (items.length === 0) return <p className="text-[14px] text-white/70">{live ? 'Nothing needs you right now. Press Play when you are ready.' : 'Nothing needs you right now. Press the green button (Next turn, or Ready online) when you are ready.'}</p>
  return (
    <ul className="space-y-2.5">
      {items.map((a) => (
        <li key={a.id} className="inset-card p-3.5 flex gap-3" style={{ borderLeft: `3px solid ${URGENCY[a.urgency].color}` }}>
          <div className="min-w-0 flex-1">
            <div className="label" style={{ color: URGENCY[a.urgency].color }}>
              {URGENCY[a.urgency].label}
            </div>
            <div className="text-[16px] font-semibold tracking-tight mt-0.5">{a.title}</div>
            {!compact && <p className="text-[14px] text-white/75 mt-1 leading-snug">{a.detail}</p>}
          </div>
          <button className="btn btn-primary self-center shrink-0" onClick={() => goTo(a.target)}>
            {a.action}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Progress({ label, value, goal, text }: { label: string; value: number; goal: number; text: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[14px]">
        <span className="text-white/75">{label}</span>
        <span className="font-semibold tabular-nums">{text}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/12 overflow-hidden" role="img" aria-label={`${label}: ${text}`}>
        <div className="h-full bg-[#0a84ff]" style={{ width: `${Math.max(0, Math.min(100, (value / Math.max(0.0001, goal)) * 100))}%` }} />
      </div>
    </div>
  )
}

/** The first desk: your goal, your first steps, and what the advisor would do this month. */
export function Briefing() {
  const view = usePlayerView()
  const advice = useAdvice()
  const goTo = useGame((s) => s.goTo)
  const setHelp = useGame((s) => s.setHelp)
  const showGuide = useGame((s) => s.settings.showGuide)
  const update = useGame((s) => s.updateSettings)
  if (!view) return null
  const { game, player, orders } = view
  const lands = Object.keys(game.regions).length
  const held = controlled(game, player.id)
  const puppets = Object.values(game.nations).filter((n) => n.alive && n.overlord === player.id).length
  const reached = new Set(player.milestones ?? [])
  if (orders.some((o) => o.type === 'research')) reached.add('research')
  const left = OBJECTIVES.filter((o) => !reached.has(o.id))
  const next = left[0]

  return (
    <PanelShell title="Briefing" kicker={`${player.name} · what needs you this month`} panel="briefing">
      <section className="inset-card p-4 space-y-3">
        <div className="text-[16px] font-semibold tracking-tight">How you win</div>
        <Progress label="Hold the whole world" value={held} goal={lands} text={`${held} of ${lands} countries`} />
        <p className="text-[13px] text-white/70">Every country must be yours or a puppet of yours{puppets > 0 ? ` (${puppets} puppet${puppets === 1 ? '' : 's'} so far)` : ''}. It takes a long time: work through allies, spies and patience. You lose if {player.name} is wiped out.</p>
      </section>

      {showGuide && left.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[16px] font-semibold tracking-tight">First steps</h3>
            <button className="btn btn-quiet" onClick={() => update({ showGuide: false })}>
              Hide
            </button>
          </div>
          <ol className="space-y-1.5">
            {OBJECTIVES.map((o) => {
              const done = reached.has(o.id)
              const current = next?.id === o.id
              return (
                <li key={o.id} className={`rounded-xl px-3 py-2 flex items-center gap-3 ${current ? 'bg-[#0a84ff]/18 border border-[#0a84ff]/60' : 'bg-white/5'}`}>
                  <span aria-hidden className={`flex-none w-6 h-6 rounded-full flex items-center justify-center text-[13px] font-bold ${done ? 'bg-[#30d158] text-black' : 'border border-white/35 text-transparent'}`}>
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[15px] font-semibold ${done ? 'text-white/60 line-through' : ''}`}>{o.title}</span>
                    {current && <span className="block text-[13px] text-white/80">{o.how}</span>}
                    <span className="sr-only">{done ? 'Done' : 'Not done yet'}</span>
                  </span>
                  {current && (
                    <button className="btn btn-primary shrink-0" onClick={() => goTo(o.target)}>
                      Show me
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <section className="space-y-2.5">
        <h3 className="text-[16px] font-semibold tracking-tight">Your advisor</h3>
        <AdviceList items={advice} />
      </section>

      <button className="btn w-full py-2.5" onClick={() => setHelp(true)}>
        How the game works
      </button>
    </PanelShell>
  )
}
