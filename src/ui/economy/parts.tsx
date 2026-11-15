import { useState, type ReactNode } from 'react'

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

/**
 * A slider with its label, its value and a hint. While it is dragged only the slider moves; the new value is handed on when it is
 * let go (or a key is released), so the whole economy is not worked out again for every pixel.
 */
export function SliderRow({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  hint,
  neutral,
  format = (v) => `${Math.round(v * 100)}%`,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  hint?: string
  /** A value that has no effect either way. It is marked on the slider and named beside the value. */
  neutral?: number
  format?: (v: number) => string
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  const commit = () => {
    if (draft !== null && Math.abs(draft - value) > 1e-9) onChange(draft)
    setDraft(null)
  }
  return (
    <div>
      <div className="flex justify-between text-[15px]">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">
          {format(shown)}
          {neutral !== undefined && Math.abs(shown - neutral) < step / 2 && <span className="ml-1.5 text-[12px] font-medium text-[#6eeb8a]">neutral</span>}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          className="w-full"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={(e) => setDraft(+e.target.value)}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          onTouchEnd={commit}
        />
        {neutral !== undefined && <span aria-hidden className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-[#6eeb8a]" style={{ left: `calc(${((neutral - min) / (max - min)) * 100}% + ${8 - ((neutral - min) / (max - min)) * 16}px)` }} />}
      </div>
      {hint && <div className="text-[13px] text-white/65">{hint}</div>}
    </div>
  )
}
