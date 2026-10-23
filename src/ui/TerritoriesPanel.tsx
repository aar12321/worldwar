import { motion } from 'framer-motion'
import { UPGRADE_SPECS, upgradeCost } from '../data/development'
import { developmentBonus, populationGrowth, territoryDevOf, territoryPopulation, territoryYield } from '../engine/development'
import { UPGRADE_SECONDS, formatSeconds } from '../engine/pace'
import { territoriesOf } from '../engine/territory'
import { TERRITORY_UPGRADES, type Order, type TerritoryUpgrade } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { Pips, Stat, Tip } from './bits'
import { signed, usePlayerView } from './hooks'
import { OrderButton, PanelShell } from './panel'

export function TerritoriesPanel() {
  const view = usePlayerView()
  const selectedTerritory = useGame((s) => s.selectedTerritory)
  const focusTerritory = useGame((s) => s.focusTerritory)
  const selectRegion = useGame((s) => s.selectRegion)
  if (!view) return null
  const { game, player, orders } = view
  const { map } = getWorld()
  const bonus = developmentBonus(game, map, player.id)
  const ownedTerritories = territoriesOf(game, map, player.id)
  const owned = [...new Set(ownedTerritories.map((id) => map.territories[id].regionId))].sort()
  const territoryTotal = ownedTerritories.length

  return (
    <PanelShell title="Land" kicker={`${territoryTotal} districts across ${owned.length} ${owned.length === 1 ? 'country' : 'countries'}`} panel="territories">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Money" value={signed(bonus.capital)} />
        <Stat label="Food" value={signed(bonus.food)} />
        <Stat label="Upkeep" value={signed(-bonus.upkeep)} warn={bonus.upkeep > 0} />
      </div>
      <p className="text-[13px] leading-snug text-white/60">
        Each country is split into territories. Upgrades take well under a minute and then pay you every month. Captured land keeps its buildings, a little worse for wear.
      </p>
      {owned.map((regionId) => {
        const region = game.regions[regionId]
        const ids = map.territoriesByRegion[regionId] ?? []
        const housing = ids.reduce((sum, id) => sum + territoryDevOf(game, id).housing, 0)
        const growth = (populationGrowth(player.foodShortage, housing, ids.length) - 1) * 100
        return (
          <section key={regionId} className="space-y-2">
            <button type="button" className="w-full flex items-baseline justify-between gap-2 text-left" onClick={() => selectRegion(regionId)}>
              <span className="text-[15px] font-semibold tracking-tight">{map.regions[regionId].name}</span>
              <span className="text-[12px] text-white/45 tabular-nums">
                {region.population.toFixed(1)}m · {growth >= 0 ? '+' : ''}
                {growth.toFixed(2)}%/mo
              </span>
            </button>
            {ids.filter((id) => ownedTerritories.includes(id)).map((id, index) => (
              <TerritoryCard key={id} territoryId={id} index={index} selected={selectedTerritory === id} onFocus={() => focusTerritory(id)} orders={orders} />
            ))}
          </section>
        )
      })}
    </PanelShell>
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
      <div className="space-y-1.5">
        {TERRITORY_UPGRADES.map((upgrade) => {
          const spec = UPGRADE_SPECS[upgrade]
          const level = dev[upgrade]
          const orderIndex = orders.findIndex((order) => order.type === 'develop' && order.territoryId === territoryId && order.upgrade === upgrade)
          const project = (game.projects ?? []).find((item) => item.kind === 'develop' && item.territoryId === territoryId && item.upgrade === upgrade)
          const cost = upgradeCost(upgrade, level)
          const fraction = project && project.total > 0 ? Math.min(1, (project.total - project.remaining) / project.total) : 0
          return (
            <div key={upgrade} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <Tip text={spec.blurb}>
                    <span className="text-[13px] font-semibold cursor-help">{spec.name}</span>
                  </Tip>
                  <Pips value={level} max={spec.max} />
                </div>
                {project ? (
                  <div className="mt-1">
                    <div className="h-1.5 rounded-full bg-white/12 overflow-hidden">
                      <div className="h-full bg-[#0a84ff]" style={{ width: `${Math.max(8, fraction * 100)}%` }} />
                    </div>
                    <p className="text-[11px] text-white/50 tabular-nums mt-0.5">{formatSeconds(project.remaining)} left</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-white/40">{upgradeLine(upgrade, level)} · {cost} money · {formatSeconds(UPGRADE_SECONDS[upgrade])}</p>
                )}
              </div>
              {level >= spec.max ? (
                <span className="text-[12px] font-semibold text-[#30d158] shrink-0">Max</span>
              ) : project ? (
                <button type="button" className="btn btn-quiet shrink-0" onClick={() => cancelLiveProject(project.id)}>
                  Cancel
                </button>
              ) : orderIndex >= 0 ? (
                <button type="button" className="btn btn-quiet shrink-0" onClick={() => removeOrder(orderIndex)}>
                  Cancel
                </button>
              ) : (
                <OrderButton className="shrink-0" tone="btn-primary" showError order={{ type: 'develop', nationId: player.id, territoryId, upgrade }} label={`${level ? 'Upgrade' : 'Build'} · ${cost}`} />
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
