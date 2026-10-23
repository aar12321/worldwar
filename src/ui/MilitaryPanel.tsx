import { motion } from 'framer-motion'
import { TRAIN_QUEUE_LIMIT, UNIT_SPECS, trainingCost, trainingRank } from '../data/unitTypes'
import { TRAIN_SECONDS, formatSeconds } from '../engine/pace'
import { armyIsHome, boundArmy, formatDivisions, regionsOf } from '../engine/helpers'
import type { Army, TrainingJob, UnitType } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { OrderButton, PanelShell } from './panel'

export function MilitaryPanel() {
  const view = usePlayerView()
  const selectedTerritory = useGame((s) => s.selectedTerritory)
  const focusTerritory = useGame((s) => s.focusTerritory)
  const selectRegion = useGame((s) => s.selectRegion)
  if (!view) return null
  const { game, player, orders } = view
  const { map } = getWorld()
  const owned = regionsOf(game, player.id)
  const regionId = selectedTerritory && map.territories[selectedTerritory] && game.regions[map.territories[selectedTerritory].regionId]?.owner === player.id
    ? map.territories[selectedTerritory].regionId
    : owned[0]
  if (!regionId) return <PanelShell title="Military" kicker="No land remains" panel="military"><p className="text-[13px] text-white/55">You have no country to train in.</p></PanelShell>
  const territoryIds = map.territoriesByRegion[regionId] ?? []
  const current = selectedTerritory && territoryIds.includes(selectedTerritory) ? selectedTerritory : territoryIds[0]
  const territory = current ? map.territories[current] : null
  const army = current ? boundArmy(game, current, player.id) : undefined
  const jobs = (game.trainingQueue ?? []).filter((job) => job.nationId === player.id && job.territoryId === current)
  const pendingHere = orders.filter((order) => order.type === 'queueTrain' && order.territoryId === current)

  return (
    <PanelShell title="Military" kicker="Train units, then they fight with the army on that territory" panel="military">
      <label className="block">
        <span className="label">Country</span>
        <select
          className="field mt-1 w-full px-3 py-2 text-[14px]"
          value={regionId}
          onChange={(event) => {
            selectRegion(event.target.value)
            const first = map.territoriesByRegion[event.target.value]?.[0]
            if (first) focusTerritory(first)
          }}
        >
          {owned.map((id) => (
            <option key={id} value={id}>
              {map.regions[id].name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-1.5 overflow-x-auto scroll-thin pb-1">
        {territoryIds.map((id) => {
          const waiting = (game.trainingQueue ?? []).filter((job) => job.territoryId === id).length
          return (
            <button
              key={id}
              type="button"
              aria-pressed={id === current}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${id === current ? 'bg-white text-black' : 'bg-white/10 text-white/80 hover:bg-white/16'}`}
              onClick={() => focusTerritory(id)}
            >
              {map.territories[id].name}
              {waiting > 0 ? ` · ${waiting}` : ''}
            </button>
          )
        })}
      </div>

      {territory && current && (
        <>
          <Garrison territoryId={current} army={army} />
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[14px] font-semibold">Train</h3>
              <span className="text-[12px] text-white/40">
                Queue {jobs.length + pendingHere.length}/{TRAIN_QUEUE_LIMIT}
              </span>
            </div>
            <p className="text-[12px] leading-snug text-white/50">One unit trains at a time. The rest wait. Finished units join this territory&apos;s army and fight with it, even if the army is away.</p>
            <div className="grid grid-cols-1 gap-2">
              {UNIT_TYPES.map((unit) => (
                <UnitCard key={unit} unit={unit} territoryId={current} />
              ))}
            </div>
          </section>
          <Queue territoryId={current} jobs={jobs} />
      {army ? <Drill army={army} /> : <Raise territoryId={current} />}
        </>
      )}
    </PanelShell>
  )
}

function Garrison({ territoryId, army }: { territoryId: string; army: Army | undefined }) {
  const view = usePlayerView()!
  const { map } = getWorld()
  const territory = map.territories[territoryId]
  const home = !!army && armyIsHome(view.game, map, army)
  return (
    <div className="inset-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold">{territory.name}</span>
        <span className={`text-[12px] font-medium ${home ? 'text-[#8ec5ff]' : army ? 'text-[#ffd60a]' : 'text-white/40'}`}>
          {home ? 'Army is here' : army ? `Army is in ${map.regions[army.location]?.name ?? 'the field'}` : 'No army'}
        </span>
      </div>
      {army ? (
        <ul className="mt-2 space-y-1">
          {UNIT_TYPES.filter((unit) => army.units[unit] >= 0.05).map((unit) => (
            <li key={unit} className="flex justify-between text-[13px]">
              <span>{UNIT_SPECS[unit].name}</span>
              <span className="text-white/55 tabular-nums">
                {formatDivisions(army.units[unit])} · {trainingRank(army.training[unit] ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[12px] text-white/45">Raise an army, or train a unit. The first one to finish founds the garrison.</p>
      )}
    </div>
  )
}

function UnitCard({ unit, territoryId }: { unit: UnitType; territoryId: string }) {
  const view = usePlayerView()!
  const spec = UNIT_SPECS[unit]
  const seconds = TRAIN_SECONDS[unit]
  const pending = view.orders.filter((order) => order.type === 'queueTrain' && order.territoryId === territoryId && order.unit === unit).length
  return (
    <motion.div layout className="inset-card p-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{spec.name}</span>
          <span className="text-[12px] text-white/45">{formatSeconds(seconds)}</span>
        </div>
        <p className="text-[12px] text-white/50 mt-0.5" title={`${spec.attack} attack, ${spec.defense} defense`}>
          Attack {spec.attack} · Defense {spec.defense}
        </p>
        <p className="text-[12px] text-white/40 mt-0.5">
          {spec.capitalCost} money · {spec.manpowerCost}k soldiers · eats {spec.food} food a month · needs a {spec.requiresBuilding === 'barracks' ? 'barracks' : spec.requiresBuilding === 'factory' ? 'factory' : 'port'}
        </p>
      </div>
      <OrderButton
        className="shrink-0"
        tone="btn-primary"
        showError
        order={{ type: 'queueTrain', nationId: view.player.id, territoryId, unit }}
        label={pending ? `Queued +${pending}` : 'Train'}
      />
    </motion.div>
  )
}

function Queue({ territoryId, jobs }: { territoryId: string; jobs: TrainingJob[] }) {
  const view = usePlayerView()!
  const removeOrder = useGame((s) => s.removeOrder)
  const { orders } = view
  const pending = orders
    .map((order, index) => ({ order, index }))
    .filter((item) => item.order.type === 'queueTrain' && item.order.territoryId === territoryId)
  if (jobs.length === 0 && pending.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-[14px] font-semibold">Queue</h3>
      {pending.map(({ order, index }) =>
        order.type === 'queueTrain' ? (
          <div key={`pending-${index}`} className="inset-card px-3 py-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold">{UNIT_SPECS[order.unit].name}</div>
              <div className="text-[12px] text-white/45">Waiting to start</div>
            </div>
            <button type="button" className="btn btn-quiet" onClick={() => removeOrder(index)}>
              Cancel
            </button>
          </div>
        ) : null,
      )}
      {jobs.map((job, index) => {
        const active = index === 0
        const fraction = job.total > 0 ? Math.min(1, Math.max(0, (job.total - job.remaining) / job.total)) : 0
        const live = job.clock === 'time'
        const label = !active ? 'Waiting' : live ? `${formatSeconds(job.remaining)} left` : job.remaining <= 1 ? 'Arrives when the month ends' : `${job.remaining} months left`
        return (
          <div key={job.id} className="inset-card px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold">
                  {UNIT_SPECS[job.unit].name}
                  {!active && <span className="text-white/40 font-medium"> · waiting</span>}
                </div>
                <div className="text-[12px] text-white/45 tabular-nums">{label}</div>
              </div>
              <OrderButton order={{ type: 'cancelTrain', nationId: view.player.id, jobId: job.id }} label="Cancel" tone="btn-quiet" />
            </div>
            <div className="h-1.5 rounded-full bg-white/12 overflow-hidden" aria-hidden>
              <div className={`h-full rounded-full ${active ? 'bg-[#0a84ff]' : 'bg-white/25'}`} style={{ width: `${active ? Math.max(6, fraction * 100) : 0}%` }} />
            </div>
          </div>
        )
      })}
    </section>
  )
}

function Drill({ army }: { army: Army }) {
  const view = usePlayerView()!
  const { game, player, orders } = view
  const { map } = getWorld()
  const home = armyIsHome(game, map, army)
  const present = UNIT_TYPES.filter((unit) => army.units[unit] >= 0.05)
  if (!home) return <p className="text-[12px] text-[#ffd60a]">The army is away. New units still reinforce it. March it home to drill.</p>
  if (present.length === 0) return null
  return (
    <section className="space-y-1.5">
      <h3 className="text-[14px] font-semibold">Drill</h3>
      <p className="text-[12px] text-white/50">Improves units already in this army. A general does the same thing for free, from Nation.</p>
      {present.map((unit) => {
        const level = army.training[unit] ?? 0
        const queued = orders.some((order) => order.type === 'train' && order.armyId === army.id && order.unit === unit)
        return (
          <div key={unit} className="flex items-center justify-between gap-2 text-[13px]">
            <span>
              {UNIT_SPECS[unit].name} <span className="text-white/45">{trainingRank(level)}</span>
            </span>
            <OrderButton order={{ type: 'train', nationId: player.id, armyId: army.id, unit }} label={queued ? 'Drilling' : `Drill · ${trainingCost(level)}`} />
          </div>
        )
      })}
    </section>
  )
}

function Raise({ territoryId }: { territoryId: string }) {
  const view = usePlayerView()!
  const { game, player } = view
  const { map } = getWorld()
  const regionId = map.territories[territoryId]?.regionId
  const visitors = Object.values(game.armies).filter((army) => army.owner === player.id && army.location === regionId && army.homeTerritoryId !== territoryId)
  return (
    <section className="space-y-2">
      <OrderButton
        showError
        tone="btn-primary"
        order={{ type: 'recruit', nationId: player.id, territoryId, unit: 'infantry' }}
        label="Raise an army now"
        sub={`${UNIT_SPECS.infantry.capitalCost} money · infantry in ${formatSeconds(TRAIN_SECONDS.infantry)}. Needs a barracks.`}
      />
      {visitors.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-white/50">Or station an army that is already in this country.</p>
          {visitors.map((army) => (
            <OrderButton key={army.id} showError order={{ type: 'rebase', nationId: player.id, armyId: army.id, territoryId }} label={`Station ${map.territories[army.homeTerritoryId]?.name ?? 'army'} here`} />
          ))}
        </div>
      )}
    </section>
  )
}
