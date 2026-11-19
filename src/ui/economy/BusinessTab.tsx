import { useState } from 'react'
import { BUSINESS, INVEST, SECTORS, SECTOR_IDS } from '../../data/business'
import { CORPORATE_TAX } from '../../data/government'
import { fundingGain, growthClimate, investedIn, sectorCap } from '../../engine/business'
import { nationWorkforce } from '../../engine/economy'
import { policyEffects } from '../../engine/policy'
import type { SectorId } from '../../engine/types'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { ENTERPRISE, ARMS_EXPORTS } from '../../data/projects'
import { tierOf } from '../../engine/empire'
import { enterpriseCost, enterpriseEfficiency } from '../../engine/industry'
import { signed, usePlayerView } from '../hooks'
import { Bar, Pending } from '../kit'
import { OrderButton } from '../panel'
import { Card, GoTo, Line, SliderRow } from './parts'

/** Private business: six sectors that grow on their own, and what you can do to help or tax them. */
export function BusinessTab() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const { game, player, econ } = view
  const setPrograms = useGame((st) => st.setPrograms)
  const spec0 = tierOf(player)
  const { map } = getWorld()
  const corp = view.pendingPolicy.corporateTax
  const cap = sectorCap(nationWorkforce(game, map, player.id))
  const climate = growthClimate({ ...player, corporateTax: corp }, policyEffects(player))
  const mine = game.investments.filter((i) => i.investor === player.id)
  const theirs = game.investments.filter((i) => i.target === player.id)

  return (
    <section className="econ-grid">
      <Card title="Business climate" hint="Private firms grow by themselves. Low business tax, calm people, schools and new technology help them. They pay you a tax on their profit.">
        <SliderRow label="Business tax" value={corp} min={CORPORATE_TAX.min} max={CORPORATE_TAX.max} onChange={(v) => setPolicy({ corporateTax: v })} neutral={BUSINESS.neutralTax} hint={`${Math.round(BUSINESS.neutralTax * 100)}% is neutral. Higher raises money now and slows growth.`} />
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="Growth" value={climate >= 1.15 ? 'Booming' : climate >= 0.85 ? 'Steady' : 'Slow'} warn={climate < 0.85} />
          <Mini label="Tax income" value={signed(econ.corporateIncome)} />
          <Mini label="Room per sector" value={cap.toFixed(0)} />
        </div>
      </Card>

      <Card title="Sectors" hint={`Each grows by itself. Open one to fund it, subsidize it or bring it into state hands. ${player.stateOwned.length} state-owned, ${player.subsidies.length} subsidized.`}>
        <div className="space-y-1.5">
          {SECTOR_IDS.map((id) => (
            <SectorRow key={id} id={id} cap={cap} />
          ))}
        </div>
      </Card>

      <Card title="Arms exports" hint="Sell weapons from your arms makers. Income is capped at a tenth of your earnings and it feeds the arms sector, but selling to anyone costs your reputation each month." right={<Pending show={view.pendingPrograms.armsExports !== player.programs.armsExports} />}>
        <div className="grid grid-cols-3 gap-1.5">
          {([['off', 'Off'], ['friends', 'Friends'], ['anyone', 'Anyone']] as const).map(([k, name]) => (
            <button
              key={k}
              className={`btn px-2.5 py-2 text-[13px] ${view.pendingPrograms.armsExports === k ? 'btn-primary' : 'btn-quiet'}`}
              disabled={k === 'anyone' && !spec0.armsToAnyone}
              title={k === 'anyone' && !spec0.armsToAnyone ? 'Needs a Regional power (4 countries)' : undefined}
              aria-pressed={view.pendingPrograms.armsExports === k}
              onClick={() => setPrograms({ armsExports: k })}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="text-[14px] space-y-1">
          <Line k="Arms income now" v={signed(econ.armsExports)} />
          <Line k="Arms sector grows" v={`+${(ARMS_EXPORTS.growth * 100).toFixed(1)}% a month faster`} />
        </div>
      </Card>

      <Card title="Investments" hint={`Put money into another nation's firms. They grow, you earn ${(INVEST.dividend * 100).toFixed(1)}% of it back every month, and they like you for it. The money runs down as it pays, so it earns back a little more than you put in, over about 11 years. A war seizes it.`} right={<GoTo to={{ desk: 'diplomacy' }}>Diplomacy</GoTo>}>
        {mine.length === 0 && theirs.length === 0 && <p className="text-[14px] text-white/70">No investments yet. You invest from a nation's page in Diplomacy.</p>}
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

/** One sector on one line (its size, and whether the state owns or subsidizes it); opening it shows what can be done with it. */
function SectorRow({ id, cap }: { id: SectorId; cap: number }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const { player } = view
  const [open, setOpen] = useState(false)
  const size = player.sectors[id] ?? 0
  const spec = SECTORS[id]
  const subsidized = player.subsidies.includes(id)
  const owned = player.stateOwned.includes(id)
  const fund = (amount: number) => ({ type: 'fundSector' as const, nationId: player.id, sector: id, amount })
  const toggleSubsidy = () => issueOrder({ type: 'setSubsidies', nationId: player.id, sectors: subsidized ? player.subsidies.filter((x) => x !== id) : [...player.subsidies, id] })
  return (
    <div className="rounded-xl bg-white/5">
      <button className="w-full text-left p-2.5 space-y-1.5 min-h-[44px]" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[15px] font-semibold min-w-0 truncate inline-flex items-center gap-2">
            <span aria-hidden className={`chev ${open ? 'chev-open' : ''}`} />
            {spec.name}
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            {owned && <span className="chip text-[12px]">State</span>}
            {subsidized && <span className="chip text-[12px]">Subsidized</span>}
            <span className="text-[14px] font-semibold tabular-nums">
              {size.toFixed(1)}
              <span className="text-white/60"> of {cap.toFixed(0)}</span>
            </span>
          </span>
        </div>
        <Bar value={size / Math.max(1, cap)} color="#30d158" label={`${spec.name} ${size.toFixed(1)} of ${cap.toFixed(0)}`} />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <p className="text-[13px] text-white/70">
            {spec.blurb} Each point makes {spec.yields} a month.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <OrderButton order={fund(50)} label="Grant 50" cost="50 money" effect={`+${fundingGain(size, 50).toFixed(1)} size`} tone="btn-primary" />
            <OrderButton order={fund(150)} label="Grant 150" cost="150 money" effect={`+${fundingGain(size, 150).toFixed(1)} size`} tone="btn-primary" />
          </div>
          {owned ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[#0a84ff]/10 p-2.5 text-[13px]">
              <span>
                <b>State-owned.</b> The state keeps {Math.round(enterpriseEfficiency(player) * 100)}% of its profit ({signed(size * spec.profit * enterpriseEfficiency(player))} a month). It grows at half speed.
              </span>
              <OrderButton order={{ type: 'setStateOwned', nationId: player.id, sector: id, mode: 'sell' }} label="Sell" cost={`+${Math.round(ENTERPRISE.sellPerSize * size)}`} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <OrderButton order={{ type: 'setStateOwned', nationId: player.id, sector: id, mode: 'buy' }} label="Buy it" cost={`${enterpriseCost(player, id, 'buy')}`} effect="The state takes its profit" />
              <OrderButton order={{ type: 'setStateOwned', nationId: player.id, sector: id, mode: 'seize' }} label="Seize it" effect={`Free, but stability -${ENTERPRISE.seizeStability} and investors flee`} className="btn-red" />
            </div>
          )}
          <label className="flex items-center justify-between gap-3 text-[14px]">
            <span>
              Subsidize
              <span className="block text-[12px] text-white/65">
                Grows {Math.round(BUSINESS.subsidyGrowth * 100)}% faster. Costs {(size * BUSINESS.subsidyCost).toFixed(1)} money a month.
              </span>
            </span>
            <input type="checkbox" checked={subsidized} onChange={toggleSubsidy} aria-label={`Subsidize ${spec.name}`} />
          </label>
        </div>
      )}
    </div>
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
