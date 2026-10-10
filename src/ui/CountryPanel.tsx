import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { perceivedPower } from '../ai/diplomat'
import { opinionLabel, opinionOf } from '../ai/opinion'
import { PERSONALITIES } from '../data/personalities'
import { TERRAIN } from '../data/terrain'
import { TRAINING, BUILDING_SPECS, COSTS, UNIT_SPECS, trainingCost, trainingRank } from '../data/unitTypes'
import { weaponTiers } from '../engine/arms'
import { militaryPower } from '../engine/economy'
import { spySuccessChance } from '../engine/espionage'
import { armiesIn, armyIsHome, atWar, boundArmy, hasCasusBelli, hasPact, isAllied } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import { supplyDistances, supplyRange } from '../engine/supply'
import type { Order, UnitType } from '../engine/types'
import { BUILDING_TYPES, UNIT_TYPES } from '../engine/types'
import { netWarScore } from '../engine/warscore'
import { garrisonStrength } from '../engine/warfare'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { ArmyCard, ArmyControls, UnitStrip } from './ArmyOrders'
import { usePlayerView, usePlayerVision } from './hooks'

function ActionButton({ order, label, sub, tone = '', chip = false }: { order: Order; label: string; sub?: string; tone?: string; chip?: boolean }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const { map } = getWorld()
  const err = validateOrder(view.game, map, order, view.orders)
  return (
    <button className={`btn ${tone} ${chip ? '' : 'flex flex-col items-start gap-0.5 text-left'}`} disabled={!!err} title={err ?? sub ?? ''} onClick={() => issueOrder(order)}>
      <span>{label}</span>
      {!chip && sub && <span className="font-ui normal-case tracking-normal text-[11px] text-slate-400">{err ?? sub}</span>}
    </button>
  )
}

export function CountryPanel() {
  const view = usePlayerView()
  const selected = useGame((s) => s.selectedRegion)
  const selectRegion = useGame((s) => s.selectRegion)
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const vis = usePlayerVision()
  const { map } = getWorld()
  const game = view?.game
  const supply = useMemo(() => (game ? supplyDistances(game, map, game.playerId) : null), [game, map])
  const [panelFor, setPanelFor] = useState(selected ?? '')
  const [buildOpen, setBuildOpen] = useState(false)
  const [spies, setSpies] = useState(false)
  if (selected && panelFor !== selected) {
    setPanelFor(selected)
    setBuildOpen(false)
    setSpies(false)
  }
  if (!view || !selected || !game || !supply) return null
  const { player, orders } = view
  const region = game.regions[selected]
  const mr = map.regions[selected]
  const owner = game.nations[region.owner]
  const mine = region.owner === player.id
  const canSee = vis === 'all' || vis.has(selected)
  const armies = canSee ? armiesIn(game, selected) : []
  const dist = mine ? supply.get(selected) : undefined
  const range = supplyRange(game, player.id)
  const queuedBuilds = (b: string) => orders.filter((o) => o.type === 'build' && o.regionId === selected && o.building === b).length
  const territoryIds = map.territoriesByRegion[selected] ?? []
  const homeArmyIds = new Set(
    territoryIds.flatMap((tid) => {
      if (!(mine || canSee)) return []
      const bound = boundArmy(game, tid, region.owner)
      return bound && armyIsHome(game, map, bound) ? [bound.id] : []
    }),
  )
  const otherArmies = armies.filter((a) => !homeArmyIds.has(a.id))
  const war = !mine && atWar(game, player.id, owner.id)
  const pact = !mine && hasPact(game, player.id, owner.id)
  const allied = !mine && isAllied(game, player.id, owner.id)
  const opinion = mine ? 0 : opinionOf(game, map, owner.id, player.id)

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
            {allied && <span className="text-[10px] font-display tracking-widest text-cyan-300">ALLIED</span>}
            {pact && <span className="text-[10px] font-display tracking-widest text-emerald-300">PACT</span>}
          </div>
          {!mine && (
            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
              <span className="rounded border border-fuchsia-400/40 text-fuchsia-200 px-1.5 py-px font-display tracking-wider text-[9px]" title={PERSONALITIES[owner.personality].description}>
                {PERSONALITIES[owner.personality].name.toUpperCase()}
              </span>
              <span>
                {opinionLabel(opinion)} toward you ({opinion > 0 ? '+' : ''}
                {opinion})
              </span>
            </div>
          )}
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
            <div className="grid grid-cols-6 gap-1 text-center">
              {BUILDING_TYPES.map((b) => (
                <div key={b} className="rounded bg-slate-900/60 py-1.5 min-w-0" title={`${BUILDING_SPECS[b].name}: ${BUILDING_SPECS[b].description}`}>
                  <div className="text-[9px] text-slate-400 truncate px-0.5">{b === 'depot' ? 'Depot' : b === 'university' ? 'Univ.' : BUILDING_SPECS[b].name}</div>
                  <div className="text-sm font-semibold">
                    {region.buildings[b]}
                    {mine && queuedBuilds(b) > 0 && <span className="text-emerald-300 text-xs"> +{queuedBuilds(b)}</span>}
                  </div>
                </div>
              ))}
            </div>
            {mine && (
              <div className="mt-2">
                <button type="button" className="btn btn-quiet" onClick={() => setBuildOpen((open) => !open)}>
                  {buildOpen ? 'Hide buildings' : 'Build'}
                </button>
                {buildOpen && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {BUILDING_TYPES.map((b) => (
                      <ActionButton key={b} chip order={{ type: 'build', nationId: player.id, regionId: selected, building: b }} label={`${BUILDING_SPECS[b].name} · ${BUILDING_SPECS[b].cost}`} sub={BUILDING_SPECS[b].description} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="label">Musters</div>
            <p className="text-[11px] text-slate-500">One army each. Recruit and train only while it is standing here.</p>
            {territoryIds.map((tid) => (
              <MusterCard key={tid} territoryId={tid} />
            ))}
          </section>

          {(otherArmies.length > 0 || !canSee) && (
            <section>
              <div className="label mb-2">{mine ? 'Also here' : 'Armies'}</div>
              {!canSee && <p className="text-sm text-slate-500">Send spies to steal maps, or develop Orbital Satellites, to see armies here.</p>}
              <div className="space-y-2">
                {otherArmies.map((a) => (
                  <ArmyCard key={a.id} army={a} game={game} />
                ))}
              </div>
            </section>
          )}

          {!mine && (
            <section className="space-y-2">
              <div className="label">Statecraft vs {owner.name}</div>
              <div className="text-sm text-slate-400">
                Est. military power: <span className="text-slate-100">~{perceivedPower(game, map, player.id, owner.id, vis).toFixed(0)}</span> (yours {militaryPower(game, player.id).toFixed(0)})
                {war && <span> · war score {netWarScore(game, player.id, owner.id)}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button className="btn btn-primary" onClick={() => openDiplomacy(owner.id)}>
                  {war ? 'Negotiate peace' : 'Negotiate'}
                </button>
                {!war && !allied && (
                  <ActionButton
                    order={{ type: 'declareWar', nationId: player.id, target: owner.id }}
                    label="Declare war"
                    sub={hasCasusBelli(game, player.id, owner.id) ? `${COSTS.declareWarWithCasusBelli} PP, casus belli` : `${COSTS.declareWar} PP`}
                    tone="btn-red"
                  />
                )}
                <button type="button" className="btn btn-quiet" onClick={() => setSpies((open) => !open)}>
                  {spies ? 'Hide spies' : 'Espionage'}
                </button>
              </div>
              {spies && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <ActionButton order={{ type: 'spy', nationId: player.id, target: selected, mission: 'sabotage' }} label="Sabotage" sub={`${COSTS.spy} Cap · ${Math.round(spySuccessChance(game, player.id, selected) * 100)}%`} tone="btn-magenta" />
                    <ActionButton order={{ type: 'spy', nationId: player.id, target: selected, mission: 'stealVision' }} label="Steal maps" sub={`${COSTS.spy} Cap · ${Math.round(spySuccessChance(game, player.id, selected) * 100)}%`} tone="btn-magenta" />
                  </div>
                  <p className="text-xs text-slate-500">A failed mission gives them a casus belli.</p>
                </div>
              )}
            </section>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}

function MusterCard({ territoryId }: { territoryId: string }) {
  const view = usePlayerView()!
  const selected = useGame((s) => s.selectedRegion)!
  const selectedArmy = useGame((s) => s.selectedArmy)
  const selectArmy = useGame((s) => s.selectArmy)
  const { map } = getWorld()
  const vis = usePlayerVision()
  const [moreUnits, setMoreUnits] = useState(false)
  const { game, player } = view
  const region = game.regions[selected]
  const mine = region.owner === player.id
  const canSee = vis === 'all' || vis.has(selected)
  const showForces = mine || canSee
  const territory = map.territories[territoryId]
  const bound = showForces ? boundArmy(game, territoryId, region.owner) : undefined
  const home = !!bound && armyIsHome(game, map, bound)
  const away = !!bound && !home
  const canRaise = mine && (!bound || home)
  const selectedHere = !!bound && selectedArmy === bound.id && mine && home
  const rank = bound?.training ?? 0
  const queued = (unit: UnitType) => view.orders.filter((o) => o.type === 'recruit' && o.territoryId === territoryId && o.unit === unit).length
  const infantryQueued = queued('infantry')
  const extras = UNIT_TYPES.filter((unit) => unit !== 'infantry')
  const rebaseArmy = selectedArmy ? game.armies[selectedArmy] : undefined
  const canRebase = mine && !bound && !!rebaseArmy && rebaseArmy.owner === player.id && rebaseArmy.location === selected && rebaseArmy.homeTerritoryId !== territoryId
  const tiers = bound ? weaponTiers(game.nations[bound.owner], game.turn) : undefined

  return (
    <div className={`rounded-lg border p-2.5 space-y-2 ${selectedHere ? 'border-cyan-300/70 bg-cyan-400/10' : 'border-slate-700/70 bg-slate-900/40'}`}>
      <div className="flex items-center justify-between gap-2">
        {mine && bound ? (
          <button type="button" className="font-display text-[11px] tracking-wider text-left hover:text-cyan-100" onClick={() => selectArmy(bound.id)}>
            {territory.name.toUpperCase()}
          </button>
        ) : (
          <span className="font-display text-[11px] tracking-wider">{territory.name.toUpperCase()}</span>
        )}
        <span className={`text-[10px] font-display tracking-widest ${!showForces ? 'text-slate-500' : home ? 'text-cyan-300' : away ? 'text-amber-300' : 'text-slate-500'}`}>
          {!showForces ? 'HIDDEN' : home ? trainingRank(rank) : away ? 'AWAY' : 'EMPTY'}
        </span>
      </div>
      {bound && home && <UnitStrip units={bound.units} tiers={tiers} />}
      {bound && home && (
        <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full rounded-full bg-cyan-400" style={{ width: `${(Math.min(TRAINING.max, rank) / TRAINING.max) * 100}%` }} />
        </div>
      )}
      {away && bound && <p className="text-[11px] text-amber-200/90">In {map.regions[bound.location]?.name ?? 'the field'}. March it home to recruit or train.</p>}
      {!showForces && <p className="text-[11px] text-slate-500">Forces here are not visible.</p>}
      {!bound && canRaise && (
        <ActionButton
          order={{ type: 'recruit', nationId: player.id, territoryId, unit: 'infantry' }}
          label={`Raise infantry${infantryQueued ? ` +${infantryQueued}` : ''}`}
          sub={`${UNIT_SPECS.infantry.capitalCost} Capital · ${UNIT_SPECS.infantry.manpowerCost}k men`}
          tone="btn-primary"
        />
      )}
      {mine && bound && home && rank < TRAINING.max && (
        <ActionButton order={{ type: 'train', nationId: player.id, armyId: bound.id }} label={`Train to ${trainingRank(rank + 1)} · ${trainingCost(rank)}`} sub="Capital. The cost rises with each rank." tone="btn-primary" />
      )}
      {mine && bound && home && <ArmyControls army={bound} game={game} />}
      {canRaise && (
        <div className="space-y-1.5">
          <button type="button" className="btn btn-quiet" onClick={() => setMoreUnits((open) => !open)}>
            {moreUnits ? 'Hide units' : bound ? 'Recruit' : 'Other units'}
          </button>
          {moreUnits && (
            <div className="grid grid-cols-2 gap-1.5">
              {(bound ? UNIT_TYPES : extras).map((unit) => (
                <ActionButton
                  key={unit}
                  chip
                  order={{ type: 'recruit', nationId: player.id, territoryId, unit }}
                  label={`${UNIT_SPECS[unit].name}${queued(unit) ? ` +${queued(unit)}` : ''} · ${UNIT_SPECS[unit].capitalCost}`}
                  sub={`${UNIT_SPECS[unit].manpowerCost}k men`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {canRebase && rebaseArmy && (
        <ActionButton order={{ type: 'rebase', nationId: player.id, armyId: rebaseArmy.id, territoryId }} label={`Re-base ${rebaseArmy.id.toUpperCase()} here`} sub="Bind the selected army to this empty muster" tone="btn-quiet" />
      )}
    </div>
  )
}
