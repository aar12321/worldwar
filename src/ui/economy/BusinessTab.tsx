import { BUSINESS, INVEST, SECTORS, SECTOR_IDS } from '../../data/business'
import { CORPORATE_TAX } from '../../data/government'
import { fundingGain, growthClimate, investedIn, sectorCap } from '../../engine/business'
import { nationWorkforce } from '../../engine/economy'
import { policyEffects } from '../../engine/policy'
import type { SectorId } from '../../engine/types'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { signed, usePlayerView } from '../hooks'
import { OrderButton } from '../panel'
import { Card, SliderRow } from './parts'

/** Private business: six sectors that grow on their own, and what you can do to help or tax them. */
export function BusinessTab() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const issueOrder = useGame((s) => s.issueOrder)
  const { game, player, econ } = view
  const { map } = getWorld()
  const corp = view.pendingPolicy.corporateTax
  const cap = sectorCap(nationWorkforce(game, map, player.id))
  const climate = growthClimate({ ...player, corporateTax: corp }, policyEffects(player))
  const mine = game.investments.filter((i) => i.investor === player.id)
  const theirs = game.investments.filter((i) => i.target === player.id)
  const toggleSubsidy = (id: SectorId) => issueOrder({ type: 'setSubsidies', nationId: player.id, sectors: player.subsidies.includes(id) ? player.subsidies.filter((x) => x !== id) : [...player.subsidies, id] })

  return (
    <section className="econ-grid">
      <Card title="Business climate" hint="Private firms grow by themselves. Low business tax, calm people, schools and new technology help them. They pay you a tax on their profit.">
        <SliderRow label="Business tax" value={corp} min={CORPORATE_TAX.min} max={CORPORATE_TAX.max} onChange={(v) => setPolicy({ corporateTax: v })} hint={`${Math.round(BUSINESS.neutralTax * 100)}% is neutral. Higher raises money now and slows growth.`} />
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="Growth" value={climate >= 1.15 ? 'Booming' : climate >= 0.85 ? 'Steady' : 'Slow'} warn={climate < 0.85} />
          <Mini label="Tax income" value={signed(econ.corporateIncome)} />
          <Mini label="Room per sector" value={cap.toFixed(0)} />
        </div>
      </Card>

      {SECTOR_IDS.map((id) => {
        const size = player.sectors[id] ?? 0
        const spec = SECTORS[id]
        const subsidized = player.subsidies.includes(id)
        const fund = (amount: number) => ({ type: 'fundSector' as const, nationId: player.id, sector: id, amount })
        return (
          <Card key={id} title={spec.name} hint={`${spec.blurb} Each point makes ${spec.yields} a month.`} right={<span className="text-[14px] font-semibold tabular-nums shrink-0">{size.toFixed(1)}<span className="text-white/60"> of {cap.toFixed(0)}</span></span>}>
            <div className="h-2 rounded-full bg-white/12 overflow-hidden" role="img" aria-label={`${spec.name} ${size.toFixed(1)} of ${cap.toFixed(0)}`}>
              <div className="h-full bg-[#30d158]" style={{ width: `${Math.min(100, (size / cap) * 100)}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <OrderButton order={fund(50)} label="Grant 50" cost="50 money" effect={`+${fundingGain(size, 50).toFixed(1)} size`} tone="btn-primary" />
              <OrderButton order={fund(150)} label="Grant 150" cost="150 money" effect={`+${fundingGain(size, 150).toFixed(1)} size`} tone="btn-primary" />
            </div>
            <label className="flex items-center justify-between gap-3 text-[14px]">
              <span>
                Subsidize
                <span className="block text-[12px] text-white/65">
                  Grows {Math.round(BUSINESS.subsidyGrowth * 100)}% faster. Costs {(size * BUSINESS.subsidyCost).toFixed(1)} money a month.
                </span>
              </span>
              <input type="checkbox" checked={subsidized} onChange={() => toggleSubsidy(id)} aria-label={`Subsidize ${spec.name}`} />
            </label>
          </Card>
        )
      })}

      <Card title="Investments" hint={`Put money into another nation's firms. They grow, you earn ${(INVEST.dividend * 100).toFixed(1)}% of it back every month, and they like you for it. A war seizes it.`}>
        {mine.length === 0 && theirs.length === 0 && <p className="text-[14px] text-white/70">No investments yet. Open Diplomacy and pick a nation to invest in.</p>}
        {mine.map((i) => (
          <div key={i.id} className="flex justify-between text-[14px]">
            <span>
              {game.nations[i.target]?.name} · {SECTORS[i.sector].name}
            </span>
            <span className="tabular-nums text-[#6eeb8a]">{i.amount.toFixed(0)} in, +{(i.amount * INVEST.dividend).toFixed(1)} a month</span>
          </div>
        ))}
        {theirs.length > 0 && (
          <p className="text-[13px] text-white/75">
            Foreign money in your firms: {investedIn(game, player.id).toFixed(0)} from {new Set(theirs.map((i) => game.nations[i.investor]?.name)).size} nation(s).
          </p>
        )}
      </Card>
    </section>
  )
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-white/6 py-2">
      <div className="label">{label}</div>
      <div className={`text-[16px] font-semibold tabular-nums ${warn ? 'text-[#ff8a84]' : ''}`}>{value}</div>
    </div>
  )
}
