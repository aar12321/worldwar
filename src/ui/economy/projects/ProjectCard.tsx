import type { Order, ProjectState } from '../../../engine/types'
import { PROJECT_LEVELS } from '../../../data/projects'
import { fmt, signed } from '../../hooks'
import { Pips } from '../../bits'
import { Bar } from '../../kit'
import { OrderButton } from '../../panel'
import { EffectLines } from '../people/PolicyCard'

export interface ProjectCardProps {
  name: string
  blurb: string
  /** Levels finished and working. */
  level: number
  state?: ProjectState
  /** What it does now (or at its first level, if not built), and what the next level would add. */
  now: { text: string; good: boolean }[]
  next?: { text: string; good: boolean }[]
  /** Totals for the level being built, or the next one. */
  months: number
  monthly: number
  cost: number
  upkeep: number
  /** Why it cannot be started or upgraded, or null. */
  problem: string | null
  start: Order
  pause: Order
  rush: Order
  rushPrice: number
  /** Progress a rush adds (`rushGain`), in the same units as `months`. */
  rushMonths: number
  /** Progress a month (`projectSpeed`): engineers and public works make a month count for more or less than one. */
  speed: number
  /** Where it can be built, for a project in a country. */
  where?: string
}

/** One project: its levels, what it does, how far along it is, and what can be done with it now. */
export function ProjectCard(p: ProjectCardProps) {
  const max = PROJECT_LEVELS.max
  const building = !!p.state && !p.state.done
  const upgrading = building && p.level > 0
  const nextLevel = p.level + 1
  // Progress grows by `speed` a month and the bill is paid every month until it is done, so the real months (and the real total)
  // follow the speed: short of engineers, a project takes longer and costs more.
  const speed = Math.max(0.05, p.speed)
  const realMonths = (progress: number) => Math.max(0, Math.ceil((p.months - progress) / speed - 1e-9))
  const left = realMonths(building ? (p.state?.progress ?? 0) : 0)
  const slow = speed < 0.98 ? ' (slowed: short of engineers or low public works)' : speed > 1.02 ? ' (sped up by public works)' : ''

  return (
    <div className={`inset-card p-3.5 space-y-2 ${p.level > 0 ? 'ring-1 ring-[#30d158]/25' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{p.name}</h3>
          <p className="text-[13px] text-white/70">{p.blurb}</p>
        </div>
        <div className="shrink-0 text-right space-y-1">
          <Pips value={p.level} max={max} />
          <div className="text-[12px] text-white/60">{p.level === 0 ? 'Not built' : p.level >= max ? 'Fully built' : `Level ${p.level} of ${max}`}</div>
        </div>
      </div>
      {p.where && <p className="text-[12px] text-white/60">{p.where}</p>}
      <div className="text-[12px] text-white/60">{p.level > 0 ? `Level ${p.level} does:` : 'What it does:'}</div>
      <EffectLines lines={p.now} />

      {building ? (
        <div className="space-y-1.5">
          <Bar value={(p.state?.progress ?? 0) / Math.max(1, p.months)} color="#0a84ff" label={`${p.name} progress`} />
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="text-white/75">
              {upgrading ? `Level ${nextLevel}: ` : ''}
              {p.state?.paused ? 'Paused' : `about ${left} month${left === 1 ? '' : 's'} left`} · {signed(-p.monthly)} a month
            </span>
            <span className="flex gap-1.5">
              <OrderButton order={p.rush} label="Rush" cost={`${p.rushPrice} money`} effect={`about ${Math.round((p.rushMonths / speed) * 10) / 10} months sooner`} />
              <OrderButton order={p.pause} label={p.state?.paused ? 'Resume' : 'Pause'} />
            </span>
          </div>
          {upgrading && <p className="text-[12px] text-white/60">Level {p.level} keeps working while the next is built.</p>}
        </div>
      ) : nextLevel <= max ? (
        <div className="space-y-1.5">
          {p.next && p.next.length > 0 && (
            <>
              <div className="text-[12px] text-white/60">Level {nextLevel} would do:</div>
              <EffectLines lines={p.next} />
            </>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className={`text-[13px] ${p.problem ? 'text-[#ff8a84]' : 'text-white/75'}`}>{p.problem ?? `${Math.round(p.monthly * left)} money over about ${left} months${slow}`}</span>
            <OrderButton order={p.start} label={p.level > 0 ? `Build level ${nextLevel}` : 'Start'} cost={`${Math.round(p.cost / p.months)}/mo`} tone="btn-primary" />
          </div>
        </div>
      ) : null}
      {p.level > 0 && <p className="text-[12px] text-white/60">Upkeep {fmt(p.upkeep, 1)} money a month.</p>}
    </div>
  )
}
