import { useState } from 'react'
import { GENERAL_TRAITS } from '../data/startingNations'
import { TRAINING, UNIT_SPECS, trainingRank } from '../data/unitTypes'
import { combatMods, weaponTiers } from '../engine/arms'
import { unitPower } from '../engine/economy'
import { formatDivisions, totalUnits } from '../engine/helpers'
import type { Army, GameState, UnitType } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'

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
  const rank = Math.max(0, Math.min(TRAINING.max, army.training ?? 0))
  const tiers = weaponTiers(owner, game.turn)
  const power = unitPower(army.units, combatMods(owner, game.turn), rank)

  return (
    <div
      className={`inset-card p-3 transition-colors ${selected ? 'ring-1 ring-white/35' : ''} ${mine ? 'cursor-pointer' : ''}`}
      onClick={() => mine && selectArmy(army.id)}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: owner.color }} />
          <span className="text-[14px] font-semibold tracking-tight">{mine ? map.territories[army.homeTerritoryId]?.name ?? 'Your army' : owner.name}</span>
        </div>
        <span className="text-[12px] text-white/45">{formatDivisions(totalUnits(army.units))} div · strength {power.toFixed(1)}</span>
      </div>
      <UnitStrip units={army.units} tiers={tiers} />
      <div className="mt-1.5">
        <div className="flex justify-between text-[11px]">
          <span className="text-white/70">{trainingRank(rank)}{home ? ` · ${home.name}` : ''}</span>
          <span className="text-white/40">{rank}/{TRAINING.max}</span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-[#0a84ff]" style={{ width: `${(rank / TRAINING.max) * 100}%` }} />
        </div>
      </div>
      {mine && army.outOfSupplyTurns > 0 && (
        <div className="mt-1.5 text-[12px] text-[#ff8a84]">Cut off from supplies for {army.outOfSupplyTurns} month{army.outOfSupplyTurns === 1 ? '' : 's'}. Surrenders after 3.</div>
      )}
      {mine && (
        <ArmyControls army={army} game={game} />
      )}
    </div>
  )
}

export function ArmyControls({ army, game }: { army: Army; game: GameState }) {
  const [staffOpen, setStaffOpen] = useState(false)
  const { map } = getWorld()
  const selectedArmy = useGame((s) => s.selectedArmy)
  const targetMode = useGame((s) => s.targetMode)
  const orders = useGame((s) => s.orders)
  const selectArmy = useGame((s) => s.selectArmy)
  const setTargetMode = useGame((s) => s.setTargetMode)
  const issueOrder = useGame((s) => s.issueOrder)
  const removeOrder = useGame((s) => s.removeOrder)
  const owner = game.nations[army.owner]
  const selected = selectedArmy === army.id
  const pendingIdx = orders.findIndex((o) => (o.type === 'move' || o.type === 'attack') && o.armyId === army.id)
  const pending = pendingIdx >= 0 ? orders[pendingIdx] : null
  const pendingGeneral = orders.find((o) => o.type === 'assignGeneral' && o.armyId === army.id)
  const generalValue = pendingGeneral && pendingGeneral.type === 'assignGeneral' ? pendingGeneral.generalId ?? '' : army.generalId ?? ''
  const general = owner.generals.find((g) => g.id === generalValue)

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
          <p className="text-[11px] text-white/40">Move into a neighbor you can enter. Attack only works during a war.</p>
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
          <button type="button" className="btn btn-quiet w-full text-left" onClick={() => setStaffOpen((open) => !open)}>
            {general ? `Commander · ${general.name}` : 'Choose a commander'}
          </button>
          {staffOpen && (
            <select
              className="field w-full px-2 py-1.5 text-[13px]"
              value={generalValue}
              onChange={(e) => issueOrder({ type: 'assignGeneral', nationId: game.playerId, armyId: army.id, generalId: e.target.value || null })}
            >
              <option value="">None</option>
              {owner.generals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({GENERAL_TRAITS[g.trait].name})
                </option>
              ))}
            </select>
          )}
          {staffOpen && general && <div className="text-[12px] text-white/50">{GENERAL_TRAITS[general.trait].name}: {GENERAL_TRAITS[general.trait].description}</div>}
        </div>
  )
}
