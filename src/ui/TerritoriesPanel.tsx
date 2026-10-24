import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { UPGRADE_SPECS, upgradeCost } from '../data/development'
import { BUILDING_SPECS } from '../data/unitTypes'
import { developmentBonus, populationGrowth, territoryDevOf, territoryPopulation, territoryYield } from '../engine/development'
import { BUILD_MONTHS, UPGRADE_MONTHS, formatMonths } from '../engine/pace'
import { territoriesOf } from '../engine/territory'
import { BUILDING_TYPES, TERRITORY_UPGRADES, type BuildingType, type Order, type TerritoryUpgrade } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { Pips, Stat, Tip } from './bits'
import { signed, usePlayerView } from './hooks'
import { OrderButton, PanelShell } from './panel'

export function TerritoriesPanel() {
  const view = usePlayerView()
  const selectedRegion = useGame((s) => s.selectedRegion)
  const selectedTerritory = useGame((s) => s.selectedTerritory)
  const selectRegion = useGame((s) => s.selectRegion)
  const focusTerritory = useGame((s) => s.focusTerritory)
  const openMilitary = useGame((s) => s.openMilitary)
  const { map } = getWorld()
  useEffect(() => {
    if (!selectedTerritory) return
    document.getElementById(`territory-${selectedTerritory}`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedTerritory])
  if (!view) return null
  const { game, player } = view
  const bonus = developmentBonus(game, map, player.id)
  const ownedTerritories = territoriesOf(game, map, player.id)
  const owned = [...new Set(ownedTerritories.map((id) => map.territories[id].regionId))].sort()
  const regionId = selectedRegion && owned.includes(selectedRegion) ? selectedRegion : owned[0]
  if (!regionId) {
    return (
      <PanelShell title="Land" kicker="No land remains" panel="territories">
        <p className="text-[13px] text-white/55">You have no country left to build in.</p>
      </PanelShell>
    )
  }
  const region = game.regions[regionId]
  const mr = map.regions[regionId]
  const ids = (map.territoriesByRegion[regionId] ?? []).filter((id) => ownedTerritories.includes(id))
  const housing = ids.reduce((sum, id) => sum + territoryDevOf(game, id).housing, 0)
  const growth = (populationGrowth(player.foodShortage, housing, ids.length) - 1) * 100

  return (
    <PanelShell
      title={mr.name}
      kicker={`${region.population.toFixed(1)}m people · ${growth >= 0 ? '+' : ''}${growth.toFixed(2)}% a month`}
      panel="territories"
      pinned={
        <>
          {owned.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto scroll-thin pb-1">
              {owned.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={id === regionId}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold ${id === regionId ? 'bg-white text-black' : 'bg-white/10 text-white/80'}`}
                  onClick={() => selectRegion(id)}
                >
                  {map.regions[id].name}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Money" value={signed(bonus.capital)} />
            <Stat label="Food" value={signed(bonus.food)} />
            <Stat label="Upkeep" value={signed(-bonus.upkeep)} warn={bonus.upkeep > 0} />
          </div>
        </>
      }
      footer={
        <button type="button" className="btn btn-primary w-full" onClick={() => openMilitary(selectedTerritory && ids.includes(selectedTerritory) ? selectedTerritory : ids[0])}>
          Train in {map.territories[selectedTerritory && ids.includes(selectedTerritory) ? selectedTerritory : ids[0]]?.name ?? 'this country'}
        </button>
      }
    >
      <section className="space-y-2">
        <div>
          <div className="text-[13px] font-semibold">Country buildings</div>
          <p className="text-[12px] text-white/50 mt-0.5">These belong to the whole country. District upgrades are below. Both finish when you end the month.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {BUILDING_TYPES.map((building) => (
            <BuildingCard key={building} regionId={regionId} building={building} />
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <div className="text-[13px] font-semibold">Districts</div>
        {ids.map((id, index) => (
          <TerritoryCard key={id} territoryId={id} index={index} selected={selectedTerritory === id} onFocus={() => focusTerritory(id)} orders={view.orders} />
        ))}
      </section>
    </PanelShell>
  )
}

function BuildingCard({ regionId, building }: { regionId: string; building: BuildingType }) {
  const view = usePlayerView()!
  const cancelLiveProject = useGame((s) => s.cancelLiveProject)
  const { game, player } = view
  const region = game.regions[regionId]
  const spec = BUILDING_SPECS[building]
  const project = (game.projects ?? []).find((item) => item.kind === 'build' && item.regionId === regionId && item.building === building)
  const fraction = project && project.total > 0 ? Math.min(1, (project.total - project.remaining) / project.total) : 0
  const coast = spec.requiresCoast ? ' · coast only' : ''
  return (
    <div className="inset-card p-3 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{spec.name}</span>
        <span className="text-[13px] tabular-nums text-white/70">
          {region.buildings[building]}
          {project && <span className="text-[#30d158]"> +1</span>}
        </span>
      </div>
      <p className="text-[12px] text-white/50 leading-snug">{spec.description}</p>
      {project ? (
        <div>
          <div className="h-1.5 rounded-full bg-white/12 overflow-hidden">
            <div className="h-full bg-[#30d158]" style={{ width: `${Math.max(8, fraction * 100)}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="text-[12px] text-white/60">{formatMonths(project.remaining)} left</p>
            <button type="button" className="btn btn-quiet shrink-0" onClick={() => cancelLiveProject(project.id)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <OrderButton className="w-full" showError tone="btn-primary" order={{ type: 'build', nationId: player.id, regionId, building }} label={`Build · ${spec.cost}`} sub={`${formatMonths(BUILD_MONTHS[building])}${coast}`} />
      )}
    </div>
  )
}

function TerritoryCard({
  territoryId,
  index,
  selected,
  onFocus,
  orders,
}: {
  territoryId: string
  index: number
  selected: boolean
  onFocus: () => void
  orders: Order[]
}) {
  const view = usePlayerView()!
  const removeOrder = useGame((s) => s.removeOrder)
  const cancelLiveProject = useGame((s) => s.cancelLiveProject)
  const { map } = getWorld()
  const territory = map.territories[territoryId]
  const { game, player } = view
  const dev = territoryDevOf(game, territoryId)
  const people = territoryPopulation(game, map, territory.regionId, territoryId)
  const yieldOf = territoryYield(dev)

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index, 6) * 0.03 }}
      id={`territory-${territoryId}`}
      className={`inset-card p-3 space-y-2.5 ${selected ? 'ring-1 ring-[#0a84ff]' : ''}`}
    >
      <button type="button" className="w-full text-left" onClick={onFocus}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold tracking-tight">{territory.name}</span>
          <span className="text-[12px] text-white/50 tabular-nums">{people.toFixed(1)}m people</span>
        </div>
        <p className="text-[12px] text-white/45 mt-0.5">
          {yieldOf.capital > 0 ? `+${yieldOf.capital.toFixed(1)} money` : 'No money yet'}
          {yieldOf.food > 0 ? ` · +${yieldOf.food.toFixed(1)} food` : ''}
          {yieldOf.pp > 0 ? ` · +${yieldOf.pp.toFixed(2)} influence` : ''}
          {yieldOf.tp > 0 ? ` · +${yieldOf.tp.toFixed(2)} research` : ''}
        </p>
      </button>
      <div className="grid grid-cols-2 gap-2">
        {TERRITORY_UPGRADES.map((upgrade) => {
          const spec = UPGRADE_SPECS[upgrade]
          const level = dev[upgrade]
          const orderIndex = orders.findIndex((order) => order.type === 'develop' && order.territoryId === territoryId && order.upgrade === upgrade)
          const project = (game.projects ?? []).find((item) => item.kind === 'develop' && item.territoryId === territoryId && item.upgrade === upgrade)
          const cost = upgradeCost(upgrade, level)
          const fraction = project && project.total > 0 ? Math.min(1, (project.total - project.remaining) / project.total) : 0
          return (
            <div key={upgrade} className="rounded-xl bg-black/20 px-2.5 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Tip text={spec.blurb}>
                  <span className="text-[13px] font-semibold cursor-help">{spec.name}</span>
                </Tip>
                <Pips value={level} max={spec.max} />
              </div>
              {project ? (
                <>
                  <div className="h-1.5 rounded-full bg-white/12 overflow-hidden">
                    <div className="h-full bg-[#0a84ff]" style={{ width: `${Math.max(8, fraction * 100)}%` }} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-white/50">{formatMonths(project.remaining)} left</p>
                    <button type="button" className="btn btn-quiet shrink-0" onClick={() => cancelLiveProject(project.id)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : level >= spec.max ? (
                <span className="text-[12px] font-semibold text-[#30d158]">Max</span>
              ) : orderIndex >= 0 ? (
                <button type="button" className="btn btn-quiet" onClick={() => removeOrder(orderIndex)}>
                  Cancel
                </button>
              ) : (
                <>
                  <p className="text-[11px] text-white/40">{upgradeLine(upgrade, level)} · {formatMonths(UPGRADE_MONTHS[upgrade])}</p>
                  <OrderButton className="w-full" tone="btn-primary" showError order={{ type: 'develop', nationId: player.id, territoryId, upgrade }} label={`${level ? 'Upgrade' : 'Build'} · ${cost}`} />
                </>
              )}
            </div>
          )
        })}
      </div>
    </motion.article>
  )
}

function upgradeLine(upgrade: TerritoryUpgrade, level: number): string {
  const spec = UPGRADE_SPECS[upgrade]
  if (upgrade === 'housing') return level ? 'People are moving here' : 'Grows the country'
  const parts: string[] = []
  if (spec.capital) parts.push(`+${spec.capital} money`)
  if (spec.food) parts.push(`+${spec.food} food`)
  if (spec.pp) parts.push(`+${spec.pp} influence`)
  if (spec.tp) parts.push(`+${spec.tp} research`)
  return parts.length ? `${parts.join(' · ')} per level` : spec.blurb
}
