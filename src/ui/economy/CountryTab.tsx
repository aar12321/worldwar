import { CITY_RULES, FOCUS, FOCUS_IDS } from '../../data/cities'
import { TRAITS, traitOf } from '../../data/traits'
import { BUILDING_SPECS } from '../../data/unitTypes'
import { EMPIRE } from '../../data/war'
import { GOVERNOR_LABELS } from '../../engine/governors'
import type { Governor } from '../../engine/types'
import { cityDevelopCost, cityLevelCap } from '../../engine/cities'
import { buildingCap, integrationFactor, regionWorkforce } from '../../engine/economy'
import { orderCost } from '../../engine/orders'
import { regionsOf } from '../../engine/helpers'
import { BUILDING_TYPES } from '../../engine/types'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { useMemo, useState } from 'react'
import { planBulk, type BulkTarget } from '../../engine/bulk'
import { Pips } from '../bits'
import { usePlayerView } from '../hooks'
import { OrderButton } from '../panel'
import { Card } from './parts'

/** Upgrade every country at once: one kind of building, every city, or a little of everything, with the exact cost shown first. */
function BulkUpgrade({ owned }: { owned: string[] }) {
  const view = usePlayerView()!
  const issueBatch = useGame((s) => s.issueBatch)
  const { game, player } = view
  const { map } = getWorld()
  const [target, setTarget] = useState<BulkTarget>('factory')
  const [levels, setLevels] = useState(1)
  const [settledOnly, setSettledOnly] = useState(false)
  const [keepReserve, setKeepReserve] = useState(true)
  const plan = useMemo(
    () => planBulk(game, map, player.id, { target, levels, settledOnly, reserve: keepReserve ? EMPIRE.governorReserve : 0 }),
    [game, map, player.id, target, levels, settledOnly, keepReserve],
  )
  const reasons = [plan.skipped.atMax > 0 && `${plan.skipped.atMax} already at their highest level`, plan.skipped.noMoney > 0 && `${plan.skipped.noMoney} not affordable`].filter(Boolean)
  return (
    <div className="rounded-xl bg-white/5 p-3 space-y-2.5">
      <div>
        <div className="text-[15px] font-semibold">Upgrade everything at once</div>
        <p className="text-[12px] text-white/65">Spreads the money evenly: the lowest-level countries go first, and one level is added everywhere before a second is added anywhere.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-[13px]">
          <span className="label block mb-1">Upgrade</span>
          <select className="field w-full px-2 py-1.5" value={target} onChange={(e) => setTarget(e.target.value as BulkTarget)} aria-label="What to upgrade">
            {BUILDING_TYPES.map((b) => (
              <option key={b} value={b}>
                {BUILDING_SPECS[b].name}
              </option>
            ))}
            <option value="cities">Every city</option>
            <option value="all">A little of everything</option>
          </select>
        </label>
        <label className="block text-[13px]">
          <span className="label block mb-1">Levels in each country</span>
          <select className="field w-full px-2 py-1.5" value={levels} onChange={(e) => setLevels(+e.target.value)} aria-label="Levels in each country">
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'One level' : `Up to ${n} levels`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settledOnly} onChange={(e) => setSettledOnly(e.target.checked)} /> Only countries that have settled
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={keepReserve} onChange={(e) => setKeepReserve(e.target.checked)} /> Keep {EMPIRE.governorReserve} money in reserve
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px] text-white/80" aria-live="polite">
          {plan.upgrades > 0 ? (
            <>
              <strong>{plan.upgrades}</strong> upgrade{plan.upgrades === 1 ? '' : 's'} in <strong>{plan.countries}</strong> of {owned.length} countries for <strong>{Math.round(plan.cost)} money</strong>.
            </>
          ) : (
            'Nothing can be upgraded with these settings.'
          )}
          {reasons.length > 0 && <span className="block text-white/60">Skipped: {reasons.join(', ')}.</span>}
        </div>
        <button
          className="btn btn-primary"
          disabled={plan.upgrades === 0}
          onClick={() => {
            const r = issueBatch(plan.orders)
            if (r.done > 0) useGame.getState().toast(`${r.done} upgrade${r.done === 1 ? '' : 's'} made`, 'success', 3000)
          }}
        >
          Upgrade all
        </button>
      </div>
    </div>
  )
}

/** Every country you hold, in one list: its trait, how settled it is, and a governor who develops it for you. */
function Empire({ owned, regionId }: { owned: string[]; regionId: string }) {
  const view = usePlayerView()!
  const setPicked = useGame((s) => s.setEconomyRegion)
  const issueOrder = useGame((s) => s.issueOrder)
  const issueBatch = useGame((s) => s.issueBatch)
  const { game, player } = view
  const { map } = getWorld()
  const unsettled = owned.filter((id) => game.regions[id].integration < 1).length
  return (
    <div className="span-all inset-card p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-semibold">Your empire</h3>
        <span className="text-[13px] text-white/70">
          {owned.length} countries{unsettled > 0 ? ` · ${unsettled} still settling` : ''}. A governor upgrades a country each month and never spends your last {EMPIRE.governorReserve} money.
        </span>
      </div>
      <BulkUpgrade owned={owned} />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
        <span className="text-[13px] text-white/80">Set a governor for every country</span>
        <select
          className="field px-2 py-1.5 text-[13px]"
          aria-label="Governor for every country"
          value=""
          onChange={(e) => {
            if (!e.target.value) return
            issueBatch(owned.map((id) => ({ type: 'setGovernor' as const, nationId: player.id, regionId: id, governor: e.target.value as Governor })))
          }}
        >
          <option value="">Choose a plan for all…</option>
          {(Object.keys(GOVERNOR_LABELS) as Governor[]).map((g) => (
            <option key={g} value={g}>
              {GOVERNOR_LABELS[g]}
            </option>
          ))}
        </select>
      </div>
      <ul className="space-y-1.5">
        {owned.map((id) => {
          const r = game.regions[id]
          const tr = TRAITS[traitOf(id, map.regions[id])]
          return (
            <li key={id} className={`rounded-xl px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 ${id === regionId ? 'bg-[#0a84ff]/18 border border-[#0a84ff]/50' : 'bg-white/5'}`}>
              <button className="min-w-0 flex-1 text-left" onClick={() => setPicked(id)} aria-pressed={id === regionId}>
                <span className="block text-[15px] font-semibold truncate">
                  {map.regions[id].name}
                  {id === player.capital && <span className="ml-1.5 text-[12px] text-white/60 font-normal">capital</span>}
                </span>
                <span className="block text-[12px] text-white/70">
                  {tr.name} · {r.integration < 1 ? `settling, ${Math.round(integrationFactor(r) * 100)}% output` : 'fully settled'}
                  {r.rebels > 0 ? ' · rebels' : ''}
                </span>
              </button>
              <select
                className="field px-2 py-1.5 text-[13px]"
                aria-label={`Governor of ${map.regions[id].name}`}
                value={r.governor ?? 'off'}
                onChange={(e) => issueOrder({ type: 'setGovernor', nationId: player.id, regionId: id, governor: e.target.value as Governor })}
              >
                {(Object.keys(GOVERNOR_LABELS) as Governor[]).map((g) => (
                  <option key={g} value={g}>
                    {GOVERNOR_LABELS[g]}
                  </option>
                ))}
              </select>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Upgrades and cities for one of your countries. */
export function CountryTab() {
  const view = usePlayerView()!
  const picked = useGame((s) => s.economyRegion)
  const { game, player } = view
  const { map } = getWorld()
  const owned = regionsOf(game, player.id)
  const regionId = picked && owned.includes(picked) ? picked : owned.includes(player.capital) ? player.capital : owned[0]
  const region = game.regions[regionId]
  const workforce = regionWorkforce(region, map.regions[regionId])
  const levelCap = cityLevelCap(workforce)
  if (!region) return null
  const trait = traitOf(regionId, map.regions[regionId])

  return (
    <section className="econ-grid">
      {owned.length > 1 && <Empire owned={owned} regionId={regionId} />}
      <div className="span-all flex flex-wrap items-center gap-2 text-[14px]">
        <span className="chip">{TRAITS[trait].name}</span>
        <span className="text-white/70">{TRAITS[trait].blurb}</span>
      </div>

      <div className="space-y-2.5">
        <div>
          <h3 className="text-[16px] font-semibold">Cities</h3>
          <p className="text-[13px] text-white/70">Cities hold your people. A bigger city adds workforce, and its focus boosts the whole country. A city can grow to level {levelCap} here.</p>
        </div>
        {region.cities.map((city) => {
          const focus = FOCUS[city.focus]
          return (
            <Card
              key={city.id}
              title={city.name}
              hint={`${focus.name}: ${focus.blurb}`}
              right={
                <span className="flex flex-col items-end gap-1 shrink-0">
                  <Pips value={city.level} max={CITY_RULES.maxLevel} />
                  <span className="text-[12px] text-white/70">Level {city.level}{city.port ? ' · port' : ''}</span>
                </span>
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-[14px]">
                  <span className="text-white/75">Focus</span>
                  <FocusPicker regionId={regionId} cityId={city.id} port={city.port} current={city.focus} />
                </label>
                {city.level >= CITY_RULES.maxLevel ? (
                  <span className="chip chip-green">Largest size</span>
                ) : (
                  <OrderButton
                    order={{ type: 'developCity', nationId: player.id, regionId, cityId: city.id }}
                    label={`Grow to level ${city.level + 1}`}
                    cost={`${cityDevelopCost(city)} money`}
                    effect="More workers, and a stronger focus"
                    tone="btn-primary"
                  />
                )}
              </div>
            </Card>
          )
        })}
      </div>

      <div className="space-y-2.5">
        <div>
          <h3 className="text-[16px] font-semibold">Upgrades</h3>
          <p className="text-[13px] text-white/70">Each upgrade works the moment you buy it. Bigger countries can reach higher levels.</p>
        </div>
        {BUILDING_TYPES.map((b) => {
          const spec = BUILDING_SPECS[b]
          const level = region.buildings[b]
          const cap = buildingCap(workforce, b)
          if (spec.requiresCoast && !map.regions[regionId].coastal) return null
          const order = { type: 'build' as const, nationId: player.id, regionId, building: b }
          return (
            <div key={b} className="inset-card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold tracking-tight">{spec.name}</div>
                  <div className="text-[13px] text-white/70 mt-0.5">{spec.description}</div>
                </div>
                <span className="text-[14px] font-semibold tabular-nums shrink-0">
                  Level {level}
                  <span className="text-white/60"> of {cap}</span>
                </span>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <Pips value={Math.min(level, 10)} max={Math.min(cap, 10)} />
                {level >= cap ? <span className="chip chip-green">Highest level</span> : <OrderButton order={order} label="Upgrade" cost={`${orderCost(game, order).capital} money`} effect={spec.effect} tone="btn-primary" />}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function FocusPicker({ regionId, cityId, port, current }: { regionId: string; cityId: string; port: boolean; current: (typeof FOCUS_IDS)[number] }) {
  const issueOrder = useGame((s) => s.issueOrder)
  const view = usePlayerView()!
  return (
    <select
      className="field px-2.5 py-1.5 text-[14px]"
      aria-label="City focus"
      value={current}
      onChange={(e) => issueOrder({ type: 'setCityFocus', nationId: view.player.id, regionId, cityId, focus: e.target.value as (typeof FOCUS_IDS)[number] })}
    >
      {FOCUS_IDS.map((f) => (
        <option key={f} value={f} disabled={FOCUS[f].needsPort && !port}>
          {FOCUS[f].name}
          {f !== current ? ` (${CITY_RULES.focusCost} money)` : ''}
          {FOCUS[f].needsPort && !port ? ' - coast only' : ''}
        </option>
      ))}
    </select>
  )
}
