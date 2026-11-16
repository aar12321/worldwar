import type { NationId } from '../engine/types'
import { warBreakdown, warStanding, type Standing } from '../engine/warscore'
import { getWorld } from '../map/world'
import { usePlayerView } from './hooks'

const VERDICT: Record<Standing, { text: string; color: string }> = {
  winning: { text: 'Winning', color: '#6eeb8a' },
  ahead: { text: 'Slightly ahead', color: '#a7f3d0' },
  even: { text: 'Even', color: '#ffd60a' },
  behind: { text: 'Slightly behind', color: '#fdba74' },
  losing: { text: 'Losing', color: '#ff8a84' },
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/**
 * Two separate answers about one war. "Who is winning" weighs the score, the armies and each home front; the score itself is the points
 * for the peace table, and the breakdown says where they come from: battles, casualties, land held, the capital, missiles.
 */
export function WarPicture({ enemyId, compact = false }: { enemyId: NationId; compact?: boolean }) {
  const view = usePlayerView()
  const { map } = getWorld()
  if (!view) return null
  const { game, player } = view
  const standing = warStanding(game, map, player.id, enemyId)
  const parts = warBreakdown(game, map, player.id, enemyId)
  const v = VERDICT[standing.verdict]
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[13px]" title="Who is winning looks at the war score, the armies and how each home front is holding. The war score is only the points you can spend at the peace table.">
        <span className="text-white/70">Who is winning</span>
        <span className="font-semibold" style={{ color: v.color }}>
          {v.text}
        </span>
      </div>
      <p className="text-[12px] text-white/60 leading-snug">{standing.reasons.join('; ')}.</p>
      {!compact && (
        <ul className="grid grid-cols-1 gap-y-0.5 pt-1 text-[12px]" aria-label="What the war score is made of">
          {parts.parts.map((p) => (
            <li key={p.id} className="flex justify-between gap-3" title={p.note}>
              <span className="text-white/70">{p.label}</span>
              <span className="tabular-nums" style={{ color: p.points > 0 ? '#6eeb8a' : p.points < 0 ? '#ff8a84' : undefined }}>
                {signed(Math.round(p.points * 10) / 10)}
              </span>
            </li>
          ))}
          <li className="flex justify-between gap-3 border-t border-white/10 pt-0.5 font-semibold">
            <span>War score</span>
            <span className="tabular-nums">{signed(parts.total)}</span>
          </li>
        </ul>
      )}
    </div>
  )
}
