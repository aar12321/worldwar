import type { ReactNode } from 'react'

/** A label and a number on one line. */
export function Line({ k, v, warn, strong }: { k: string; v: string; warn?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold border-t border-white/10 pt-1.5 mt-1' : ''}`}>
      <span className={strong ? '' : 'text-white/70'}>{k}</span>
      <span className={`tabular-nums ${warn ? 'text-[#ff8a84]' : ''}`}>{v}</span>
    </div>
  )
}

/** A card with a title and a one-line explanation. */
export function Card({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <section className="inset-card p-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
          {hint && <p className="text-[13px] text-white/70 mt-0.5">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

/** A slider with its label, its value and a hint. */
export function SliderRow({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  hint,
  format = (v) => `${Math.round(v * 100)}%`,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  hint?: string
  format?: (v: number) => string
}) {
  return (
    <div>
      <div className="flex justify-between text-[15px]">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">{format(value)}</span>
      </div>
      <input type="range" className="w-full" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      {hint && <div className="text-[13px] text-white/65">{hint}</div>}
    </div>
  )
}
