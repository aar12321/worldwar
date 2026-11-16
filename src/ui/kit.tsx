import type { ReactNode } from 'react'

/** A number with its label, for the rows of tiles at the top of a tab. */
export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-[#ff8a84]' : tone === 'warn' ? 'text-[#ffd60a]' : tone === 'good' ? 'text-[#6eeb8a]' : ''
  return (
    <div className="rounded-xl bg-white/6 px-3 py-2 min-w-0">
      <div className="label truncate">{label}</div>
      <div className={`text-[18px] font-semibold tabular-nums leading-tight ${color}`}>{value}</div>
      {sub !== undefined && <div className="text-[12px] text-white/60 truncate">{sub}</div>}
    </div>
  )
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 span-all">{children}</div>
}

/** A thin progress bar. `value` is 0 to 1. */
export function Bar({ value, color = '#0a84ff', label }: { value: number; color?: string; label: string }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="h-2 rounded-full bg-white/12 overflow-hidden" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.max(2, v * 100)}%`, background: color }} />
    </div>
  )
}

/** A row of buttons to pick one level: Off / Basic / Generous, or None to Lavish. The chosen one is filled. */
export function LevelPicker({ label, levels, value, onChange, disabled }: { label: string; levels: string[]; value: number; onChange: (v: number) => void; disabled?: (i: number) => string | null }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {levels.map((name, i) => {
        const why = disabled?.(i) ?? null
        return (
          <button
            key={name}
            role="radio"
            aria-checked={value === i}
            disabled={!!why}
            title={why ?? undefined}
            className={`btn px-2.5 py-1.5 text-[13px] min-h-[36px] ${value === i ? 'btn-primary' : 'btn-quiet'}`}
            onClick={() => value !== i && onChange(i)}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}

/** How well a kind of work is staffed: green when there is enough, yellow when a little short, red when badly short. */
export function CoverageChip({ label, value }: { label: string; value: number }) {
  const color = value >= 1 ? '#30d158' : value >= 0.8 ? '#ffd60a' : '#ff453a'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-[12px]" title={`${label}: ${Math.round(value * 100)}% of what the work needs`}>
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label} {Math.round(value * 100)}%
    </span>
  )
}

/** A stacked bar of shares that add up to one. */
export function StackedBar({ parts, label }: { parts: { key: string; value: number; color: string; name: string }[]; label: string }) {
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-white/10" role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${Math.round(p.value * 100)}%`).join(', ')}`}>
        {parts.map((p) => (
          <div key={p.key} style={{ width: `${p.value * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[12px] text-white/75">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
            {p.name} {(p.value * 100).toFixed(p.value < 0.1 ? 1 : 0)}%
          </span>
        ))}
      </div>
    </div>
  )
}

/** A small note that something waits for the month to end. */
export function Pending({ show, text = 'Changes when the month ends' }: { show: boolean; text?: string }) {
  if (!show) return null
  return <span className="chip text-[#ffd60a]">{text}</span>
}

