import { BUDGET, BUDGET_KEYS, BUDGET_LIMITS, GOVERNMENTS, GOVERNMENT_TYPES, REFORM, budgetEffects, buildDiscount } from '../../data/government'
import { LAW_SPECS } from '../../data/unitTypes'
import { monthsToElection } from '../../engine/politics'
import type { LawId } from '../../engine/types'
import { useGame } from '../../store'
import { usePlayerView } from '../hooks'
import { OrderButton } from '../panel'
import { pct1, rebalanceBudget } from './budget'
import { Card, SliderRow } from './parts'

/** The form of government, where tax money goes, and the laws. */
export function GovernmentTab() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const { game, player } = view
  const budget = view.pendingPolicy.budget
  const gov = GOVERNMENTS[player.government]
  const election = monthsToElection(game, player.id)
  const effects = budgetEffects(budget)
  const note = (k: (typeof BUDGET_KEYS)[number]) => {
    if (k === 'military') return `Upkeep ${signedPct(effects.upkeep ?? 0)}`
    if (k === 'education') return `Research ${signedPct(effects.research ?? 0)}, business growth ${signedPct(effects.growth ?? 0)}`
    if (k === 'health') return `Stability ${(effects.stability ?? 0) >= 0 ? '+' : ''}${(effects.stability ?? 0).toFixed(1)}`
    return `Trade room ${signedPct(effects.trade ?? 0)}, upgrades ${signedPct(buildDiscount(budget))}`
  }

  return (
    <section className="econ-grid">
      <Card title={gov.name} hint={gov.blurb} right={<span className="chip">Your government</span>}>
        {election !== null && <p className="text-[14px]">Next election in {election} months. You need stability of at least 45% to win it.</p>}
        <div className="grid gap-2">
          {GOVERNMENT_TYPES.filter((g) => g !== player.government).map((g) => (
            <div key={g} className="rounded-xl bg-white/5 p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">{GOVERNMENTS[g].name}</div>
                <div className="text-[13px] text-white/70">{GOVERNMENTS[g].blurb}</div>
              </div>
              <OrderButton
                order={{ type: 'setGovernment', nationId: player.id, government: g }}
                label="Change"
                cost={`${REFORM.cost} influence`}
                effect={`Stability -${REFORM.turmoil} at once`}
                className="shrink-0"
              />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Where tax money goes" hint="Four shares that always add up to 100%. Leaning one way means you lean away from the others. It changes when you press Next turn.">
        {BUDGET_KEYS.map((k) => (
          <SliderRow
            key={k}
            label={BUDGET[k].name}
            value={budget[k]}
            min={BUDGET_LIMITS.min}
            max={BUDGET_LIMITS.max}
            step={0.01}
            onChange={(v) => setPolicy({ budget: rebalanceBudget(budget, k, v) })}
            format={pct1}
            hint={`${BUDGET[k].blurb} ${note(k)}.`}
          />
        ))}
      </Card>

      <div className="space-y-2.5">
        <div>
          <h3 className="text-[16px] font-semibold">Laws</h3>
          <p className="text-[13px] text-white/70">A law costs influence to pass and takes effect at once. You can repeal it for free.</p>
        </div>
        {(Object.keys(LAW_SPECS) as LawId[]).map((law) => {
          const active = player.laws.includes(law)
          return (
            <div key={law} className="inset-card p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[16px] font-semibold tracking-tight">{LAW_SPECS[law].name}</span>
                {active ? (
                  <OrderButton order={{ type: 'repealLaw', nationId: player.id, law }} label="Repeal" />
                ) : (
                  <OrderButton order={{ type: 'enactLaw', nationId: player.id, law }} label="Pass" cost={`${LAW_SPECS[law].cost} influence`} tone="btn-primary" />
                )}
              </div>
              <p className="text-[13px] text-white/70 mt-1.5">
                {active ? 'In force. ' : ''}
                {LAW_SPECS[law].description}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`
