import { opinionLabel, opinionOf } from '../ai/opinion'
import { BORDER_LABEL, STATION } from '../data/deployment'
import { bordersOf } from '../engine/borders'
import { lineBonus } from '../engine/deployment'
import { deploymentView, showDivisions } from '../engine/intel'
import { tensionColor } from './colors'
import { PERSONALITIES } from '../data/personalities'
import { TERRAIN } from '../data/terrain'
import { BUILDING_SPECS, COSTS } from '../data/unitTypes'
import { integrationFactor, lineMax, regionWorkforce } from '../engine/economy'
import { atWar, formatDivisions, hasPact, isAllied, justificationOf } from '../engine/helpers'
import { warCost } from '../engine/orders'
import { JUSTIFY } from '../data/war'
import { militaryPower } from '../engine/militaryStats'
import { powerView, showPower } from '../engine/intel'
import { validateOrder } from '../engine/orders'
import { BUILDING_TYPES, UNIT_TYPES } from '../engine/types'
import { garrisonStrength } from '../engine/warfare'
import { outlookAt, roughOdds } from '../engine/forecast'
import { commandLevel } from '../engine/commander'
import { netWarScore } from '../engine/warscore'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import type { GameState, RegionId, WorldMap } from '../engine/types'
import { useHumanName, usePlayerView } from './hooks'
import { UnitIcon } from './icons'
import { MilitaryCompare } from './MilitaryCompare'
import { OrderButton } from './panel'
import { speak } from './plain'
import { LineBar } from './WarRoom'

/** The country you clicked: who holds it, how strong it is, and the two or three things you can do about it. */
export function CountryPanel() {
  const view = usePlayerView()
  const selected = useGame((s) => (s.selectedArmy && s.game?.armies?.some((a) => a.id === s.selectedArmy) ? null : s.selectedRegion))
  const selectRegion = useGame((s) => s.selectRegion)
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const openAgencies = useGame((s) => s.openAgencies)
  const openEconomy = useGame((s) => s.openEconomy)
  const openMilitary = useGame((s) => s.openMilitary)
  const openWarRoom = useGame((s) => s.openWarRoom)
  const { map } = getWorld()
  // Read before the early return below: a hook may not be skipped on some renders.
  const humanName = useHumanName(useGame((s) => (selected ? (s.game?.regions[selected]?.owner ?? null) : null)))
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
  const max = lineMax(game, map, selected)
  const line = Math.min(region.line, max)
  const myPower = militaryPower(game, player.id)
  const theirView = mine ? { value: myPower, exact: true } : powerView(game, player.id, owner.id)
  const theirPower = theirView.value
  const odds = war ? outlookAt(game, map, player.id, selected) : null
  const exactOdds = commandLevel(game, player.id) >= 1
  const oddsText = (f: { winChance: number }) => (exactOdds ? `${Math.round(f.winChance * 100)}%` : roughOdds(game, player.id, selected, f.winChance).text.replace('about ', '~'))
  const settling = region.integration < 1
  const purpose = mine
    ? settling
      ? `You conquered this country. It gives ${Math.round(integrationFactor(region) * 100)}% of its output until it settles.`
      : 'Your country. Upgrade it in Economy.'
    : war
      ? 'You are at war. Win battles to push its Defense Line to zero and the country is yours.'
      : allied
        ? `${owner.name} is your ally.`
        : pact
          ? `You have a pact with ${owner.name}. Neither side may attack.`
          : `Belongs to ${owner.name}. You must declare war before you can attack.`

  return (
    <aside key={selected} data-section="country" aria-label={mr.name} className="country-card surface">
      <div className="px-5 pt-4 pb-3 border-b border-white/10 flex-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[24px] font-semibold tracking-tight truncate">{mr.name}</h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="chip">
                <span className="w-2 h-2 rounded-full" style={{ background: owner.color }} />
                {mine ? 'Yours' : owner.name}
              </span>
              {owner.capital === selected && <span className="chip">Capital</span>}
              {war && <span className="chip chip-red">At war</span>}
              {allied && <span className="chip chip-blue">Ally</span>}
              {pact && <span className="chip chip-green">Pact</span>}
              {settling && <span className="chip">Settling</span>}
            </div>
          </div>
          <button className="icon-close shrink-0" aria-label="Close" onClick={() => selectRegion(null)}>
            ×
          </button>
        </div>
        <p className="mt-2.5 text-[14px] leading-snug text-white/80">{purpose}</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-5 space-y-4">
        {!mine && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-[14px]">
              <span className="font-semibold">Military strength</span>
              <span className="tabular-nums text-white/80">
                You {myPower.toFixed(0)} · them {showPower(theirView)}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-[#ff453a]/70 overflow-hidden" role="img" aria-label={`Your strength ${myPower.toFixed(0)} against ${showPower(theirView)}`}>
              <div className="h-full bg-[#0a84ff]" style={{ width: `${(myPower / Math.max(1, myPower + theirPower)) * 100}%` }} />
            </div>
            {war && (
              <p className="text-[12.5px] leading-snug text-white/70" title="Strength adds up what each unit is worth. It leaves out their garrison, the terrain, the Defense Line, the stance and how much of your force goes, and the defender wins ties.">
                Strength is not odds.{' '}
                {odds ? (
                  <>
                    Attacking {mr.name} now: a main force wins <b className="text-white/90">{oddsText(odds.main)}</b>, everything <b className="text-white/90">{oddsText(odds.allin)}</b>.
                  </>
                ) : (
                  'Out of reach for now: odds appear when you can attack. A main force usually needs about twice their strength to be sure.'
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {UNIT_TYPES.filter((u) => owner.military.units[u] >= 0.05).map((u) => (
                <span key={u} className="chip" title={`${owner.name}'s ${u}`}>
                  <UnitIcon unit={u} size={15} /> {formatDivisions(owner.military.units[u])}
                </span>
              ))}
              {UNIT_TYPES.every((u) => owner.military.units[u] < 0.05) && <span className="text-[13px] text-white/70">No field army. Only the garrison defends.</span>}
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="font-semibold">Defense Line</span>
            <span className="tabular-nums text-white/80">
              {line.toFixed(1)} of {max.toFixed(1)}
            </span>
          </div>
          <LineBar now={line} max={max} />
          {mine && <p className="text-[13px] text-white/70">An enemy must wear this down to zero to take the country. Barracks make it longer.</p>}
        </div>
        <BorderCard game={game} map={map} selected={selected} mine={mine} />
        {region.rebels > 0 && <p className="text-[14px] text-[#ff8a84]">Rebels are fighting here ({region.rebels.toFixed(1)} divisions).</p>}

        {mine ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => openEconomy('country', selected)}>
              Upgrade this country
            </button>
            <button className="btn" onClick={() => openMilitary('forces')}>
              Military
            </button>
            {region.rebels > 0 && (
              <OrderButton order={{ type: 'suppressRebels', nationId: player.id, regionId: selected }} label="Crack down" cost={`${COSTS.suppressRebels} influence`} effect="Halves the rebels here" tone="btn-magenta" />
            )}
          </div>
        ) : war ? (
          <div className="flex flex-wrap gap-2">
            <button className={`btn btn-red ${attackErr ? 'flex flex-col items-start gap-0.5 text-left' : ''}`} disabled={!!attackErr} title={attackErr ? speak(attackErr) : 'Plan an attack (A)'} onClick={() => openWarRoom(selected)}>
              <span>Plan an attack</span>
              {attackErr && <span className="text-[12px] font-medium text-white/90 normal-case">{speak(attackErr)}</span>}
            </button>
            <button className="btn btn-primary" onClick={() => openDiplomacy(owner.id)}>
              Make peace
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!allied && (
              <OrderButton
                order={{ type: 'declareWar', nationId: player.id, target: owner.id }}
                label="Declare war"
                cost={`${warCost(game, player.id, owner.id)} influence`}
                effect={justificationOf(game, player.id, owner.id) ? `Reason: ${justificationOf(game, player.id, owner.id)!.reason}. Then plan attacks here.` : 'No reason to fight: costs stability and the world will distrust you. Build a case first.'}
                tone="btn-red"
              />
            )}
            {!allied && !justificationOf(game, player.id, owner.id) && (
              <OrderButton
                order={{ type: 'buildCase', nationId: player.id, target: owner.id }}
                label="Build a case"
                cost={`${JUSTIFY.caseCost} influence`}
                effect={`A reason for war, ready in ${JUSTIFY.caseMonths} months. Then war costs only ${COSTS.declareWarWithCasusBelli} influence.`}
              />
            )}
            <button className="btn btn-primary self-start" onClick={() => openDiplomacy(owner.id)}>
              Diplomacy
            </button>
          </div>
        )}

        <details className="details-card">
          <summary>More about {mr.name}</summary>
          <div className="space-y-3 pt-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="People" value={`${region.population.toFixed(1)}m`} />
              <Stat label="Land" value={TERRAIN[mr.terrain].name} />
              <Stat label="Garrison" value={garrisonStrength(game, map, selected).toFixed(1)} />
            </div>
            <p className="text-[13px] text-white/70">
              {TERRAIN[mr.terrain].name} land{TERRAIN[mr.terrain].defense > 1 ? ` helps the defender (×${TERRAIN[mr.terrain].defense})` : ' gives the defender no bonus'}. {mr.coastal ? 'On the coast, so warships can fight here.' : 'Inland, so warships cannot fight here.'} Workforce {regionWorkforce(region, mr).toFixed(1)}.
            </p>
            {built.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {built.map((b) => (
                  <span key={b} className="chip">
                    {BUILDING_SPECS[b].name} {region.buildings[b]}
                  </span>
                ))}
              </div>
            )}
            {!mine && (
              <>
                {humanName ? (
                  <p className="text-[13px] text-white/75">
                    {owner.name} is played by <span className="font-semibold">{humanName}</span>, not the AI.{war ? ` War score ${netWarScore(game, player.id, owner.id)}.` : ''}
                  </p>
                ) : (
                  <p className="text-[13px] text-white/75" title={PERSONALITIES[owner.personality].description}>
                    {owner.name} is {PERSONALITIES[owner.personality].name.toLowerCase()} and {opinionLabel(opinion).toLowerCase()} toward you ({opinion > 0 ? '+' : ''}
                    {opinion}).{war ? ` War score ${netWarScore(game, player.id, owner.id)}.` : ''}
                  </p>
                )}
                <MilitaryCompare game={game} mine={player.id} theirs={owner.id} />
                <button className="btn btn-magenta" onClick={() => openAgencies(owner.id)}>
                  Send the agency
                </button>
              </>
            )}
          </div>
        </details>
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

/** The border between the country you clicked and yours: its state, its tension and why, and who guards it. */
function BorderCard({ game, map, selected, mine }: { game: GameState; map: WorldMap; selected: RegionId; mine: boolean }) {
  const openMilitary = useGame((s) => s.openMilitary)
  const player = game.playerId
  if (mine) {
    const bonus = lineBonus(game, map, selected)
    return bonus > 0.05 ? <p className="text-[13px] text-[#6cb4ff]">Border garrisons add {bonus.toFixed(1)} to this country's Defense Line.</p> : null
  }
  const owner = game.regions[selected].owner
  const b = bordersOf(game, map, player).find((x) => x.other === owner)
  if (!b) return null
  const view = deploymentView(game, player, owner)
  const theirs = b.land ? (view.exact ? b.theirDivisions : (view.border[player] ?? 0)) : 0
  return (
    <div className="space-y-1.5" aria-label="Border">
      <div className="flex items-baseline justify-between text-[14px]">
        <span className="font-semibold">
          {b.land ? 'Border' : 'Sea border'} with {owner === player ? 'you' : game.nations[owner].name}
          <span className={`chip ml-2 ${b.state === 'disputed' ? 'chip-red' : b.state === 'open' ? 'chip-green' : b.state === 'fortified' ? 'chip-blue' : ''}`}>{BORDER_LABEL[b.state]}</span>
        </span>
        <span className="tabular-nums text-white/80">Tension {b.tension}</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden" role="img" aria-label={`Border tension ${b.tension} of 100`}>
        <div className="h-full" style={{ width: `${b.tension}%`, background: tensionColor(b.tension) }} />
      </div>
      <p className="text-[12px] text-white/65">{b.parts.map((p) => `${p.label} ${p.value > 0 ? '+' : ''}${p.value}`).join(' · ')}</p>
      {b.land ? (
        <p className="text-[13px] text-white/75">
          You guard it with {b.mineDivisions.toFixed(1)} divisions ({Math.round(b.mineCover * 100)}% of a full guard of about {(STATION.fullPerRegion * b.fronts).toFixed(1)}).{' '}
          {theirs > 0 ? `They keep ${showDivisions(theirs, view.exact)} facing you${view.exact ? '' : ' (a guess)'}.` : view.exact ? (view.posted ? 'They have nobody posted facing you: a weak spot.' : 'They have set no posture.') : 'What they keep here is not known: gather intelligence.'}
        </p>
      ) : (
        <p className="text-[13px] text-white/75">Across the sea. Warships on patrol and the submarine screen guard it.</p>
      )}
      <button className="btn px-3 py-1 text-[13px]" onClick={() => openMilitary("deploy")}>
        Deployment
      </button>
    </div>
  )
}
