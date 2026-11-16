import { getWorld } from '../map/world'
import { ownsGoal, scenarioGoalLines, scenarioInPlay, scenarioMonths } from '../engine/scenarios'
import type { GameState } from '../engine/types'

/** One progress bar: what the scenario asks, and how far along the player is. */
function GoalBar({ label, value, goal, text }: { label: string; value: number; goal: number; text: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="text-white/75">{label}</span>
        <span className="font-semibold tabular-nums text-right">{text}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/12 overflow-hidden" role="img" aria-label={`${label}: ${text}`}>
        <div className="h-full bg-[#0a84ff]" style={{ width: `${Math.max(0, Math.min(100, (value / Math.max(0.0001, goal)) * 100))}%` }} />
      </div>
    </div>
  )
}

/**
 * The scenario's section of the Briefing: what is going on, how you win, and how far you are. For the goals only a scenario has
 * (survive, grow, out-earn) the bars are here and replace the usual "How you win" card, see `ownsGoal`.
 */
export function ScenarioBriefing({ game, playerId }: { game: GameState; playerId: string }) {
  const def = scenarioInPlay(game)
  if (!def) return null
  const lines = scenarioGoalLines(game, getWorld().map, playerId)
  const months = scenarioMonths(game)
  const own = ownsGoal(game)
  return (
    <section className="inset-card p-4 space-y-3" aria-label="Scenario">
      <div>
        <div className="label">Scenario · month {months + 1}</div>
        <div className="text-[18px] font-semibold tracking-tight mt-0.5">{def.title}</div>
      </div>
      <details open={months < 2} className="group">
        <summary className="cursor-pointer text-[13px] text-[#64a8ff]">What is going on</summary>
        <div className="mt-2 space-y-2">
          {def.briefing.map((para, i) => (
            <p key={i} className="text-[14px] text-white/85 leading-snug">
              {para}
            </p>
          ))}
        </div>
      </details>
      {own && (
        <>
          <div className="text-[16px] font-semibold tracking-tight">How you win</div>
          {lines.map((l) => (
            <GoalBar key={l.label} {...l} />
          ))}
          <p className="text-[13px] text-white/70">{def.goalText} You lose if {game.nations[playerId].name} is wiped out.</p>
        </>
      )}
    </section>
  )
}
