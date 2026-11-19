import { usePlayerView } from '../../hooks'
import { Card } from '../parts'

const SHORT: Record<string, string> = { 'High taxes': 'Taxes', 'Low taxes': 'Taxes' }

/** Why stability is heading where it is: every cause with its points, so the player knows which lever to pull. */
export function StabilityWhy() {
  const { player, econ } = usePlayerView()!
  // Taxes come as two lines (high and low); show them as one.
  const merged = new Map<string, number>()
  for (const p of econ.stabilityParts) merged.set(SHORT[p.label] ?? p.label, (merged.get(SHORT[p.label] ?? p.label) ?? 0) + p.value)
  const [base, ...rest] = [...merged.entries()]
  const rows = rest.filter(([, v]) => Math.abs(v) >= 0.05).sort((a, b) => b[1] - a[1])
  const max = Math.max(5, ...rows.map(([, v]) => Math.abs(v)))
  const target = Math.round(econ.stabilityTarget)
  const now = Math.round(player.stability)
  // The engine clamps the sum to 0..100 (economy.ts, stabilityTarget), so the lines can add up to more than where it heads.
  const raw = econ.stabilityParts.reduce((a, p) => a + p.value, 0)
  const capped = raw > 100 ? 100 : raw < 0 ? 0 : null
  return (
    <Card title="Why stability is heading for" hint="Every cause, in points. Add the lines to the starting calm and you get where it is heading. Pull the biggest lever first." right={<span className="text-[20px] font-semibold tabular-nums">{target}%</span>}>
      <div className="space-y-1.5 text-[13px]">
        <div className="flex justify-between text-white/70">
          <span>{base[0]}</span>
          <span className="tabular-nums">{base[1].toFixed(0)}</span>
        </div>
        {rows.map(([label, v]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_96px_52px] items-center gap-2">
            <span className="truncate">{label}</span>
            <span className="h-1.5 rounded-full bg-white/8 relative" aria-hidden>
              <span className="absolute inset-y-0 rounded-full" style={{ left: v >= 0 ? '50%' : `${50 - (Math.abs(v) / max) * 50}%`, width: `${(Math.abs(v) / max) * 50}%`, background: v >= 0 ? '#30d158' : '#ff453a' }} />
            </span>
            <span className={`tabular-nums text-right ${v >= 0 ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}`}>
              {v >= 0 ? '+' : '−'}
              {Math.abs(v).toFixed(1)}
            </span>
          </div>
        ))}
        {rows.length === 0 && <p className="text-white/60">Nothing is pushing stability either way.</p>}
        {capped !== null && (
          <div className="flex justify-between text-white/70">
            <span>The lines add up to {raw.toFixed(0)}; stability {capped ? 'tops out at 100%' : 'cannot fall below 0%'}</span>
            <span className="tabular-nums">{capped}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-white/10 pt-1.5 font-semibold">
          <span>Heading for (now {now}%)</span>
          <span className="tabular-nums">{target}%</span>
        </div>
      </div>
      {econ.society.rawStability > 0 && (
        <p className="text-[12px] text-white/60">
          Your programs add {econ.society.stability.toFixed(1)} points. Care helps most at first: the more you add, the less each new program gives.
        </p>
      )}
    </Card>
  )
}
