import { useMemo } from 'react'
import { DRAFT_LIMITS, TAX_LIMITS } from '../../data/unitTypes'
import { monthEndLines } from '../../engine/monthEnd'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { signed, usePlayerView } from '../hooks'
import { Card, Line, SliderRow } from './parts'

/** Where the money comes from and goes, and the tax and draft sliders. Bonds and printing are in Bank. */
export function BudgetTab() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const { game, player, econ } = view
  const tax = view.pendingPolicy.taxRate
  const draft = view.pendingPolicy.draftRate
  const maxDraft = player.laws.includes('conscription_act') ? DRAFT_LIMITS.maxWithConscription : DRAFT_LIMITS.max
  // Share dividends, tribute and trade deals move at the month's end, outside the economy's own lines.
  const extra = useMemo(() => monthEndLines(game, getWorld().map, player.id), [game, player.id])
  const change = econ.netCapital + extra.reduce((sum, l) => sum + l.amount, 0)

  return (
    <section className="econ-grid">
      <Card title="Money each month" hint="Everything that comes in and goes out, added up. These lines come straight from the engine, so they sum to what is left over. Share dividends, tribute and trade deals arrive separately at the month's end and are listed below.">
        <div className="text-[14px] space-y-1">
          {econ.lines
            .filter((l) => l.kind === 'income')
            .map((l) => (
              <Line key={l.label} k={l.label} v={signed(l.amount)} warn={l.amount < 0} />
            ))}
          {econ.lines
            .filter((l) => l.kind === 'cost')
            .map((l) => (
              <Line key={l.label} k={l.label === 'War bills' ? `War bills (${econ.warBills.map((b) => game.nations[b.enemy]?.name ?? b.enemy).join(', ')})` : l.label} v={signed(l.amount)} warn />
            ))}
          <Line k="Left over" v={signed(econ.netCapital)} warn={econ.netCapital < 0} strong />
          {extra.length > 0 && (
            <>
              {extra.map((l) => (
                <Line key={l.label} k={l.label} v={signed(l.amount)} warn={l.amount < 0} />
              ))}
              <Line k="Treasury change this month" v={signed(change)} warn={change < 0} strong />
            </>
          )}
        </div>
        <p className="text-[12px] text-white/60">Spending on schools, health and welfare is set in People; public works in Projects; the central bank in Bank.</p>
      </Card>

      <Card title="Taxes and the draft" hint="They change when the month ends.">
        <SliderRow label="Income tax" value={tax} min={TAX_LIMITS.min} max={TAX_LIMITS.max} onChange={(v) => setPolicy({ taxRate: v })} neutral={0.2} hint="20% is neutral. Higher raises money but people resent it; lower pleases them but earns less." />
        <SliderRow label="Draft" value={draft} min={DRAFT_LIMITS.min} max={maxDraft} onChange={(v) => setPolicy({ draftRate: v })} hint="Turns workers into soldiers you can train. Fewer workers means less money and food." />
        <div className="text-[14px] space-y-1">
          <Line k="Food each month" v={signed(econ.netFood)} warn={econ.netFood < 0} />
          <Line k="New soldiers each month" v={`${signed(econ.militaryRegen, 0)}k`} />
          <Line k="Jobs filled" v={`${Math.round(econ.laborRatio * 100)}%`} warn={econ.laborRatio < 0.9} />
        </div>
      </Card>

    </section>
  )
}
