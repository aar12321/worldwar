import { GENERAL_TRAITS } from '../data/startingNations'
import { TRAINING, UNIT_SPECS, trainingRank } from '../data/unitTypes'
import { combatMods, weaponTiers } from '../engine/arms'
import { unitPower } from '../engine/economy'
import { formatDivisions, totalUnits } from '../engine/helpers'
import type { Army, GameState, UnitType } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { UNIT_GLYPH } from './labels'

export function UnitStrip({ units, tiers }: { units: Army['units']; tiers?: Partial<Record<UnitType, number>> }) {
  const present = UNIT_TYPES.filter((k) => units[k] >= 0.05)
  if (!present.length) return <p className="text-[11px] text-slate-500">No divisions yet.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {present.map((k) => (
        <span key={k} className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[11px] font-semibold text-slate-200" title={UNIT_SPECS[k].name}>
          <span className="text-cyan-300/80 font-display text-[9px] mr-1">{UNIT_GLYPH[k]}</span>
          {UNIT_SPECS[k].name} {formatDivisions(units[k])}
          {tiers?.[k] ? <span className="text-amber-300"> T{tiers[k]}</span> : null}
        </span>
      ))}
    </div>
  )
}

export function ArmyCard({ army, game }: { army: Army; game: GameState }) {
  const { map } = getWorld()
  const selectedArmy = useGame((s) => s.selectedArmy)
  const targetMode = useGame((s) => s.targetMode)
  const orders = useGame((s) => s.orders)
  const selectArmy = useGame((s) => s.selectArmy)
  const setTargetMode = useGame((s) => s.setTargetMode)
  const issueOrder = useGame((s) => s.issueOrder)
  const removeOrder = useGame((s) => s.removeOrder)
  const mine = army.owner === game.playerId
  const owner = game.nations[army.owner]
  const selected = selectedArmy === army.id
  const pendingIdx = orders.findIndex((o) => (o.type === 'move' || o.type === 'attack') && o.armyId === army.id)
  const pending = pendingIdx >= 0 ? orders[pendingIdx] : null
  const general = owner.generals.find((g) => g.id === army.generalId)
  const pendingGeneral = orders.find((o) => o.type === 'assignGeneral' && o.armyId === army.id)
  const generalValue = pendingGeneral && pendingGeneral.type === 'assignGeneral' ? pendingGeneral.generalId ?? '' : army.generalId ?? ''
  const home = map.territories[army.homeTerritoryId]
  const rank = Math.max(0, Math.min(TRAINING.max, army.training ?? 0))
  const tiers = weaponTiers(owner, game.turn)
  const power = unitPower(army.units, combatMods(owner, game.turn), rank)

  return (
    <div
      className={`rounded-lg border p-2.5 transition-colors ${selected ? 'border-cyan-300/70 bg-cyan-400/10 shadow-[0_0_18px_rgba(34,211,238,0.25)]' : 'border-slate-700/70 bg-slate-900/40'} ${mine ? 'cursor-pointer' : ''}`}
      onClick={() => mine && selectArmy(army.id)}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: owner.color, boxShadow: `0 0 8px ${owner.color}` }} />
          <span className="font-display text-[11px] tracking-wider">{mine ? `ARMY ${army.id.toUpperCase()}` : owner.name.toUpperCase()}</span>
        </div>
        <span className="text-xs text-slate-400">{formatDivisions(totalUnits(army.units))} div · pow {power.toFixed(1)}</span>
      </div>
      <UnitStrip units={army.units} tiers={tiers} />
      <div className="mt-1.5">
        <div className="flex justify-between text-[11px]">
          <span className="text-cyan-200">{trainingRank(rank)}{home ? ` · ${home.name}` : ''}</span>
          <span className="text-slate-500">{rank}/{TRAINING.max}</span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full rounded-full bg-cyan-400" style={{ width: `${(rank / TRAINING.max) * 100}%` }} />
        </div>
      </div>
      {mine && army.outOfSupplyTurns > 0 && (
        <div className="mt-1.5 text-xs text-rose-300">OUT OF SUPPLY for {army.outOfSupplyTurns} month(s). Surrenders at 3.</div>
      )}
      {mine && (
        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <span className="label">General</span>
            <select
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs"
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
          </div>
          {general && <div className="text-[11px] text-slate-400">{GENERAL_TRAITS[general.trait].description}</div>}
          <div className="flex gap-2">
            <button
              className={`btn flex-1 ${selected && targetMode === 'move' ? 'bg-cyan-400/25' : ''}`}
              onClick={() => {
                selectArmy(army.id)
                setTargetMode(selected && targetMode === 'move' ? null : 'move')
              }}
            >
              Move
            </button>
            <button
              className={`btn btn-magenta flex-1 ${selected && targetMode === 'attack' ? 'bg-fuchsia-400/25' : ''}`}
              onClick={() => {
                selectArmy(army.id)
                setTargetMode(selected && targetMode === 'attack' ? null : 'attack')
              }}
            >
              Attack
            </button>
          </div>
          {pending && (
            <div className="flex items-center justify-between rounded bg-slate-800/70 px-2 py-1 text-xs">
              <span className={pending.type === 'attack' ? 'text-fuchsia-300' : 'text-cyan-300'}>
                {pending.type === 'attack' ? 'Front: attack ' : 'Moving to '}
                {map.regions[pending.type === 'attack' ? pending.target : pending.type === 'move' ? pending.to : army.location].name}
              </span>
              <button className="text-slate-400 hover:text-white" onClick={() => removeOrder(pendingIdx)}>
                cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
