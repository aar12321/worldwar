import { isLive } from '../engine/calendar'
import { OBJECTIVES, type Advice, type AdviceTarget } from '../engine/advisor'
import { getWorld } from '../map/world'
import { conquestGoal, controlled, countriesTaken, economicGoal, economicShare, goalSentence, populationShare } from '../engine/victory'
import { useGame } from '../store'
import { useAdvice, usePlayerView } from './hooks'
import { PanelShell } from './panel'
import { ownsGoal } from '../engine/scenarios'
import { ScenarioBriefing } from './ScenarioBriefing'

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

/** The parts of the game a new player does not meet in the first steps, each with the desk that holds it. */
const EXPLORE: [string, AdviceTarget, string][] = [
  ['People and care', { desk: 'economy', tab: 'people' }, 'Twenty-two programs, campaigns and what moves stability'],
  ['Projects', { desk: 'economy', tab: 'projects' }, 'National projects and projects in your countries'],
  ['Space program', { desk: 'economy', tab: 'space' }, 'Agency, rockets, missions, labs and colonies'],
  ['Government', { desk: 'economy', tab: 'government' }, 'Cabinet, talent, jobs, policies and laws'],
  ['Deployment and theatres', { desk: 'military', tab: 'theatres' }, 'Forces on station, alert levels and the fronts'],
  ['Missile program', { desk: 'military', tab: 'program' }, 'Facilities, a chief designer, development and test launches'],
  ['Frontier systems', { desk: 'military', tab: 'systems' }, 'Cyber, shield, AI, quantum and orbital systems'],
  ['World reaction', { desk: 'empire', tab: 'reaction' }, 'How the world answers a growing power'],
  ['Bloc', { desk: 'faction' }, 'Your alliance bloc: joint operations, calls to arms and perks'],
  ['Diplomacy', { desk: 'diplomacy' }, 'Offers, treaties and every nation\'s opinion'],
]

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
      <ScenarioBriefing game={game} playerId={player.id} />
      {!ownsGoal(game) && (
      <section className="inset-card p-4 space-y-3">
        <div className="text-[16px] font-semibold tracking-tight">How you win</div>
        {game.settings.goal === 'classic' ? (
          <>
            <Progress label="Countries taken" value={countriesTaken(game, player.id)} goal={conquestGoal(game.settings.victoryShare)} text={`${countriesTaken(game, player.id)} of ${conquestGoal(game.settings.victoryShare)}`} />
            <Progress label="World's people held" value={populationShare(game, player.id)} goal={game.settings.victoryShare} text={`${Math.round(populationShare(game, player.id) * 100)}% of ${Math.round(game.settings.victoryShare * 100)}%`} />
            <Progress label="World's output" value={economicShare(game, getWorld().map, player.id)} goal={economicGoal(game.settings.victoryShare)} text={`${Math.round(economicShare(game, getWorld().map, player.id) * 100)}% of ${Math.round(economicGoal(game.settings.victoryShare) * 100)}%`} />
            <p className="text-[13px] text-white/70">
              {game.humans.length > 1 || game.multiplayer ? 'The first player' : 'You'} to {goalSentence(game)} wins. Any one of the three is enough. You lose if {player.name} is wiped out.
            </p>
          </>
        ) : (
          <>
            <Progress label="Hold the whole world" value={held} goal={lands} text={`${held} of ${lands} countries`} />
            <p className="text-[13px] text-white/70">Every country must be yours or a puppet of yours{puppets > 0 ? ` (${puppets} puppet${puppets === 1 ? '' : 's'} so far)` : ''}. It takes a long time: work through allies, spies and patience. You lose if {player.name} is wiped out.</p>
          </>
        )}
      </section>
      )}

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

      <section className="space-y-2" aria-label="More to explore">
        <h3 className="text-[16px] font-semibold tracking-tight">More to explore</h3>
        <p className="text-[13px] text-white/70">Beyond the first steps, the game has these. Each button opens the right desk.</p>
        <div className="flex flex-wrap gap-1.5">
          {EXPLORE.map(([label, target, hint]) => (
            <button key={label} className="btn btn-quiet" title={hint} onClick={() => goTo(target)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <button className="btn w-full py-2.5" onClick={() => setHelp(true)}>
        How the game works
      </button>
    </PanelShell>
  )
}
