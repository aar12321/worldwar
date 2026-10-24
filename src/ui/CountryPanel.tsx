import { useState } from 'react'
import { perceivedPower } from '../ai/diplomat'
import { opinionLabel, opinionOf } from '../ai/opinion'
import { PERSONALITIES } from '../data/personalities'
import { TERRAIN } from '../data/terrain'
import { COSTS } from '../data/unitTypes'
import { militaryPower } from '../engine/economy'
import { spySuccessChance } from '../engine/espionage'
import { armiesIn, atWar, hasCasusBelli, hasPact, isAllied } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import type { Order } from '../engine/types'
import { netWarScore } from '../engine/warscore'
import { garrisonStrength } from '../engine/warfare'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { ArmyCard } from './ArmyOrders'
import { usePlayerView, usePlayerVision } from './hooks'
import { speak } from './plain'

function ActionButton({ order, label, sub, tone = '', className = '' }: { order: Order; label: string; sub?: string; tone?: string; className?: string }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const { map } = getWorld()
  const err = validateOrder(view.game, map, order)
  const why = err ? speak(err) : null
  return (
    <button className={`btn ${tone} ${className} flex flex-col items-start gap-0.5 text-left`} disabled={!!err} title={why ?? sub ?? ''} onClick={() => issueOrder(order)}>
      <span>{label}</span>
      {(why || sub) && <span className={`font-ui normal-case tracking-normal text-[11px] font-medium ${why ? 'text-white/85' : 'text-white/50'}`}>{why ?? sub}</span>}
    </button>
  )
}

export function CountryPanel() {
  const view = usePlayerView()
  const selected = useGame((s) => s.selectedRegion)
  const panelOpen = useGame((s) => s.panel)
  const selectRegion = useGame((s) => s.selectRegion)
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const vis = usePlayerVision()
  const { map } = getWorld()
  const game = view?.game
  const [spies, setSpies] = useState(false)
  const [panelFor, setPanelFor] = useState(selected ?? '')
  if (selected && panelFor !== selected) {
    setPanelFor(selected)
    setSpies(false)
  }
  if (!view || !selected || !game || panelOpen !== 'none') return null
  const { player } = view
  const region = game.regions[selected]
  const mr = map.regions[selected]
  if (!region || !mr || region.owner === player.id) return null
  const owner = game.nations[region.owner]
  if (!owner) return null
  const canSee = vis === 'all' || vis.has(selected)
  const armies = canSee ? armiesIn(game, selected) : []
  const war = atWar(game, player.id, owner.id)
  const pact = hasPact(game, player.id, owner.id)
  const allied = isAllied(game, player.id, owner.id)
  const opinion = opinionOf(game, map, owner.id, player.id)
  const purpose = war
    ? `At war with ${owner.name}. Attack from an army in a neighboring country.`
    : allied
      ? `${owner.name} is an ally. You can ask them to join a war.`
      : pact
        ? `You have agreed not to attack ${owner.name}.`
        : `Belongs to ${owner.name}. Talk, or declare war before you can attack.`

  return (
    <aside className="glass country-panel panel-in absolute right-4 z-20 w-[min(680px,calc(100vw-160px))] rounded-[22px] flex flex-col overflow-hidden" style={{ top: 'var(--chrome-bottom, 12rem)', maxHeight: 'calc(100vh - var(--chrome-bottom, 12rem) - 7rem)' }}>
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/10">
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
            {owner.name}
          </span>
          {owner.capital === selected && <span className="chip">Capital city</span>}
          {war && <span className="chip chip-red">At war</span>}
          {allied && <span className="chip chip-blue">Ally</span>}
          {pact && <span className="chip chip-green">Peace pact</span>}
        </div>
        <p className="mt-2 text-[12px] text-white/50" title={PERSONALITIES[owner.personality].description}>
          {PERSONALITIES[owner.personality].name} · {opinionLabel(opinion)} toward you ({opinion > 0 ? '+' : ''}
          {opinion})
        </p>
        <p className="mt-2 text-[13px] leading-snug text-white/65">{purpose}</p>
      </div>
      <div className="overflow-y-auto scroll-thin p-4 space-y-3" style={{ minHeight: 0, maxHeight: 'calc(100vh - var(--chrome-bottom, 12rem) - 22rem)' }}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="People" value={`${region.population.toFixed(1)}m`} />
          <Stat label="Defenders" value={garrisonStrength(game, map, selected).toFixed(1)} />
          <Stat label="Defense" value={`${TERRAIN[mr.terrain].defense.toFixed(2)}×`} />
        </div>
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
        {!canSee && <p className="text-[13px] text-white/50">You cannot see armies here. Steal their maps, or research satellites.</p>}
        {armies.map((army) => (
          <ArmyCard key={army.id} army={army} game={game} />
        ))}
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
      <div className="shrink-0 px-4 py-3 border-t border-white/10 flex flex-wrap gap-1.5">
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
        <button type="button" className="btn btn-quiet" onClick={() => setSpies((open) => !open)}>
          {spies ? 'Hide espionage' : 'Espionage'}
        </button>
      </div>
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset-card py-2 px-1">
      <div className="label">{label}</div>
      <div className="text-[14px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
