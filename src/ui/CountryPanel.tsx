import { opinionLabel, opinionOf } from '../ai/opinion'
import { PERSONALITIES } from '../data/personalities'
import { TERRAIN } from '../data/terrain'
import { BUILDING_SPECS, COSTS } from '../data/unitTypes'
import { regionWorkforce } from '../engine/economy'
import { spySuccessChance } from '../engine/espionage'
import { atWar, hasCasusBelli, hasPact, isAllied } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import type { Order } from '../engine/types'
import { BUILDING_TYPES } from '../engine/types'
import { garrisonStrength } from '../engine/warfare'
import { netWarScore } from '../engine/warscore'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { MilitaryCompare } from './MilitaryCompare'
import { speak } from './plain'

function ActionButton({ order, label, sub, tone = '', className = '', onDone }: { order: Order; label: string; sub?: string; tone?: string; className?: string; onDone?: () => void }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const { map } = getWorld()
  const err = validateOrder(view.game, map, order, view.orders)
  const why = err ? speak(err) : null
  return (
    <button
      className={`btn ${tone} ${className} flex flex-col items-start gap-0.5 text-left`}
      disabled={!!err}
      title={why ?? sub ?? ''}
      onClick={() => {
        if (issueOrder(order)) onDone?.()
      }}
    >
      <span>{label}</span>
      {(why || sub) && <span className={`font-ui normal-case tracking-normal text-[12px] font-medium ${why ? 'text-white/85' : 'text-white/65'}`}>{why ?? sub}</span>}
    </button>
  )
}

/** The country you clicked: who holds it, how strong it is, and what you can do about it. */
export function CountryPanel() {
  const view = usePlayerView()
  const selected = useGame((s) => s.selectedRegion)
  const selectRegion = useGame((s) => s.selectRegion)
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const openCountry = useGame((s) => s.openCountry)
  const setPanel = useGame((s) => s.setPanel)
  const attack = useGame((s) => s.attack)
  const { map } = getWorld()
  if (!view || !selected) return null
  const { game, player, orders } = view
  const region = game.regions[selected]
  const mr = map.regions[selected]
  const owner = game.nations[region.owner]
  const mine = region.owner === player.id
  const war = !mine && atWar(game, player.id, owner.id)
  const pact = !mine && hasPact(game, player.id, owner.id)
  const allied = !mine && isAllied(game, player.id, owner.id)
  const opinion = mine ? 0 : opinionOf(game, map, owner.id, player.id)
  const built = BUILDING_TYPES.filter((b) => region.buildings[b] > 0)
  const attackErr = war ? validateOrder(game, map, { type: 'attack', nationId: player.id, target: selected }, orders) : null
  const purpose = mine
    ? 'Your country. Upgrade it in Country, and train its military in Military.'
    : war
      ? `At war with ${owner.name}. Attack takes the whole country if your military wins.`
      : allied
        ? `${owner.name} is an ally. You can ask them to join a war.`
        : pact
          ? `You have agreed not to attack ${owner.name}.`
          : `Belongs to ${owner.name}. Declare war before you can attack.`

  return (
    <aside key={selected} data-section="country" aria-label={mr.name} className="country-card surface">
      <div className="px-5 pt-4 pb-3 border-b border-white/10 flex-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label">
              {TERRAIN[mr.terrain].name} · {mr.coastal ? 'Coast' : 'Inland'}
            </p>
            <h2 className="text-[24px] font-semibold tracking-tight mt-0.5 truncate">{mr.name}</h2>
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
          {owner.capital === selected && <span className="chip">Capital</span>}
          {war && <span className="chip chip-red">At war</span>}
          {allied && <span className="chip chip-blue">Ally</span>}
          {pact && <span className="chip chip-green">Peace pact</span>}
        </div>
        {!mine && (
          <p className="mt-2 text-[13px] text-white/70" title={PERSONALITIES[owner.personality].description}>
            {PERSONALITIES[owner.personality].name} · {opinionLabel(opinion)} toward you ({opinion > 0 ? '+' : ''}
            {opinion})
          </p>
        )}
        <p className="mt-2 text-[14px] leading-snug text-white/75">{purpose}</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-5 space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="People" value={`${region.population.toFixed(1)}m`} />
          <Stat label="Workforce" value={regionWorkforce(region, mr).toFixed(1)} />
          <Stat label="Garrison" value={garrisonStrength(game, map, selected).toFixed(1)} />
        </div>
        {built.length > 0 && (
          <div className="inset-card p-3.5">
            <div className="label mb-1.5">Upgrades</div>
            <div className="flex flex-wrap gap-1.5">
              {built.map((b) => (
                <span key={b} className="chip">
                  {BUILDING_SPECS[b].name} {region.buildings[b]}
                </span>
              ))}
            </div>
          </div>
        )}
        {region.rebels > 0 && <p className="text-[14px] text-[#ff8a84]">Rebels are rising here ({region.rebels.toFixed(1)} divisions).</p>}

        {mine ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => openCountry('build')}>
              Upgrade country
            </button>
            <button className="btn" onClick={() => setPanel('military')}>
              Your military
            </button>
            {region.rebels > 0 && (
              <ActionButton order={{ type: 'suppressRebels', nationId: player.id, regionId: selected }} label="Crack down" sub={`${COSTS.suppressRebels} influence. Halves the rebels.`} tone="btn-magenta" />
            )}
          </div>
        ) : (
          <>
            <MilitaryCompare game={game} mine={player.id} theirs={owner.id} />
            {war && <p className="text-[14px] text-white/75">War score: {netWarScore(game, player.id, owner.id)}</p>}
            <div className="flex flex-wrap gap-2">
              {war ? (
                <>
                  <button className="btn btn-red" disabled={!!attackErr} title={attackErr ? speak(attackErr) : 'Attack with your whole military'} onClick={() => attack(selected)}>
                    <span className="block">Attack</span>
                    {attackErr && <span className="block text-[12px] font-medium text-white/85 normal-case">{speak(attackErr)}</span>}
                  </button>
                  <button className="btn btn-primary" onClick={() => openDiplomacy(owner.id)}>
                    Make peace
                  </button>
                </>
              ) : (
                <>
                  {!allied && (
                    <ActionButton
                      order={{ type: 'declareWar', nationId: player.id, target: owner.id }}
                      label="Declare war"
                      sub={hasCasusBelli(game, player.id, owner.id) ? `${COSTS.declareWarWithCasusBelli} influence, because you have a grievance.` : `${COSTS.declareWar} influence.`}
                      tone="btn-red"
                    />
                  )}
                  <button className="btn btn-primary" onClick={() => openDiplomacy(owner.id)}>
                    Talk
                  </button>
                </>
              )}
            </div>
            <ActionButton
              order={{ type: 'spy', nationId: player.id, target: selected, mission: 'sabotage' }}
              label="Sabotage factories"
              sub={`${COSTS.spy} money · ${Math.round(spySuccessChance(game, player.id, selected) * 100)}% chance. If you are caught they gain a grievance.`}
              tone="btn-magenta"
            />
          </>
        )}
      </div>
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset-card py-2.5 px-1">
      <div className="label">{label}</div>
      <div className="text-[16px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
