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
import { speak } from './plain'

function ActionButton({ order, label, sub, tone = '', chip = false }: { order: Order; label: string; sub?: string; tone?: string; chip?: boolean }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const { map } = getWorld()
  const err = validateOrder(view.game, map, order, view.orders)
  const why = err ? speak(err) : null
  return (
    <button className={`btn ${tone} ${chip ? '' : 'flex flex-col items-start gap-0.5 text-left'}`} disabled={!!err} title={why ?? sub ?? ''} onClick={() => issueOrder(order)}>
      <span>{label}</span>
      {!chip && (why || sub) && <span className="font-ui normal-case tracking-normal text-[11px] text-white/50">{why ?? sub}</span>}
    </button>
  )
}

type CountryTab = 'home' | 'build' | 'relations'

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
  const [tab, setTab] = useState<CountryTab>('home')
  const [spies, setSpies] = useState(false)
  if (selected && panelFor !== selected) {
    setPanelFor(selected)
    setTab('home')
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
  const built = BUILDING_TYPES.filter((b) => region.buildings[b] > 0)
  const supplyCut = mine && (dist === undefined || dist > range)
  const purpose = mine
    ? 'Your country. Each district holds one army. Raise it here, then move or attack.'
    : war
      ? `At war with ${owner.name}. Attack from an army in a neighboring country.`
      : allied
        ? `${owner.name} is an ally. You can ask them to join a war.`
        : pact
          ? `You have agreed not to attack ${owner.name}.`
          : `Belongs to ${owner.name}. Talk, or declare war before you can attack.`

  return (
    <AnimatePresence>
      <motion.aside
        key={selected}
        initial={{ x: 28, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 28, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="glass absolute right-4 top-24 bottom-36 z-20 w-[400px] rounded-[22px] flex flex-col overflow-hidden"
      >
        <div className="px-4 pt-4 pb-3 border-b border-white/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label">
                {TERRAIN[mr.terrain].name} · {mr.coastal ? 'Coast' : 'Inland'}
              </p>
              <h2 className="text-[22px] font-semibold tracking-tight mt-0.5 truncate">{mr.name}</h2>
            </div>
            <button className="icon-close shrink-0" aria-label="Close" onClick={() => selectRegion(null)}>
              ×
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="chip">
              <span className="w-2 h-2 rounded-full" style={{ background: owner.color }} />
              {mine ? 'Yours' : owner.name}
            </span>
            {owner.capital === selected && <span className="chip">Capital city</span>}
            {war && <span className="chip chip-red">At war</span>}
            {allied && <span className="chip chip-blue">Ally</span>}
            {pact && <span className="chip chip-green">Peace pact</span>}
          </div>
          {!mine && (
            <p className="mt-2 text-[12px] text-white/50" title={PERSONALITIES[owner.personality].description}>
              {PERSONALITIES[owner.personality].name} · {opinionLabel(opinion)} toward you ({opinion > 0 ? '+' : ''}
              {opinion})
            </p>
          )}
          <p className="mt-2 text-[13px] leading-snug text-white/65">{purpose}</p>
          <div className="segmented mt-3">
            <button type="button" aria-pressed={tab === 'home'} onClick={() => setTab('home')}>
              Overview
            </button>
            {mine && (
              <button type="button" aria-pressed={tab === 'build'} onClick={() => setTab('build')}>
                Build
              </button>
            )}
            {!mine && (
              <button type="button" aria-pressed={tab === 'relations'} onClick={() => setTab('relations')}>
                Relations
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-4">
          {tab === 'home' && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="People" value={`${region.population.toFixed(1)}m`} />
                <Stat label="Defenders" value={garrisonStrength(game, map, selected).toFixed(1)} />
                <Stat
                  label={mine ? 'Supply' : 'Defense'}
                  value={mine ? (supplyCut ? 'Cut off' : 'Supplied') : `${TERRAIN[mr.terrain].defense.toFixed(2)}×`}
                  warn={supplyCut}
                />
              </div>
              {mine && supplyCut && <p className="text-[12px] text-[#ff8a84]">This country is outside your supply network. Armies here will starve.</p>}
              {region.rebels > 0 && (
                <div className="rounded-2xl bg-[#ff453a]/12 p-3 text-[13px] text-[#ffb4af]">
                  Rebels hold {region.rebels.toFixed(1)} divisions. Station an army here, attack them, or crack down.
                  {mine && (
                    <div className="mt-2">
                      <ActionButton order={{ type: 'suppressRebels', nationId: player.id, regionId: selected }} label="Crack down" sub={`${COSTS.suppressRebels} influence. Cuts rebel strength in half.`} tone="btn-red" />
                    </div>
                  )}
                </div>
              )}
              {region.sabotaged > 0 && <p className="text-[12px] text-[#ffd60a]">Factories are sabotaged for {region.sabotaged} more month{region.sabotaged === 1 ? '' : 's'}.</p>}

              {!mine && (
                <div className="flex flex-wrap gap-1.5">
                  <button className="btn btn-primary" onClick={() => openDiplomacy(owner.id)}>
                    {war ? 'Make peace' : 'Talk'}
                  </button>
                  {!war && !allied && (
                    <ActionButton
                      order={{ type: 'declareWar', nationId: player.id, target: owner.id }}
                      label="Declare war"
                      sub={hasCasusBelli(game, player.id, owner.id) ? `${COSTS.declareWarWithCasusBelli} influence. You have a grievance, so this is cheaper.` : `${COSTS.declareWar} influence.`}
                      tone="btn-red"
                    />
                  )}
                  <button type="button" className="btn btn-quiet" onClick={() => setTab('relations')}>
                    Spy
                  </button>
                </div>
              )}

              {mine && (
                <button type="button" className="w-full text-left inset-card px-3 py-2.5" onClick={() => setTab('build')}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-semibold">Buildings</span>
                    <span className="text-[12px] text-[#64a8ff]">Build</span>
                  </div>
                  <p className="text-[12px] text-white/50 mt-0.5">{built.length ? built.map((b) => `${BUILDING_SPECS[b].name} ${region.buildings[b]}`).join(' · ') : 'Nothing built yet. Factories earn money. Farms grow food. Barracks raise armies.'}</p>
                </button>
              )}

              <section className="space-y-2">
                <div>
                  <div className="text-[13px] font-semibold">Districts</div>
                  <p className="text-[12px] text-white/50 mt-0.5">One army each. You can recruit and train only while that army is standing here.</p>
                </div>
                {territoryIds.map((tid) => (
                  <MusterCard key={tid} territoryId={tid} />
                ))}
              </section>

              {(otherArmies.length > 0 || !canSee) && (
                <section className="space-y-2">
                  <div className="text-[13px] font-semibold">{mine ? 'Also passing through' : 'Other armies'}</div>
                  {!canSee && <p className="text-[13px] text-white/50">You cannot see armies here. Steal their maps, or research satellites.</p>}
                  {otherArmies.map((a) => (
                    <ArmyCard key={a.id} army={a} game={game} />
                  ))}
                </section>
              )}
            </>
          )}

          {tab === 'build' && mine && (
            <section className="space-y-2">
              <p className="text-[13px] text-white/55">Buildings finish when the month ends. Each one does one job.</p>
              {BUILDING_TYPES.map((b) => (
                <div key={b} className="inset-card p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{BUILDING_SPECS[b].name}</span>
                      <span className="text-[13px] tabular-nums text-white/70">
                        {region.buildings[b]}
                        {queuedBuilds(b) > 0 && <span className="text-[#30d158]"> +{queuedBuilds(b)}</span>}
                      </span>
                    </div>
                    <p className="text-[12px] text-white/50 mt-0.5 leading-snug">{BUILDING_SPECS[b].description}</p>
                    <p className="text-[12px] text-white/40 mt-1">{BUILDING_SPECS[b].cost} money</p>
                  </div>
                  <ActionButton chip order={{ type: 'build', nationId: player.id, regionId: selected, building: b }} label="Build" sub={BUILDING_SPECS[b].description} tone="btn-primary" />
                </div>
              ))}
            </section>
          )}

          {tab === 'relations' && !mine && (
            <section className="space-y-3">
              <div className="inset-card p-3 text-[13px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-white/50">Their strength</span>
                  <span>~{perceivedPower(game, map, player.id, owner.id, vis).toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Your strength</span>
                  <span>{militaryPower(game, player.id).toFixed(0)}</span>
                </div>
                {war && (
                  <div className="flex justify-between">
                    <span className="text-white/50">War score</span>
                    <span>{netWarScore(game, player.id, owner.id)}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button className="btn btn-primary" onClick={() => openDiplomacy(owner.id)}>
                  {war ? 'Make peace' : 'Talk'}
                </button>
                {!war && !allied && (
                  <ActionButton
                    order={{ type: 'declareWar', nationId: player.id, target: owner.id }}
                    label="Declare war"
                    sub={hasCasusBelli(game, player.id, owner.id) ? `${COSTS.declareWarWithCasusBelli} influence, because you have a grievance.` : `${COSTS.declareWar} influence.`}
                    tone="btn-red"
                  />
                )}
              </div>
              <div className="space-y-2">
                <button type="button" className="btn btn-quiet" onClick={() => setSpies((open) => !open)}>
                  {spies ? 'Hide espionage' : 'Espionage'}
                </button>
                {spies && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <ActionButton order={{ type: 'spy', nationId: player.id, target: selected, mission: 'sabotage' }} label="Sabotage" sub={`${COSTS.spy} money · ${Math.round(spySuccessChance(game, player.id, selected) * 100)}% chance. Stops their factories for a few months.`} tone="btn-magenta" />
                      <ActionButton order={{ type: 'spy', nationId: player.id, target: selected, mission: 'stealVision' }} label="Steal maps" sub={`${COSTS.spy} money · ${Math.round(spySuccessChance(game, player.id, selected) * 100)}% chance. Reveals their armies.`} tone="btn-magenta" />
                    </div>
                    <p className="text-[12px] text-white/45">If you are caught, they gain a grievance and can declare war more cheaply.</p>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="inset-card py-2 px-1">
      <div className="label">{label}</div>
      <div className={`text-[14px] font-semibold tabular-nums ${warn ? 'text-[#ff6961]' : ''}`}>{value}</div>
    </div>
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
  const status = !showForces ? 'Hidden' : home ? trainingRank(rank) : away ? 'Away' : 'Empty'

  return (
    <div className={`inset-card p-3 space-y-2 ${selectedHere ? 'ring-1 ring-white/35' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        {mine && bound ? (
          <button type="button" className="text-[14px] font-semibold text-left tracking-tight" onClick={() => selectArmy(bound.id)}>
            {territory.name}
          </button>
        ) : (
          <span className="text-[14px] font-semibold tracking-tight">{territory.name}</span>
        )}
        <span className={`text-[12px] font-medium ${!showForces ? 'text-white/40' : home ? 'text-[#8ec5ff]' : away ? 'text-[#ffd60a]' : 'text-white/40'}`}>{status}</span>
      </div>
      {bound && home && <UnitStrip units={bound.units} tiers={tiers} />}
      {bound && home && (
        <div>
          <div className="flex justify-between text-[11px] text-white/45 mb-1">
            <span>Training</span>
            <span>
              {rank}/{TRAINING.max}
            </span>
          </div>
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-[#0a84ff]" style={{ width: `${(Math.min(TRAINING.max, rank) / TRAINING.max) * 100}%` }} />
          </div>
        </div>
      )}
      {away && bound && <p className="text-[12px] text-[#ffd60a]">In {map.regions[bound.location]?.name ?? 'the field'}. March it home to recruit or train.</p>}
      {!showForces && <p className="text-[12px] text-white/45">You cannot see the army that belongs here.</p>}
      {!bound && canRaise && (
        <ActionButton
          order={{ type: 'recruit', nationId: player.id, territoryId, unit: 'infantry' }}
          label={infantryQueued ? `Raising infantry +${infantryQueued}` : 'Raise an army'}
          sub={`${UNIT_SPECS.infantry.capitalCost} money · ${UNIT_SPECS.infantry.manpowerCost},000 soldiers. Needs a barracks.`}
          tone="btn-primary"
        />
      )}
      {mine && bound && home && rank < TRAINING.max && (
        <ActionButton order={{ type: 'train', nationId: player.id, armyId: bound.id }} label={`Train to ${trainingRank(rank + 1)}`} sub={`${trainingCost(rank)} money. Better training wins more fights.`} tone="btn-primary" />
      )}
      {mine && bound && home && <ArmyControls army={bound} game={game} />}
      {canRaise && (
        <div className="space-y-1.5">
          <button type="button" className="btn btn-quiet" onClick={() => setMoreUnits((open) => !open)}>
            {moreUnits ? 'Hide other forces' : 'Add armor, planes, or ships'}
          </button>
          {moreUnits && (
            <div className="grid grid-cols-1 gap-1.5">
              {(bound ? UNIT_TYPES : extras).map((unit) => (
                <ActionButton
                  key={unit}
                  order={{ type: 'recruit', nationId: player.id, territoryId, unit }}
                  label={`${UNIT_SPECS[unit].name}${queued(unit) ? ` +${queued(unit)}` : ''}`}
                  sub={`${UNIT_SPECS[unit].capitalCost} money · ${UNIT_SPECS[unit].manpowerCost},000 soldiers. ${roleOf(unit)}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {canRebase && rebaseArmy && (
        <ActionButton order={{ type: 'rebase', nationId: player.id, armyId: rebaseArmy.id, territoryId }} label="Station the selected army here" sub="This empty district becomes its home." tone="btn-quiet" />
      )}
    </div>
  )
}

function roleOf(unit: UnitType): string {
  if (unit === 'infantry') return 'Reliable soldiers. Needs a barracks.'
  if (unit === 'armor') return 'Hits harder than infantry. Needs a barracks.'
  if (unit === 'air') return 'Strong and fragile. Needs a factory.'
  return 'Fights at sea and supports landings. Needs a port.'
}
