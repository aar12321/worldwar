import { AnimatePresence, motion } from 'framer-motion'
import { TERRAIN } from '../data/terrain'
import { BUILDING_SPECS, COSTS, UNIT_SPECS } from '../data/unitTypes'
import { militaryPower } from '../engine/economy'
import { spySuccessChance } from '../engine/espionage'
import { armiesIn, atWar, hasCasusBelli, hasPact } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import { supplyDistances, supplyRange } from '../engine/supply'
import type { Order } from '../engine/types'
import { BUILDING_TYPES, UNIT_TYPES } from '../engine/types'
import { visibleRegions } from '../engine/visibility'
import { garrisonStrength } from '../engine/warfare'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { ArmyCard } from './ArmyOrders'
import { usePlayerView } from './hooks'

function ActionButton({ order, label, sub, tone = '' }: { order: Order; label: string; sub?: string; tone?: string }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const { map } = getWorld()
  const err = validateOrder(view.game, map, order, view.orders)
  return (
    <button className={`btn ${tone} flex flex-col items-start gap-0.5 text-left`} disabled={!!err} title={err ?? ''} onClick={() => issueOrder(order)}>
      <span>{label}</span>
      {sub && <span className="font-ui normal-case tracking-normal text-[11px] text-slate-400">{err ?? sub}</span>}
    </button>
  )
}

export function CountryPanel() {
  const view = usePlayerView()
  const selected = useGame((s) => s.selectedRegion)
  const selectRegion = useGame((s) => s.selectRegion)
  const { map } = getWorld()
  if (!view || !selected) return null
  const { game, player, orders } = view
  const region = game.regions[selected]
  const mr = map.regions[selected]
  const owner = game.nations[region.owner]
  const mine = region.owner === player.id
  const vis = visibleRegions(game, map, player.id)
  const canSee = vis === 'all' || vis.has(selected)
  const armies = canSee ? armiesIn(game, selected) : []
  const dist = mine ? supplyDistances(game, map, player.id).get(selected) : undefined
  const range = supplyRange(game, player.id)
  const queuedBuilds = (b: string) => orders.filter((o) => o.type === 'build' && o.regionId === selected && o.building === b).length
  const queuedRecruits = (u: string) => orders.filter((o) => o.type === 'recruit' && o.regionId === selected && o.unit === u).length
  const war = !mine && atWar(game, player.id, owner.id)
  const pact = !mine && hasPact(game, player.id, owner.id)

  return (
    <AnimatePresence>
      <motion.aside
        key={selected}
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="glass absolute right-3 top-28 bottom-24 z-20 w-[360px] rounded-xl flex flex-col overflow-hidden"
      >
        <div className="p-4 border-b border-cyan-400/15 relative">
          <button className="absolute right-3 top-3 text-slate-400 hover:text-white text-sm" onClick={() => selectRegion(null)}>
            close
          </button>
          <div className="label">{TERRAIN[mr.terrain].name} · {mr.coastal ? 'Coastal' : 'Landlocked'}</div>
          <h2 className="font-display text-xl font-bold tracking-wider mt-1">{mr.name}</h2>
          <div className="flex items-center gap-2 mt-1 text-sm">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: owner.color }} />
            <span style={{ color: owner.color }}>{owner.name}</span>
            {owner.capital === selected && <span className="text-[10px] font-display tracking-widest text-amber-300">CAPITAL</span>}
            {war && <span className="text-[10px] font-display tracking-widest text-rose-400">AT WAR</span>}
            {pact && <span className="text-[10px] font-display tracking-widest text-emerald-300">PACT</span>}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div className="rounded bg-slate-900/60 py-1.5">
              <div className="label">Pop</div>
              <div className="text-sm font-semibold">{region.population.toFixed(1)}M</div>
            </div>
            <div className="rounded bg-slate-900/60 py-1.5">
              <div className="label">Garrison</div>
              <div className="text-sm font-semibold">{garrisonStrength(game, map, selected).toFixed(1)}</div>
            </div>
            <div className="rounded bg-slate-900/60 py-1.5">
              <div className="label">{mine ? 'Supply' : 'Def x'}</div>
              <div className={`text-sm font-semibold ${mine && (dist === undefined || dist > range) ? 'text-rose-300' : ''}`}>
                {mine ? (dist === undefined ? 'CUT' : `${dist}/${range}`) : TERRAIN[mr.terrain].defense.toFixed(2)}
              </div>
            </div>
          </div>
          {region.rebels > 0 && (
            <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-sm text-rose-200">
              Rebels: {region.rebels.toFixed(1)} divisions. Station an army here or attack the region to crush them.
              {mine && (
                <div className="mt-2">
                  <ActionButton order={{ type: 'suppressRebels', nationId: player.id, regionId: selected }} label="Crackdown" sub={`${COSTS.suppressRebels} PP: halve rebel strength`} tone="btn-red" />
                </div>
              )}
            </div>
          )}
          {region.sabotaged > 0 && <div className="mt-2 text-xs text-amber-300">Factories sabotaged for {region.sabotaged} more month(s).</div>}
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-5">
          <section>
            <div className="label mb-2">Infrastructure</div>
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {BUILDING_TYPES.map((b) => (
                <div key={b} className="rounded bg-slate-900/60 py-1.5" title={BUILDING_SPECS[b].description}>
                  <div className="text-[10px] text-slate-400">{BUILDING_SPECS[b].name}</div>
                  <div className="text-sm font-semibold">
                    {region.buildings[b]}
                    {mine && queuedBuilds(b) > 0 && <span className="text-emerald-300 text-xs"> +{queuedBuilds(b)}</span>}
                  </div>
                </div>
              ))}
            </div>
            {mine && (
              <div className="grid grid-cols-2 gap-1.5 mt-2">
                {BUILDING_TYPES.map((b) => (
                  <ActionButton key={b} order={{ type: 'build', nationId: player.id, regionId: selected, building: b }} label={`Build ${BUILDING_SPECS[b].name}`} sub={`${BUILDING_SPECS[b].cost} Capital`} />
                ))}
              </div>
            )}
          </section>

          {mine && (
            <section>
              <div className="label mb-2">Recruit Divisions</div>
              <div className="grid grid-cols-2 gap-1.5">
                {UNIT_TYPES.map((u) => (
                  <ActionButton
                    key={u}
                    order={{ type: 'recruit', nationId: player.id, regionId: selected, unit: u }}
                    label={`${UNIT_SPECS[u].name}${queuedRecruits(u) ? ` (+${queuedRecruits(u)})` : ''}`}
                    sub={`${UNIT_SPECS[u].capitalCost} Cap · ${UNIT_SPECS[u].manpowerCost}k men`}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="label mb-2">Armies {canSee ? '' : '(not visible)'}</div>
            {!canSee && <p className="text-sm text-slate-500">Send spies to steal maps, or develop Orbital Satellites, to see armies here.</p>}
            {canSee && armies.length === 0 && <p className="text-sm text-slate-500">No armies stationed.</p>}
            <div className="space-y-2">
              {armies.map((a) => (
                <ArmyCard key={a.id} army={a} game={game} />
              ))}
            </div>
          </section>

          {!mine && (
            <section className="space-y-2">
              <div className="label">Statecraft vs {owner.name}</div>
              <div className="text-sm text-slate-400">
                Est. military power: <span className="text-slate-100">{militaryPower(game, owner.id).toFixed(0)}</span> (yours {militaryPower(game, player.id).toFixed(0)})
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {war ? (
                  <ActionButton order={{ type: 'offerPeace', nationId: player.id, target: owner.id }} label="Offer Peace" sub={`${COSTS.offerPeace} PP`} />
                ) : (
                  <ActionButton
                    order={{ type: 'declareWar', nationId: player.id, target: owner.id }}
                    label="Declare War"
                    sub={hasCasusBelli(game, player.id, owner.id) ? `${COSTS.declareWarWithCasusBelli} PP (casus belli)` : `${COSTS.declareWar} PP`}
                    tone="btn-red"
                  />
                )}
                {!war && <ActionButton order={{ type: 'offerPact', nationId: player.id, target: owner.id }} label="Non-Aggression" sub={`${COSTS.offerPact} PP`} />}
                <ActionButton order={{ type: 'spy', nationId: player.id, target: selected, mission: 'sabotage' }} label="Sabotage" sub={`${COSTS.spy} Cap · ${Math.round(spySuccessChance(game, player.id, selected) * 100)}%`} tone="btn-magenta" />
                <ActionButton order={{ type: 'spy', nationId: player.id, target: selected, mission: 'stealVision' }} label="Steal Maps" sub={`${COSTS.spy} Cap · ${Math.round(spySuccessChance(game, player.id, selected) * 100)}%`} tone="btn-magenta" />
              </div>
              <p className="text-xs text-slate-500">Failed spy missions hand the target a casus belli against you.</p>
            </section>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}
