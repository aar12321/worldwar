import { TRAINING, UNIT_SPECS, trainingCost, trainingRank } from '../data/unitTypes'
import { combatMods, weaponTiers } from '../engine/arms'
import { unitPower } from '../engine/economy'
import { armyIsHome, formatDivisions, totalUnits } from '../engine/helpers'
import type { Army, GameState, UnitType } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { generalChoice } from './labels'
import { OrderButton } from './panel'

export function UnitStrip({ units, tiers }: { units: Army['units']; tiers?: Partial<Record<UnitType, number>> }) {
  const present = UNIT_TYPES.filter((k) => units[k] >= 0.05)
  if (!present.length) return <p className="text-[11px] text-slate-500">No divisions yet.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {present.map((k) => (
        <span key={k} className="rounded-full bg-white/8 px-2 py-0.5 text-[12px] font-medium text-white/90" title={UNIT_SPECS[k].name}>
          {UNIT_SPECS[k].name} {formatDivisions(units[k])}
          {tiers?.[k] ? <span className="text-[#ffd60a]"> · weapons {tiers[k]}</span> : null}
        </span>
      ))}
    </div>
  )
}

export function ArmyCard({ army, game }: { army: Army; game: GameState }) {
  const { map } = getWorld()
  const selectedArmy = useGame((s) => s.selectedArmy)
  const selectArmy = useGame((s) => s.selectArmy)
  const mine = army.owner === game.playerId
  const owner = game.nations[army.owner]
  const selected = selectedArmy === army.id
  const home = map.territories[army.homeTerritoryId]
  const atHome = armyIsHome(game, map, army)
  const tiers = weaponTiers(owner, game.turn)
  const power = unitPower(army.units, combatMods(owner, game.turn), army.training)
  const present = UNIT_TYPES.filter((k) => army.units[k] >= 0.05)

  return (
    <div className={`inset-card p-3 transition-colors ${selected ? 'ring-1 ring-white/35' : ''} ${mine ? 'cursor-pointer' : ''}`} onClick={() => mine && selectArmy(army.id)}>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: owner.color }} />
          <span className="text-[14px] font-semibold tracking-tight truncate">{mine ? home?.name ?? 'Your army' : owner.name}</span>
        </div>
        <span className="text-[12px] text-white/45 shrink-0">{formatDivisions(totalUnits(army.units))} div · strength {power.toFixed(1)}</span>
      </div>
      <UnitStrip units={army.units} tiers={tiers} />
      {present.length > 0 && (
        <div className="mt-2 space-y-1">
          {present.map((k) => (
            <div key={k} className="flex justify-between text-[12px]">
              <span className="text-white/70">{UNIT_SPECS[k].name}</span>
              <span className="text-white/45">{trainingRank(army.training[k] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[12px] text-white/45">{atHome ? 'In the city. These units fight as one army.' : `Away in ${map.regions[army.location]?.name ?? 'the field'}.`}</p>
      {mine && army.outOfSupplyTurns > 0 && (
        <div className="mt-1.5 text-[12px] text-[#ff8a84]">Cut off from supplies for {army.outOfSupplyTurns} month{army.outOfSupplyTurns === 1 ? '' : 's'}. Surrenders after 3.</div>
      )}
      {mine && <ArmyControls army={army} />}
    </div>
  )
}

export function ArmyControls({ army }: { army: Army }) {
  const { map } = getWorld()
  const selectedArmy = useGame((s) => s.selectedArmy)
  const targetMode = useGame((s) => s.targetMode)
  const orders = useGame((s) => s.orders)
  const selectArmy = useGame((s) => s.selectArmy)
  const setTargetMode = useGame((s) => s.setTargetMode)
  const removeOrder = useGame((s) => s.removeOrder)
  const selected = selectedArmy === army.id
  const pendingIdx = orders.findIndex((o) => (o.type === 'move' || o.type === 'attack') && o.armyId === army.id)
  const pending = pendingIdx >= 0 ? orders[pendingIdx] : null

  return (
    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-2">
        <button
          className={`btn flex-1 ${selected && targetMode === 'move' ? 'bg-white/20' : ''}`}
          title="March into a neighboring country you are allowed to enter."
          onClick={() => {
            selectArmy(army.id)
            setTargetMode(selected && targetMode === 'move' ? null : 'move')
          }}
        >
          Move
        </button>
        <button
          className={`btn btn-magenta flex-1 ${selected && targetMode === 'attack' ? 'bg-[#bf5af2]/40' : ''}`}
          title="Fight a neighboring country. You must already be at war."
          onClick={() => {
            selectArmy(army.id)
            setTargetMode(selected && targetMode === 'attack' ? null : 'attack')
          }}
        >
          Attack
        </button>
      </div>
      <p className="text-[11px] text-white/40">The whole army moves or attacks together. Press a button, then click a highlighted neighbor.</p>
      {pending && (
        <div className="flex items-center justify-between rounded-xl bg-white/8 px-2.5 py-1.5 text-[12px]">
          <span>
            {pending.type === 'attack' ? 'Attacking ' : 'Moving to '}
            {map.regions[pending.type === 'attack' ? pending.target : pending.type === 'move' ? pending.to : army.location].name}
          </span>
          <button className="text-white/50 hover:text-white" onClick={() => removeOrder(pendingIdx)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

/** One army, with its general and the separate training of each unit. */
export function ArmyManager({ army }: { army: Army }) {
  const view = usePlayerView()
  const selected = useGame((s) => s.selectedArmy === army.id)
  const selectArmy = useGame((s) => s.selectArmy)
  const issueOrder = useGame((s) => s.issueOrder)
  const removeOrder = useGame((s) => s.removeOrder)
  if (!view) return null
  const { game, orders } = view
  const { map } = getWorld()
  const owner = game.nations[army.owner]
  const home = map.territories[army.homeTerritoryId]
  const atHome = armyIsHome(game, map, army)
  const place = home?.name ?? 'This army'
  const where = atHome ? 'In the city' : `Away in ${map.regions[army.location]?.name ?? 'the field'}`
  const generalId = generalChoice(army.id, army.generalId, orders)
  const general = owner.generals.find((g) => g.id === generalId) ?? null
  const present = UNIT_TYPES.filter((k) => army.units[k] >= 0.05)
  const stationed = (id: string) => {
    for (const o of orders) {
      if (o.type === 'assignGeneral' && o.generalId === id && o.armyId !== army.id) return map.territories[game.armies[o.armyId]?.homeTerritoryId]?.name ?? 'another army'
    }
    for (const other of Object.values(game.armies)) {
      if (other.owner !== army.owner || other.id === army.id) continue
      if (generalChoice(other.id, other.generalId, orders) === id) return map.territories[other.homeTerritoryId]?.name ?? 'another army'
    }
    return null
  }

  return (
    <div className={`inset-card p-3 space-y-3 ${selected ? 'ring-1 ring-white/35' : ''}`}>
      <button type="button" className="w-full text-left" onClick={() => selectArmy(selected ? null : army.id)}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[16px] font-semibold tracking-tight">{place}</span>
          <span className={`text-[12px] font-medium shrink-0 ${atHome ? 'text-[#8ec5ff]' : 'text-[#ffd60a]'}`}>{where}</span>
        </div>
        <p className="text-[12px] text-white/45 mt-0.5">{formatDivisions(totalUnits(army.units))} divisions · strength {unitPower(army.units, combatMods(owner, game.turn), army.training).toFixed(1)}</p>
      </button>

      <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="label">General</div>
        <select
          className="field w-full px-2 py-1.5 text-[13px]"
          aria-label={`General for ${place}`}
          value={generalId ?? ''}
          onChange={(e) => issueOrder({ type: 'assignGeneral', nationId: game.playerId, armyId: army.id, generalId: e.target.value || null })}
        >
          <option value="">No general</option>
          {owner.generals.map((g) => {
            const holderName = stationed(g.id)
            return (
              <option key={g.id} value={g.id}>
                {holderName ? `${g.name} · move from ${holderName}` : g.name}
              </option>
            )
          })}
        </select>
        <p className="text-[12px] text-white/55">
          {general
            ? atHome
              ? `${general.name} trains every unit in this city for free each month.`
              : `${general.name} will train for free once this army is back in ${place}.`
            : 'With no general, you pay each month for each unit you train.'}
        </p>
      </div>

      <div className="space-y-2">
        <div>
          <div className="label">Units in this army</div>
          <p className="text-[12px] text-white/45 mt-0.5">They attack together. Each one trains on its own, and only in this city.</p>
        </div>
        {present.length === 0 && <p className="text-[12px] text-white/45">No troops yet. Raise them from the city.</p>}
        {!atHome && present.length > 0 && <p className="text-[12px] text-[#ffd60a]">Training waits until the army returns to {place}.</p>}
        {present.map((unit) => {
          const rank = Math.max(0, Math.min(TRAINING.max, army.training[unit] ?? 0))
          const queued = orders.findIndex((o) => o.type === 'train' && o.armyId === army.id && o.unit === unit)
          return (
            <div key={unit} className="rounded-xl bg-black/20 px-2.5 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="font-medium">{UNIT_SPECS[unit].name} · {formatDivisions(army.units[unit])}</span>
                <span className="text-white/55">{trainingRank(rank)} · {rank}/{TRAINING.max}</span>
              </div>
              <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-[#0a84ff]" style={{ width: `${(rank / TRAINING.max) * 100}%` }} />
              </div>
              {atHome && !general && rank < TRAINING.max && (
                queued >= 0 ? (
                  <button type="button" className="btn btn-quiet w-full" onClick={() => removeOrder(queued)}>
                    Training this month · Cancel
                  </button>
                ) : (
                  <OrderButton
                    className="w-full"
                    order={{ type: 'train', nationId: game.playerId, armyId: army.id, unit }}
                    label={`Train · ${trainingCost(rank)} money`}
                    sub="Pays this month. The new rank stays."
                    tone="btn-primary"
                  />
                )
              )}
              {atHome && general && rank < TRAINING.max && <p className="text-[12px] text-[#8ec5ff]">Trains free this month.</p>}
              {rank >= TRAINING.max && <p className="text-[12px] text-white/40">Fully trained.</p>}
            </div>
          )
        })}
      </div>

      {army.outOfSupplyTurns > 0 && (
        <p className="text-[12px] text-[#ff8a84]">Cut off from supplies for {army.outOfSupplyTurns} month{army.outOfSupplyTurns === 1 ? '' : 's'}. Surrenders after 3.</p>
      )}
      <ArmyControls army={army} />
    </div>
  )
}
