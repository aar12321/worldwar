import { CITY_RULES, FOCUS, FOCUS_IDS } from '../../data/cities'
import { BUILDING_SPECS } from '../../data/unitTypes'
import { cityDevelopCost, cityLevelCap } from '../../engine/cities'
import { buildingCap, integrationFactor, regionWorkforce } from '../../engine/economy'
import { orderCost } from '../../engine/orders'
import { regionsOf } from '../../engine/helpers'
import { BUILDING_TYPES } from '../../engine/types'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { Pips } from '../bits'
import { usePlayerView } from '../hooks'
import { OrderButton } from '../panel'
import { Card } from './parts'

/** Upgrades and cities for one of your countries. */
export function CountryTab() {
  const view = usePlayerView()!
  const picked = useGame((s) => s.economyRegion)
  const setPicked = useGame((s) => s.setEconomyRegion)
  const { game, player } = view
  const { map } = getWorld()
  const owned = regionsOf(game, player.id)
  const regionId = picked && owned.includes(picked) ? picked : owned.includes(player.capital) ? player.capital : owned[0]
  const region = game.regions[regionId]
  const workforce = regionWorkforce(region, map.regions[regionId])
  const levelCap = cityLevelCap(workforce)
  if (!region) return null

  return (
    <section className="econ-grid">
      {owned.length > 1 && (
        <label className="block text-[14px] span-all">
          <span className="label block mb-1">Country</span>
          <select className="field w-full px-3 py-2" value={regionId} onChange={(e) => setPicked(e.target.value)}>
            {owned.map((id) => (
              <option key={id} value={id}>
                {map.regions[id].name}
                {game.regions[id].integration < 1 ? ` (settling, ${Math.round(integrationFactor(game.regions[id]) * 100)}% output)` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

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
