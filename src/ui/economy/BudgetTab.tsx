import { DRAFT_LIMITS, TAX_LIMITS } from '../../data/unitTypes'
import type { AdviceTarget } from '../../engine/advisor'
import type { MoneyLine } from '../../engine/economy'
import { useGame } from '../../store'
import { signed, usePlayerView } from '../hooks'
import { Pending, StatTile, Tiles } from '../kit'
import { Card, Fold, GoTo, Line, SliderRow } from './parts'

/** The engine's money lines, grouped the way a player thinks of them, each group with the desk that sets it. */
const COST_GROUPS: { name: string; labels: string[]; to?: AdviceTarget; link?: string }[] = [
  { name: 'Military', labels: ['Military and upkeep', 'War bills', 'Aircraft development', 'Missile program'], to: { desk: 'military', tab: 'forces' }, link: 'Military' },
  { name: 'People and care', labels: ['Schools', 'Health care', 'Pensions', 'Jobless support', 'Housing', 'Programs for the people', 'Quarantine'], to: { desk: 'economy', tab: 'people' }, link: 'People' },
  { name: 'Building', labels: ['Public works', 'National projects', 'Space program'], to: { desk: 'economy', tab: 'projects' }, link: 'Projects' },
  { name: 'Running the state', labels: ['Governors', 'Settlers', 'Cabinet salaries', 'Civil service', 'Government (collection, waste, reforms)', 'Laws'], to: { desk: 'economy', tab: 'government' }, link: 'Government' },
  { name: 'Debt and business', labels: ['Interest on bonds', 'Bad loans', 'Subsidies'], to: { desk: 'economy', tab: 'bank' }, link: 'Bank' },
]

const sum = (lines: MoneyLine[]) => lines.reduce((a, l) => a + l.amount, 0)

/** Where the money comes from and goes, and the tax and draft sliders. Bonds and printing are in Bank. */
export function BudgetTab() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const { game, player, econ, committed } = view
  const tax = view.pendingPolicy.taxRate
  const draft = view.pendingPolicy.draftRate
  const maxDraft = player.laws.includes('conscription_act') ? DRAFT_LIMITS.maxWithConscription : DRAFT_LIMITS.max
  const income = econ.lines.filter((l) => l.kind === 'income')
  const costs = econ.lines.filter((l) => l.kind === 'cost')
  const known = new Set(COST_GROUPS.flatMap((g) => g.labels))
  const groups = [...COST_GROUPS, { name: 'Other', labels: costs.filter((l) => !known.has(l.label)).map((l) => l.label) }]
    .map((g) => ({ ...g, lines: costs.filter((l) => g.labels.includes(l.label)) }))
    .filter((g) => g.lines.length > 0)
    .sort((a, b) => sum(a.lines) - sum(b.lines))
  const treasury = player.resources.capital - committed.capital
  const name = (l: MoneyLine) => (l.label === 'War bills' ? `War bills (${econ.warBills.map((b) => game.nations[b.enemy]?.name ?? b.enemy).join(', ')})` : l.label)

  return (
    <section className="econ-grid">
      <Tiles compact>
        <StatTile label="Left over a month" value={signed(econ.netCapital)} tone={econ.netCapital < 0 ? 'bad' : 'good'} sub={`${signed(sum(income))} in, ${signed(sum(costs))} out`} />
        <StatTile label="Treasury" value={Math.round(treasury)} tone={treasury < 0 ? 'bad' : undefined} sub={econ.netCapital < 0 && treasury > 0 ? `lasts about ${Math.floor(treasury / -econ.netCapital)} months` : committed.capital > 0 ? `after ${Math.round(committed.capital)} on this month's orders` : 'money in hand'} />
        <StatTile label="Food a month" value={signed(econ.netFood)} tone={econ.netFood < 0 ? 'bad' : undefined} sub={`${Math.round(player.resources.food)} in store`} />
      </Tiles>

      <Card title="Taxes and the draft" hint="They change when the month ends." right={<Pending show={Math.abs(tax - player.taxRate) > 1e-9 || Math.abs(draft - player.draftRate) > 1e-9} />}>
        <SliderRow label="Income tax" value={tax} min={TAX_LIMITS.min} max={TAX_LIMITS.max} onChange={(v) => setPolicy({ taxRate: v })} neutral={0.2} hint="20% is neutral. Higher raises money but people resent it; lower pleases them but earns less." />
        <SliderRow label="Draft" value={draft} min={DRAFT_LIMITS.min} max={maxDraft} onChange={(v) => setPolicy({ draftRate: v })} hint={`Turns workers into soldiers you can train. Fewer workers means less money and food.${maxDraft < DRAFT_LIMITS.maxWithConscription ? ` Above ${Math.round(DRAFT_LIMITS.max * 100)}% needs the Conscription law (Government, Laws).` : ''}`} />
        <div className="text-[14px] space-y-1">
          <Line k="New soldiers each month" v={`${signed(econ.militaryRegen, 0)}k`} />
          <Line k="Jobs filled" v={`${Math.round(econ.laborRatio * 100)}%`} warn={econ.laborRatio < 0.9} />
        </div>
        <p className="text-[12px] text-white/60">Business tax is in Business; the interest rate, printing and bonds in Bank.</p>
      </Card>

      <Card title="Money each month" hint="Every line the engine adds up, grouped. Open a group to see its lines and where they are set.">
        <div className="space-y-1.5">
          <Fold title="Income" value={signed(sum(income))} open>
            {income.map((l) => (
              <Line key={l.label} k={name(l)} v={signed(l.amount)} />
            ))}
          </Fold>
          {groups.map((g) => (
            <Fold key={g.name} title={g.name} value={signed(sum(g.lines))}>
              {g.lines.map((l) => (
                <Line key={l.label} k={name(l)} v={signed(l.amount)} />
              ))}
              {g.to && (
                <div className="pt-1">
                  <GoTo to={g.to} className="text-[13px] px-2.5 py-1">
                    Set in {g.link}
                  </GoTo>
                </div>
              )}
            </Fold>
          ))}
        </div>
        <div className="text-[14px] px-3">
          <Line k="Left over" v={signed(econ.netCapital)} warn={econ.netCapital < 0} strong />
        </div>
      </Card>
    </section>
  )
}
