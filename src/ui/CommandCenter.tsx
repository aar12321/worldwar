import { useState } from 'react'
import { STANCES, COMMITS, type Stance } from '../data/war'
import { advise, capabilities, OBJECTIVES, planAttack, planPreset, rankTargets, whatIf, type Advice, type Objective, type PlannedAttack, type TargetRow } from '../engine/commander'
import { attackPool, shareOfPool } from '../engine/deploy'
import { forecastPlan, type Forecast } from '../engine/forecast'
import { formatDivisions, totalUnits } from '../engine/helpers'
import type { GameState, Nation, Order, RegionId, UnitCounts } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { DataList } from './DataList'
import { NumberStepper } from './widgets'

const OBJECTIVE_KEYS = Object.keys(OBJECTIVES) as Objective[]
const ADVICE_TONE: Record<Advice['tone'], string> = { good: 'text-[#6eeb8a]', warn: 'text-[#ffd60a]', bad: 'text-[#ff8a84]', info: 'text-[#9fd0ff]' }
const ADVICE_MARK: Record<Advice['tone'], string> = { good: '▲', warn: '!', bad: '▼', info: 'i' }

export interface Deployment {
  units: UnitCounts
  missiles: number
  stance: Stance
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** AI Battle Command, as a panel: plans the attack for you, ranks your targets, writes advice and runs the standing auto-command. */
export function CommandCenter({
  game,
  player,
  target,
  level,
  orders,
  live,
  current,
  forecast,
  onApply,
}: {
  game: GameState
  player: Nation
  target: RegionId
  level: number
  orders: Order[]
  live: boolean
  current: Deployment
  forecast: Forecast | null
  onApply: (d: Deployment) => void
}) {
  const { map } = getWorld()
  const cap = capabilities(level)
  const open = useGame((s) => s.openWarRoom)
  const auto = useGame((s) => s.autoCommand)
  const setAuto = useGame((s) => s.setAutoCommand)
  const planAuto = useGame((s) => s.planAutoCommand)
  const [objective, setObjective] = useState<Objective>('win')
  const [keepHome, setKeepHome] = useState(40)
  const [busy, setBusy] = useState<string | null>(null)
  const [planned, setPlanned] = useState<{ rec: PlannedAttack | null; before: Deployment; beforeF: Forecast | null; recF: Forecast; advice: Advice[]; label: string } | null>(null)
  const [rows, setRows] = useState<TargetRow[] | null>(null)
  const [advice, setAdvice] = useState<Advice[] | null>(null)
  const pool = attackPool(game, player.id, orders, live)

  // Heavy work runs after the button has had a chance to repaint as "planning".
  const later = (what: string, fn: () => void) => {
    setBusy(what)
    setTimeout(() => {
      try {
        fn()
      } finally {
        setBusy(null)
      }
    }, 20)
  }

  const plan = () =>
    later('plan', () => {
      const opts = { objective, keepHome: objective === 'defend' ? keepHome / 100 : undefined, pending: orders, live }
      const before = current
      const beforeF = forecast
      let apply: Deployment | null = null
      let rec: PlannedAttack | null = null
      let recF: Forecast | null = null
      if (cap.composition) {
        rec = planAttack(game, map, player.id, target, opts)
        if (rec) {
          apply = { units: { ...pool, ...rec.plan.units, missile: 0 } as UnitCounts, missiles: rec.plan.missiles ?? 0, stance: rec.plan.stance }
          // The planner names only the kinds it sends; the rest are zero.
          for (const k of Object.keys(apply.units) as (keyof UnitCounts)[]) if (rec.plan.units[k] === undefined) apply.units[k] = 0
          recF = rec.forecast
        }
      } else {
        const p = planPreset(game, map, player.id, target, { ...opts, stance: cap.stance ? undefined : 'assault' })
        if (p) {
          const commit = p.commit
          apply = { units: shareOfPool(pool, COMMITS[commit].share), missiles: 0, stance: p.stance }
          recF = forecastPlan(game, map, player.id, { target, stance: p.stance, units: apply.units }, 512)
        }
      }
      if (!apply || !recF) {
        setPlanned(null)
        setAdvice([{ tone: 'bad', text: 'There is nothing you can send right now.' }])
        return
      }
      onApply(apply)
      const lines = advise(game, map, player.id, { target, stance: apply.stance, units: apply.units, missiles: apply.missiles }, level, rec)
      setPlanned({ rec, before, beforeF, recF, advice: lines, label: cap.composition ? `Planned for "${OBJECTIVES[objective].name.toLowerCase()}"` : cap.stance ? 'Best preset size and stance' : 'Best preset size' })
      setAdvice(lines)
    })

  const readSituation = () =>
    later('advise', () => {
      setAdvice(advise(game, map, player.id, { target, stance: current.stance, units: current.units, missiles: current.missiles }, level, planned?.rec ?? null))
    })

  const rank = () =>
    later('rank', () => {
      setRows(rankTargets(game, map, player.id, { objective, keepHome: objective === 'defend' ? keepHome / 100 : undefined, pending: orders, live }, level))
    })

  const rowsWhatIf = planned?.beforeF ? whatIf(planned.beforeF, planned.recF) : null
  const queuedAuto = orders.filter((o) => o.type === 'attack' && o.auto).length

  return (
    <section className="inset-card p-3.5 space-y-3" aria-label="AI Battle Command" data-level={level}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">AI Battle Command</h3>
        <span className="rounded-full bg-[#30d158]/20 px-2 py-0.5 text-[11px] font-semibold text-[#6eeb8a]">Level {level}</span>
      </div>
      <p className="text-[12px] text-white/70">
        Level 1 gives exact odds and ranks your targets. Level 2 also picks the stance and writes advice. Level 3 plans the best force, size and mix for your goal, and can run a standing auto-command.
      </p>

      <div role="radiogroup" aria-label="Goal" className="grid grid-cols-2 gap-1.5">
        {OBJECTIVE_KEYS.map((o) => (
          <button key={o} role="radio" aria-checked={objective === o} title={OBJECTIVES[o].blurb} onClick={() => setObjective(o)} className={`rounded-xl px-2.5 py-2 text-left border text-[13px] ${objective === o ? 'border-[#0a84ff] bg-[#0a84ff]/20' : 'border-white/10 bg-white/6 hover:bg-white/10'}`}>
            <span className="block font-semibold">{OBJECTIVES[o].name}</span>
          </button>
        ))}
      </div>
      <p className="text-[12px] text-white/65">{OBJECTIVES[objective].blurb}</p>
      {objective === 'defend' && <NumberStepper label="Share of your reserve to keep at home" value={keepHome} onChange={setKeepHome} min={0} max={90} step={5} unit="%" slider />}

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={plan} disabled={busy !== null || totalUnits(pool) < 0.5} data-testid="plan-attack" aria-keyshortcuts="P">
          {busy === 'plan' ? 'Planning…' : 'Plan this attack for me'}
        </button>
        <button className="btn btn-quiet" onClick={readSituation} disabled={busy !== null}>
          {busy === 'advise' ? 'Reading…' : 'Read the situation'}
        </button>
        {planned && (
          <button className="btn btn-quiet" onClick={() => onApply(planned.before)}>
            Undo the plan
          </button>
        )}
      </div>

      {planned && (
        <div className="space-y-2" aria-label="Recommended plan against yours">
          <div className="text-[13px] font-semibold">{planned.label}</div>
          {rowsWhatIf ? (
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr className="text-white/60 text-left">
                  <th className="font-medium pb-1">What if</th>
                  <th className="font-medium pb-1 text-right">Your plan</th>
                  <th className="font-medium pb-1 text-right">Recommended</th>
                </tr>
              </thead>
              <tbody>
                {rowsWhatIf.map((r) => (
                  <tr key={r.label} className="border-t border-white/8">
                    <td className="py-1">{r.label}</td>
                    <td className="py-1 text-right text-white/75">{r.now}</td>
                    <td className={`py-1 text-right font-semibold ${r.better === null ? '' : r.better ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}`}>{r.plan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-white/75">
              {pct(planned.recF.winChance)} to win, losing about {formatDivisions(planned.recF.yourLosses)}.
            </p>
          )}
          <p className="text-[12px] text-white/60">Applied to the steppers above. Change any of them and the odds update at once. Stance: {STANCES[planned.rec?.plan.stance ?? current.stance].name}.</p>
        </div>
      )}

      {advice && (
        <ul className="space-y-1.5" aria-label="Advice">
          {advice.map((a, i) => (
            <li key={i} className="flex gap-2 text-[13px]">
              <span className={`w-4 shrink-0 text-center font-bold ${ADVICE_TONE[a.tone]}`} aria-hidden>
                {ADVICE_MARK[a.tone]}
              </span>
              <span className="text-white/85">{a.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[14px] font-semibold">Your best targets this month</h4>
          <button className="btn btn-quiet px-3 py-1.5 text-[13px]" onClick={rank} disabled={busy !== null}>
            {busy === 'rank' ? 'Ranking…' : rows ? 'Rank again' : 'Rank targets'}
          </button>
        </div>
        {rows && rows.length === 0 && <p className="text-[13px] text-white/70">Nothing you can attack right now.</p>}
        {rows && rows.length > 0 && (
          <DataList
            label="Targets"
            rows={rows}
            rowKey={(r) => r.target}
            searchText={(r) => `${r.name} ${r.ownerName}`}
            noun={['target', 'targets']}
            minForToolbar={9}
            rowClass="py-1.5"
            renderRow={(r) => (
              <div className="flex items-start justify-between gap-2" data-target={r.target}>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold truncate">
                    {r.name}
                    {r.target === target && <span className="ml-1.5 text-[11px] text-white/55">(this one)</span>}
                  </div>
                  <div className="text-[12px] text-white/70">
                    {r.ownerName !== r.name ? `${r.ownerName} · ` : ''}{STANCES[r.stance].name} · lose ~{formatDivisions(r.yourLosses)}, they lose ~{formatDivisions(r.theirLosses)}
                  </div>
                  <div className="text-[12px] text-[#6eeb8a]">{r.gains.join(' · ')}</div>
                  {r.risks.length > 0 && <div className="text-[12px] text-[#ffd60a]">{r.risks.join(' · ')}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-[16px] font-semibold tabular-nums ${r.win >= 0.7 ? 'text-[#6eeb8a]' : r.win >= 0.4 ? 'text-[#ffd60a]' : 'text-[#ff8a84]'}`}>{pct(r.win)}</div>
                  {r.target !== target && (
                    <button className="btn btn-quiet px-2.5 py-1 text-[12px]" onClick={() => open(r.target)}>
                      Open
                    </button>
                  )}
                </div>
              </div>
            )}
          />
        )}
      </div>

      {cap.auto && (
        <div className="space-y-2 border-t border-white/10 pt-3" aria-label="Auto-command">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-[14px] font-semibold">Auto-command</h4>
              <p className="text-[12px] text-white/65">Every month it plans your attacks within the limits below and puts them in the order tray, in green, for you to look over and cancel before the month ends.</p>
            </div>
            <button role="switch" aria-checked={auto.on} className={`btn px-3.5 py-1.5 text-[13px] shrink-0 ${auto.on ? 'btn-primary' : 'border border-white/25'}`} onClick={() => setAuto({ on: !auto.on })} disabled={live} title={live ? 'Auto-command plans a month at a time: it is for turn games' : undefined}>
              {auto.on ? 'On' : 'Turn on'}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="label">Most attacks a month</div>
              <NumberStepper label="Most attacks a month" value={auto.maxAttacks} onChange={(v) => setAuto({ maxAttacks: v })} min={1} max={9} slider={false} />
            </div>
            <div className="space-y-1">
              <div className="label">Keep at home</div>
              <NumberStepper label="Share of the reserve kept at home" value={Math.round(auto.reserve * 100)} onChange={(v) => setAuto({ reserve: v / 100 })} min={0} max={90} step={5} unit="% of the reserve" slider={false} />
            </div>
            <div className="space-y-1">
              <div className="label">Only if the chance to win is at least</div>
              <NumberStepper label="Least chance to win" value={Math.round(auto.minWin * 100)} onChange={(v) => setAuto({ minWin: v / 100 })} min={30} max={95} step={5} unit="%" slider={false} />
            </div>
            <div className="space-y-1">
              <div className="label">Goal</div>
              <div role="radiogroup" aria-label="Auto-command goal" className="flex flex-wrap gap-1.5 items-start">
                {OBJECTIVE_KEYS.map((o) => (
                  <button key={o} role="radio" aria-checked={auto.objective === o} className={`btn px-2.5 py-1.5 text-[12px] ${auto.objective === o ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setAuto({ objective: o })}>
                    {OBJECTIVES[o].name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-quiet" disabled={live} onClick={() => planAuto()}>
              Plan the month now
            </button>
            <span className="text-[12px] text-white/70">{queuedAuto > 0 ? `${queuedAuto} planned in the tray` : 'Nothing planned yet'}</span>
          </div>
        </div>
      )}
    </section>
  )
}
