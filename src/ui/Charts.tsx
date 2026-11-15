import { useMemo } from 'react'

/** A small line chart with a label, the latest value and the change over the window. Drawn as one SVG path, so it costs nothing to keep many on screen. */
export function Spark({ label, values, color = '#0a84ff', format = (v: number) => v.toFixed(0), invert = false }: { label: string; values: number[]; color?: string; format?: (v: number) => string; invert?: boolean }) {
  const { path, area, min, max } = useMemo(() => {
    if (values.length < 2) return { path: '', area: '', min: 0, max: 0 }
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const span = hi - lo || 1
    const w = 240
    const h = 56
    const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - lo) / span) * (h - 8)] as const)
    const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    return { path: d, area: `${d} L${w},${h} L0,${h} Z`, min: lo, max: hi }
  }, [values])
  const last = values[values.length - 1]
  const first = values[0]
  const change = values.length > 1 ? last - first : 0
  const good = invert ? change <= 0 : change >= 0
  return (
    <figure className="inset-card p-3 space-y-1.5 min-w-0" aria-label={`${label}: ${values.length ? format(last) : 'no data yet'}`}>
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-white/75 truncate">{label}</span>
        <span className="text-[16px] font-semibold tabular-nums">{values.length ? format(last) : '-'}</span>
      </figcaption>
      {values.length > 1 ? (
        <svg viewBox="0 0 240 56" className="w-full h-14" role="img" aria-label={`${label} over ${values.length} months, from ${format(min)} to ${format(max)}`} preserveAspectRatio="none">
          <path d={area} fill={color} opacity="0.12" />
          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className="h-14 grid place-items-center text-[12px] text-white/50">The chart starts after the first month.</div>
      )}
      {values.length > 1 && (
        <div className={`text-[12px] tabular-nums ${good ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}`}>
          {change >= 0 ? '+' : ''}
          {format(change)} over {values.length} months
        </div>
      )}
    </figure>
  )
}
