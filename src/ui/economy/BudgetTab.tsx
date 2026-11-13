import { TREASURY } from '../../data/business'
import { DRAFT_LIMITS, TAX_LIMITS } from '../../data/unitTypes'
import { useGame } from '../../store'
import { signed, usePlayerView } from '../hooks'
import { OrderButton } from '../panel'
import { Card, Line, SliderRow } from './parts'

/** Where the money comes from and goes, the tax and draft sliders, and the treasury. */
export function BudgetTab() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const { game, player, econ } = view
  const tax = view.pendingPolicy.taxRate
  const draft = view.pendingPolicy.draftRate
  const maxDraft = player.laws.includes('conscription_act') ? DRAFT_LIMITS.maxWithConscription : DRAFT_LIMITS.max
  const credit = econ.credit
  const owed = player.debt
  const bond = (amount: number) => ({ type: 'issueBonds' as const, nationId: player.id, amount })
  const repay = (amount: number) => ({ type: 'repayDebt' as const, nationId: player.id, amount })

  return (
    <section className="econ-grid">
      <Card title="Money each month" hint="Everything that comes in and goes out, added up.">
        <div className="text-[14px] space-y-1">
          <Line k="Taxes" v={signed(econ.taxIncome)} />
          <Line k="Factories" v={signed(econ.factoryIncome)} />
          <Line k="Trade through ports" v={signed(econ.tradeIncome)} />
          <Line k="Business tax and banks" v={signed(econ.corporateIncome)} />
          {econ.dividends > 0 && <Line k="Dividends from investments" v={signed(econ.dividends)} />}
          {econ.policyMoney !== 0 && <Line k="Laws" v={signed(econ.policyMoney)} warn={econ.policyMoney < 0} />}
          <Line k="Upkeep of units and buildings" v={signed(-econ.upkeep)} warn />
          {econ.warBills.map((b) => (
            <Line key={b.enemy} k={`War with ${game.nations[b.enemy]?.name ?? b.enemy}`} v={signed(-b.amount)} warn />
          ))}
          {econ.interest > 0 && <Line k="Interest on bonds" v={signed(-econ.interest)} warn />}
          {econ.subsidies > 0 && <Line k="Subsidies" v={signed(-econ.subsidies)} warn />}
          <Line k="Left over" v={signed(econ.netCapital)} warn={econ.netCapital < 0} strong />
        </div>
      </Card>

      <Card title="Taxes and the draft" hint="They change when you press Next turn.">
        <SliderRow label="Income tax" value={tax} min={TAX_LIMITS.min} max={TAX_LIMITS.max} onChange={(v) => setPolicy({ taxRate: v })} hint="More tax is more money. Above 20% people start to resent it." />
        <SliderRow label="Draft" value={draft} min={DRAFT_LIMITS.min} max={maxDraft} onChange={(v) => setPolicy({ draftRate: v })} hint="Turns workers into soldiers you can train. Fewer workers means less money and food." />
        <div className="text-[14px] space-y-1">
          <Line k="Food each month" v={signed(econ.netFood)} warn={econ.netFood < 0} />
          <Line k="New soldiers each month" v={`${signed(econ.militaryRegen, 0)}k`} />
          <Line k="Jobs filled" v={`${Math.round(econ.laborRatio * 100)}%`} warn={econ.laborRatio < 0.9} />
        </div>
      </Card>

      <Card title="Treasury" hint="Borrow now with bonds and pay interest every month. A nation that cannot pay defaults, and nobody lends to it for two years.">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="You owe" value={owed.toFixed(0)} warn={owed > 0} />
          <Stat label="Credit rating" value={credit.rating} warn={credit.locked || credit.rating === 'D' || credit.rating === 'CCC'} />
          <Stat label="Can still borrow" value={credit.room.toFixed(0)} />
        </div>
        <p className="text-[13px] text-white/70">
          Interest is {(credit.rate * 100).toFixed(2)}% a month{owed > 0 ? `, ${(owed * credit.rate).toFixed(1)} money at your current debt` : ''}.
          {credit.locked ? ' You defaulted recently, so you cannot borrow.' : ''}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <OrderButton order={bond(50)} label="Borrow 50" effect="Issue bonds" />
          <OrderButton order={bond(150)} label="Borrow 150" effect="Issue bonds" />
          <OrderButton order={repay(Math.min(50, owed))} label="Repay 50" effect="Cut your debt" />
          <OrderButton order={repay(owed)} label="Repay all" cost={`${owed.toFixed(0)} money`} effect="Clear your debt" />
        </div>
        {owed > 0 && econ.netCapital < 0 && <p className="text-[13px] text-[#ff8a84]">You are spending more than you earn while in debt. After {TREASURY.defaultAfter} months in the red you will default.</p>}
      </Card>
    </section>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-white/6 py-2">
      <div className="label">{label}</div>
      <div className={`text-[18px] font-semibold tabular-nums ${warn ? 'text-[#ff8a84]' : ''}`}>{value}</div>
    </div>
  )
}
