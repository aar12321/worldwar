import { useMemo, useState, type KeyboardEvent } from 'react'
import { TERRAIN } from '../data/terrain'
import { STANCES, type Stance } from '../data/war'
import { planTrip, tripSchedule } from '../engine/armies'
import { absDate, clockOf, isLive } from '../engine/calendar'
import { computeEconomy } from '../engine/economy'
import { capabilities, commandLevel, compareStances } from '../engine/commander'
import { attackPool } from '../engine/deploy'
import { forecastMemo, roughOdds } from '../engine/forecast'
import { formatDivisions, maxAttacks, totalUnits } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import type { NationId, RegionId } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { CommandCenter } from './CommandCenter'
import { choiceOrder, choicePlan, choiceUnits, suggestedChoice, warRoomPick, type Choice } from './attackChoices'
import { DeployPanel, type ChoiceOdds } from './DeployPanel'
import { usePlayerView } from './hooks'
import { MilitaryCompare } from './MilitaryCompare'
import { Modal } from './Modal'
import { Breakdown, OddsGauge } from './OddsGauge'
import { speak } from './plain'
import { TerritoryForces } from './TerritoryForces'
import { sendingTerritories, territoryAttack, useTerritoryPrefs } from './territoryPrefs'

const STANCE_KEYS = Object.keys(STANCES) as Stance[]
const LABEL_TONE = { Likely: 'text-[#6eeb8a]', Even: 'text-[#ffd60a]', Unlikely: 'text-[#ff8a84]' }

/** A line bar: how much resistance a country has left, and how much a push would take. */
export function LineBar({ now, max, after }: { now: number; max: number; after?: number }) {
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(0.01, max)) * 100))}%`
  return (
    <div className="h-3 rounded-full bg-white/12 overflow-hidden relative" role="img" aria-label={`Defense Line ${now.toFixed(1)} of ${max.toFixed(1)}`}>
      <div className="absolute inset-y-0 left-0 bg-[#ff453a]/55" style={{ width: w(now) }} />
      {after !== undefined && <div className="absolute inset-y-0 left-0 bg-[#ff9f0a]" style={{ width: w(after) }} />}
    </div>
  )
}

export function WarRoom() {
  const target = useGame((s) => s.warRoom)
  return target ? <WarRoomDialog key={target} target={target} /> : null
}

const CHOICE_KEYS: Record<string, Choice> = { n: 'none', p: 'probe', m: 'main', a: 'allin' }

/**
 * Plan one attack: how much of the military to send (None, Probe, Main force or All in), how to fight, and the chance it works, live as
 * you change anything. An attack carries no missiles: strikes are in Military, Missile War.
 */
function WarRoomDialog({ target }: { target: RegionId }) {
  const attack = useGame((s) => s.attack)
  const open = useGame((s) => s.openWarRoom)
  // Read the date from the game itself: the view the rest of this screen reads can be a few quiet days behind.
  const today = useGame((s) => (s.game ? clockOf(s.game) : 0))
  const view = usePlayerView()
  const game = view?.game
  const player = view?.player
  const live = !!game && isLive(game)
  const pool = game && player ? attackPool(game, player.id, view?.orders ?? [], live) : null
  const { map } = getWorld()
  const coastal = !!map.regions[target]?.coastal
  // Opened from the target ranking: the size and stance its odds were for, so the big number is the row's number.
  const [pick] = useState(() => {
    const p = warRoomPick.current?.target === target ? warRoomPick.current : null
    warRoomPick.current = null
    return p
  })
  const [choice, setChoice] = useState<Choice>(() => pick?.choice ?? (view && pool ? suggestedChoice(view.game, map, view.player.id, target, pool, coastal) : 'main'))
  const [stance, setStance] = useState<Stance>(pick?.stance ?? 'assault')
  const [terr, setTerr] = useState<Record<NationId, Choice>>({})
  const sendPrefs = useTerritoryPrefs((s) => s.send)
  const level = player ? commandLevel(game!, player.id) : 0
  const cap = capabilities(level)
  const units = pool ? choiceUnits(pool, choice, coastal) : null
  const sent = units ? totalUnits(units) : 0

  // Every forecast here is the same call on the same plan (named units, no missiles), so a choice's row, the stance cards and the big number agree.
  const forecast = useMemo(() => (game && player && units && sent >= 0.05 ? forecastMemo(game, map, player.id, choicePlan(target, stance, units)) : null), [game, player, pool, choice, stance, target, map]) // eslint-disable-line react-hooks/exhaustive-deps
  const forecasts = useMemo(() => {
    if (!game || !player || !units || sent < 0.05) return null
    return Object.fromEntries(STANCE_KEYS.map((st) => [st, forecastMemo(game, map, player.id, choicePlan(target, st, units), 128)])) as Record<Stance, ReturnType<typeof forecastMemo>>
  }, [game, player, pool, choice, target, map]) // eslint-disable-line react-hooks/exhaustive-deps
  const bestStance = useMemo(() => {
    if (!cap.stance || !game || !player || !units || sent < 0.5) return null
    return compareStances(game, map, player.id, choicePlan(target, stance, units), 'win').best
  }, [cap.stance, game, player, pool, choice, target, map]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!view || !game || !player || !pool || !units || !game.regions[target]) return null

  const region = game.regions[target]
  const mr = map.regions[target]
  const owner = game.nations[region.owner]
  const order = choiceOrder(player.id, target, stance, units)
  const err = choice === 'none' ? 'Choose how much to send' : validateOrder(game, map, order, view.orders)
  const f = forecast
  const rough = f && !cap.exact ? roughOdds(game, player.id, target, f.winChance) : null
  const bill = computeEconomy(game, map, player.id).warBills.find((b) => b.enemy === owner.id)?.amount ?? 0
  const lineNow = f?.lineBefore ?? region.line
  const lineMaxNow = f?.lineMax ?? lineNow
  const trip = live ? planTrip(game, map, player.id, target) : null
  const when = trip ? tripSchedule(trip, today) : null
  const sentThisMonth = player.military.lastAttackTurn === game.turn ? player.military.attacksThisTurn : 0
  const route = trip ? (trip.via === 'land' ? 'by land' : trip.via === 'lane' ? 'across the sea' : trip.via === 'fleet' ? 'by sea' : 'by air') : ''
  const share = sent / Math.max(0.1, totalUnits(pool))
  const away = Math.min(1, player.military.exposed + share)

  /** A choice's odds, from the same forecast the big number uses (the selected row equals it exactly). */
  const choiceOdds = (c: Choice): ChoiceOdds | null => {
    const cf = c === choice ? f : forecastMemo(game, map, player.id, choicePlan(target, stance, choiceUnits(pool, c, coastal)))
    if (!cf || totalUnits(choiceUnits(pool, c, coastal)) < 0.05) return null
    const label = cap.exact ? cf.label : roughOdds(game, player.id, target, cf.winChance).label
    const text = cap.exact ? `${label} · ${Math.round(cf.winChance * 100)}%` : `${label} · ${roughOdds(game, player.id, target, cf.winChance).text}`
    return { text, tone: label === 'Likely' ? 'good' : label === 'Even' ? 'even' : 'bad', losses: cf.yourLosses }
  }
  const openMissileWar = () => {
    open(null)
    useGame.getState().openMilitary('missiles')
  }

  const key = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (CHOICE_KEYS[k]) setChoice(CHOICE_KEYS[k])
    else if (k === '1' || k === '2' || k === '3') setStance(STANCE_KEYS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  return (
    <Modal
      title={`War Room · ${mr.name}`}
      kicker={`${owner.name} · ${TERRAIN[mr.terrain].name}${owner.capital === target ? ' · Capital' : ''}`}
      onClose={() => open(null)}
      tone="#ff9f0a"
      footer={
        <>
          <button className="btn btn-quiet mr-auto" onClick={() => open(null)}>
            Cancel
          </button>
          {f && !err && (
            <span className="text-[13px] text-white/80 tabular-nums mr-1 hidden sm:inline" aria-live="polite">
              {cap.exact ? `${f.label} · ${Math.round(f.winChance * 100)}% to win` : `${rough?.label ?? f.label} · ${rough?.text ?? ''} to win`} · lose about {Math.round(f.yourLosses)}
            </span>
          )}
          {err && <span className="text-[13px] text-white/80 max-w-[260px] text-right">{speak(err)}</span>}
          <button className="btn btn-red px-5" data-autofocus disabled={!!err} onClick={() => {
              // Territories fight first, each as an army of its own, then yours.
              for (const id of sendingTerritories(game, player.id, target)) if (sendPrefs[id]) {
                const pickedUnits = choiceUnits(attackPool(game, id, [], live), terr[id] ?? 'main', coastal)
                if (totalUnits(pickedUnits) >= 0.05) useGame.getState().issueOrder(territoryAttack(player.id, id, target, stance, pickedUnits))
              }
              // No missiles, ever: the order names its units and nothing else.
              attack(target, 'main', stance, undefined, undefined, order.units)
            }}>
            {live ? 'Launch army' : 'Launch attack'}
          </button>
        </>
      }
    >
      {/* Keys work anywhere in the room that is not a text box: N none, P probe, M main force, A all in, 1 2 3 the stance. */}
      <div className="space-y-5" onKeyDown={key} data-war-room>
        <OddsGauge forecast={f} rough={rough} exact={cap.exact} />

        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold">Defense Line</h3>
            <span className="text-[14px] tabular-nums text-white/80">
              {lineNow.toFixed(1)} of {lineMaxNow.toFixed(1)}
            </span>
          </div>
          <LineBar now={lineNow} max={lineMaxNow} after={f ? Math.max(0, lineNow - f.lineDamage) : undefined} />
          <p className="text-[13px] text-white/70">Win battles to wear the line down. At zero the country falls. It heals a little every quiet month, so keep the pressure on.</p>
        </section>

        {trip && when && (
          <section className="inset-card p-3.5 space-y-1" aria-label="The march">
            <h3 className="text-[15px] font-semibold">The march</h3>
            <p className="text-[14px] text-white/85">
              Marches {route} from {map.regions[trip.from].name} · {trip.days} day{trip.days === 1 ? '' : 's'} · arrives {absDate(when.arrives)} · home about {absDate(when.homeBy)}.
            </p>
            <p className="text-[13px] text-white/70">
              The army sets out tomorrow and fights when it arrives. Odds are as of today: their army may change by then. Armies sent this month: {sentThisMonth} of {maxAttacks(game, player.id)}.
            </p>
          </section>
        )}

        <DeployPanel player={player} pool={pool} choice={choice} setChoice={setChoice} coastal={coastal} stanceCost={STANCES[stance].cost} live={live} odds={choiceOdds} />
        <TerritoryForces game={game} me={player.id} target={target} stance={stance} picks={terr} setPicks={setTerr} live={live} />
        {!live && away > 0.05 && <p className="text-[13px] text-white/70 -mt-3">Until the turn ends, the part of your army that fights here defends at half strength elsewhere, so rivals can hit you while it is out.</p>}

        <section className="space-y-2">
          <h3 className="text-[15px] font-semibold">How to fight</h3>
          <div className="grid gap-2" role="radiogroup" aria-label="Stance">
            {STANCE_KEYS.map((st, i) => {
              const sf = forecasts?.[st]
              return (
                <button
                  key={st}
                  role="radio"
                  aria-checked={stance === st}
                  aria-keyshortcuts={String(i + 1)}
                  onClick={() => setStance(st)}
                  className={`rounded-xl p-3 text-left border flex items-start justify-between gap-3 ${stance === st ? 'border-[#0a84ff] bg-[#0a84ff]/20' : 'border-white/10 bg-white/6 hover:bg-white/10'}`}
                >
                  <span>
                    <span className="block text-[15px] font-semibold">
                      {STANCES[st].name}
                      {bestStance === st && <span className="ml-2 rounded-full bg-[#30d158]/25 px-2 py-0.5 text-[11px] font-semibold text-[#6eeb8a]">AI recommends</span>}
                    </span>
                    <span className="block text-[13px] text-white/75">{STANCES[st].blurb}</span>
                  </span>
                  {sf && (
                    <span className="text-right text-[13px] tabular-nums whitespace-nowrap">
                      <span className={`block font-semibold ${LABEL_TONE[cap.exact ? sf.label : roughOdds(game, player.id, target, sf.winChance).label]}`}>
                        {cap.exact ? `${sf.label} · ${Math.round(sf.winChance * 100)}%` : roughOdds(game, player.id, target, sf.winChance).label}
                      </span>
                      <span className="block text-white/70">line −{sf.lineDamage.toFixed(1)}</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {/* The War Room never sends missiles, so the line about them would only ever say "none fired". */}
        {f && <Breakdown factors={f.factors.filter((x) => x.id !== 'missiles')} exact={cap.exact} fuzzDefence />}

        {f && (
          <section className="inset-card p-3.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[14px]">
            <span className="text-white/70">You lose (average)</span>
            <span className="text-right tabular-nums">
              {formatDivisions(f.yourLosses)} of {formatDivisions(totalUnits(f.sent))} divisions
            </span>
            <span className="text-white/70">They lose (average)</span>
            <span className="text-right tabular-nums">{formatDivisions(f.theirLosses)} divisions</span>
            <span className="text-white/70">Country falls this attack</span>
            <span className="text-right tabular-nums">{cap.exact ? `${Math.round(f.captureChance * 100)}%` : f.captureChance >= 0.5 ? 'likely' : f.captureChance >= 0.15 ? 'possible' : 'unlikely'}</span>
            {STANCES[stance].cost > 0 && (
              <>
                <span className="text-white/70">Launch cost</span>
                <span className="text-right tabular-nums">{STANCES[stance].cost} money</span>
              </>
            )}
            <span className="text-white/70">This war costs you</span>
            <span className="text-right tabular-nums">{bill.toFixed(1)} money every month</span>
          </section>
        )}

        {level >= 1 ? (
          <details className="details-card" data-command-center>
            <summary>
              AI Battle Command <span className="ml-1 rounded-full bg-[#30d158]/20 px-2 py-0.5 text-[11px] font-semibold text-[#6eeb8a]">Level {level}</span>
              <span className="block text-[12px] font-normal text-white/60">Plan it for me, advice and your best targets</span>
            </summary>
            <div className="pt-3">
          <CommandCenter
            game={game}
            player={player}
            target={target}
            level={level}
            orders={view.orders}
            live={live}
            current={{ choice, stance }}
            forecast={f}
            onApply={(d) => {
              setChoice(d.choice)
              setStance(d.stance)
            }}
          />
            </div>
          </details>
        ) : (
          <section className="inset-card p-3.5 space-y-1" aria-label="AI Battle Command">
            <h3 className="text-[15px] font-semibold">AI Battle Command</h3>
            <p className="text-[13px] text-white/75">You see a rough band, because you cannot see their army well. Fund AI Battle Command (Military, Systems) for the exact odds and range, the best stance, a plan for the whole attack in one click, a ranked list of targets, written advice and an auto-command.</p>
          </section>
        )}

        <details className="details-card">
          <summary>Compare the two militaries</summary>
          <div className="pt-3">
            <MilitaryCompare game={game} mine={player.id} theirs={owner.id} />
          </div>
        </details>

        {/* Missiles are never part of an attack: one link to where they are fired. */}
        <p className="text-[13px] text-white/65" data-missile-link>
          Missile strikes are in{' '}
          <button type="button" className="underline underline-offset-2 text-white/85 hover:text-white" onClick={() => openMissileWar()}>
            Military → Missile War
          </button>
          .
        </p>
      </div>
    </Modal>
  )
}
