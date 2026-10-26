import { militarySheet } from '../engine/militaryStats'
import { UNIT_TYPES } from '../engine/types'
import type { GameState, NationId } from '../engine/types'
import { formatDivisions } from '../engine/helpers'

/** Two militaries side by side: how many of each unit, their effective attack and defense, and total strength. */
export function MilitaryCompare({ game, mine, theirs }: { game: GameState; mine: NationId; theirs: NationId }) {
  const a = militarySheet(game, mine)
  const b = militarySheet(game, theirs)
  const total = Math.max(1, a.totalPower + b.totalPower)
  return (
    <div className="inset-card p-3.5 space-y-3">
      <div className="flex items-baseline justify-between text-[14px]">
        <span className="font-semibold">{game.nations[mine].name}</span>
        <span className="label">Strength</span>
        <span className="font-semibold">{game.nations[theirs].name}</span>
      </div>
      <div className="flex items-center gap-3 text-[16px] font-semibold tabular-nums">
        <span className="w-14 text-left">{a.totalPower.toFixed(0)}</span>
        <div className="flex-1 h-2.5 rounded-full bg-[#ff453a]/70 overflow-hidden" role="img" aria-label={`Strength ${a.totalPower.toFixed(0)} against ${b.totalPower.toFixed(0)}`}>
          <div className="h-full bg-[#0a84ff]" style={{ width: `${(a.totalPower / total) * 100}%` }} />
        </div>
        <span className="w-14 text-right">{b.totalPower.toFixed(0)}</span>
      </div>
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="text-white/65">
            <th className="text-left font-medium pb-1">Unit</th>
            <th className="font-medium pb-1">You</th>
            <th className="font-medium pb-1">ATK / DEF</th>
            <th className="font-medium pb-1">Them</th>
            <th className="text-right font-medium pb-1">ATK / DEF</th>
          </tr>
        </thead>
        <tbody>
          {UNIT_TYPES.map((u, i) => {
            const x = a.units[i]
            const y = b.units[i]
            if (x.count < 0.05 && y.count < 0.05) return null
            return (
              <tr key={u} className="border-t border-white/10">
                <td className="py-1 text-left">{x.name}</td>
                <td className="text-center">{formatDivisions(x.count)}</td>
                <td className="text-center text-white/70">
                  {x.attack.toFixed(1)} / {x.defense.toFixed(1)}
                </td>
                <td className="text-center">{formatDivisions(y.count)}</td>
                <td className="text-right text-white/70">
                  {y.attack.toFixed(1)} / {y.defense.toFixed(1)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
