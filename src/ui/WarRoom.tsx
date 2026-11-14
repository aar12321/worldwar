import { useMemo, useState } from 'react'
import { TERRAIN } from '../data/terrain'
import { COMMITS, STANCES, type Commit, type Stance } from '../data/war'
import { planTrip, tripSchedule } from '../engine/armies'
import { absDate, clockOf, isLive } from '../engine/calendar'
import { computeEconomy } from '../engine/economy'
import { formatDivisions, maxAttacks, totalUnits } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import { forecastAttack } from '../engine/warfare'
import type { GameState, NationId, RegionId } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { FRONTIER } from '../data/systems'
import { missilesLeft } from '../engine/systems'
import { usePlayerView } from './hooks'
import { OrderButton } from './panel'
import { UnitIcon } from './icons'
import { MilitaryCompare } from './MilitaryCompare'
import { Modal } from './Modal'
import { speak } from './plain'

const COMMIT_KEYS = Object.keys(COMMITS) as Commit[]
const STANCE_KEYS = Object.keys(STANCES) as Stance[]
const LABEL_TONE = { Likely: 'text-[#6eeb8a]', Even: 'text-[#ffd60a]', Risky: 'text-[#ff8a84]' }

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

const score = (f: ReturnType<typeof forecastAttack>) => (f ? f.winChance * (f.lineDamage + 1) - f.yourLosses * 0.15 : -99)

/** The smallest force that is likely to win, so the screen opens on a sensible plan. */
function suggestedCommit(game: GameState, nationId: NationId, target: RegionId): Commit {
  const { map } = getWorld()
  for (const c of COMMIT_KEYS) {
    const f = forecastAttack(game, map, nationId, target, c, 'assault', 8)
    if (f && f.winChance >= 0.75) return c
  }
  return 'allin'
}

/** Plan one attack: how much to send, how to fight, and what it will probably do. */
function WarRoomDialog({ target }: { target: RegionId }) {
  const attack = useGame((s) => s.attack)
  const open = useGame((s) => s.openWarRoom)
  // Read the date from the game itself: the view the rest of this screen reads can be a few quiet days behind.
  const today = useGame((s) => (s.game ? clockOf(s.game) : 0))
  const view = usePlayerView()
  const [commit, setCommit] = useState<Commit>(() => (view ? suggestedCommit(view.game, view.player.id, target) : 'main'))
  const [stance, setStance] = useState<Stance>('assault')
  // null means the default: the share of the missiles that goes with the force sent.
  const [fire, setFire] = useState<number | null>(null)
  const [salvo, setSalvo] = useState(1)
  const { map } = getWorld()
  const game = view?.game
  const player = view?.player
  const free = game && player ? missilesLeft(player.military.units.missile, view?.orders ?? [], player.id) : 0
  const missiles = free > 0 ? Math.min(free, fire ?? Math.min(free, Math.ceil(free * COMMITS[commit].share))) : undefined
  const forecasts = useMemo(() => {
    if (!game || !player) return null
    return Object.fromEntries(STANCE_KEYS.map((st) => [st, forecastAttack(game, map, player.id, target, commit, st, undefined, missiles)])) as Record<Stance, ReturnType<typeof forecastAttack>>
  }, [game, player, target, commit, map, missiles])
  if (!view || !game || !player || !game.regions[target]) return null

  const region = game.regions[target]
  const mr = map.regions[target]
  const owner = game.nations[region.owner]
  const order = { type: 'attack' as const, nationId: player.id, target, commit, stance, missiles }
  const err = validateOrder(game, map, order, view.orders)
  const f = forecasts?.[stance] ?? null
  const aiLevel = player.systems?.ai ?? 0
  // AI Battle Command recommends the stance with the best mix of line damage, odds and losses.
  const bestStance = aiLevel >= 2 && forecasts ? STANCE_KEYS.reduce((best, st) => (score(forecasts[st]) > score(forecasts[best]) ? st : best), STANCE_KEYS[0]) : null
  // Missiles the attack itself will fire are not free for a strike.
  const strikeMax = Math.max(0, free - (missiles ?? 0))
  const salvoSize = Math.max(1, Math.min(salvo, Math.max(1, strikeMax)))
  const strikeOrders = [
    { type: 'strike' as const, nationId: player.id, target, weapon: 'missile' as const, count: salvoSize },
    { type: 'strike' as const, nationId: player.id, target, weapon: 'orbital' as const },
  ]
  const hasStrikeWeapons = player.military.units.missile >= 1 || (player.systems?.orbital ?? 0) > 0
  const bill = computeEconomy(game, map, player.id).warBills.find((b) => b.enemy === owner.id)?.amount ?? 0
  const sent = totalUnits(player.military.units) * (f?.share ?? COMMITS[commit].share)
  const away = Math.min(1, player.military.exposed + (f?.share ?? COMMITS[commit].share))
  const lineNow = f?.lineBefore ?? region.line
  const lineMaxNow = f?.lineMax ?? lineNow
  const live = isLive(game)
  const trip = live ? planTrip(game, map, player.id, target) : null
  const when = trip ? tripSchedule(trip, today) : null
  const share = f?.share ?? COMMITS[commit].share
  const sentAway = totalUnits(player.military.units) * share
  const stayHome = totalUnits(player.military.units) - sentAway
  const sentThisMonth = player.military.lastAttackTurn === game.turn ? player.military.attacksThisTurn : 0
  const route = trip ? (trip.via === 'land' ? 'by land' : trip.via === 'lane' ? 'across the sea' : trip.via === 'fleet' ? 'by sea' : 'by air') : ''

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
          {err && <span className="text-[13px] text-white/80 max-w-[260px] text-right">{speak(err)}</span>}
          <button className="btn btn-red px-5" data-autofocus disabled={!!err} onClick={() => attack(target, commit, stance, missiles)}>
            {live ? 'Launch army' : 'Launch attack'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
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

        <MilitaryCompare game={game} mine={player.id} theirs={owner.id} />

        <section className="space-y-2">
          <h3 className="text-[15px] font-semibold">How much to send</h3>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Force size">
            {COMMIT_KEYS.map((c) => {
              const share = Math.min(COMMITS[c].share, 1 - player.military.exposed)
              return (
                <button
                  key={c}
                  role="radio"
                  aria-checked={commit === c}
                  onClick={() => setCommit(c)}
                  className={`rounded-xl p-2.5 text-left border ${commit === c ? 'border-[#0a84ff] bg-[#0a84ff]/20' : 'border-white/10 bg-white/6 hover:bg-white/10'}`}
                >
                  <div className="text-[14px] font-semibold">{COMMITS[c].name}</div>
                  <div className="text-[12px] text-white/75 tabular-nums">{formatDivisions(totalUnits(player.military.units) * share)} divisions</div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[12px] text-white/80 tabular-nums">
                    {UNIT_TYPES.filter((u) => player.military.units[u] * share >= 0.05).map((u) => (
                      <span key={u} className="inline-flex items-center gap-1">
                        <UnitIcon unit={u} size={13} />
                        {formatDivisions(player.military.units[u] * share)}
                      </span>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="text-[13px] text-white/70">
            {COMMITS[commit].blurb}{' '}
            {live
              ? `${formatDivisions(sentAway)} divisions leave and ${formatDivisions(stayHome)} stay home to defend. The army is gone until it is back.`
              : away > 0
                ? `Until the turn ends, your army at home fights at ${Math.round((1 - away * 0.5) * 100)}% strength, so rivals can hit you while it is away.`
                : ''}
          </p>
        </section>

        {free > 0 && (
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[15px] font-semibold">Missiles to fire</h3>
              <span className="text-[14px] tabular-nums text-white/80">
                {missiles ?? 0} of {free}
              </span>
            </div>
            <input type="range" className="w-full" min={0} max={free} step={1} value={missiles ?? 0} onChange={(e) => setFire(+e.target.value)} aria-label="Missiles to fire in this battle" />
            <p className="text-[13px] text-white/70">They strike first, before the air war, and crack the Defense Line directly. Each one fired is used up. A shield stops part of them.</p>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-[15px] font-semibold">How to fight</h3>
          <div className="grid gap-2" role="radiogroup" aria-label="Stance">
            {STANCE_KEYS.map((st) => {
              const sf = forecasts?.[st]
              return (
                <button
                  key={st}
                  role="radio"
                  aria-checked={stance === st}
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
                      <span className={`block font-semibold ${LABEL_TONE[sf.label]}`}>
                        {sf.label} · {Math.round(sf.winChance * 100)}%
                      </span>
                      <span className="block text-white/70">line −{sf.lineDamage.toFixed(1)}</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {hasStrikeWeapons && (
          <section className="space-y-2">
            <h3 className="text-[15px] font-semibold">Strike from afar</h3>
            <p className="text-[13px] text-white/70">{live ? 'Weapons that need no army. Missiles leave at once and land a day later; an orbital strike hits at once. An Interceptor Shield stops part of them.' : 'Weapons that need no army. They resolve when the month ends, and an Interceptor Shield stops part of them.'}</p>
            {player.military.units.missile >= 1 && (
              <div className="space-y-1">
                <div className="flex items-baseline justify-between text-[14px]">
                  <span>Missiles in this strike</span>
                  <span className="tabular-nums text-white/80">
                    {Math.min(salvoSize, Math.max(1, strikeMax))} of {strikeMax} free this month
                  </span>
                </div>
                <input type="range" className="w-full" min={1} max={Math.max(1, strikeMax)} step={1} value={Math.min(salvoSize, Math.max(1, strikeMax))} onChange={(e) => setSalvo(+e.target.value)} aria-label="Missiles in this strike" />
                <p className="text-[12px] text-white/65">You can fire as many strikes {live ? '' : 'a month '}as you have missiles. Each missile fired is used up.</p>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {player.military.units.missile >= 1 && <OrderButton order={strikeOrders[0]} label={`Fire ${salvoSize} missile${salvoSize === 1 ? '' : 's'}`} cost={`${FRONTIER.strikeMoney} money`} effect="Cuts the Defense Line and stops factories for 2 months." />}
              {(player.systems?.orbital ?? 0) > 0 && <OrderButton order={strikeOrders[1]} label="Orbital strike" cost={`${FRONTIER.orbitalMoney} money, ${FRONTIER.orbitalPP} influence`} effect="Once a year. Cuts the line hard, wrecks a building, and shames you." />}
            </div>
          </section>
        )}

        {f && (
          <section className="inset-card p-3.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[14px]">
            <span className="text-white/70">Chance to win{f.exact ? ' (exact)' : ''}</span>
            <span className={`text-right font-semibold ${LABEL_TONE[f.label]}`}>{f.label} ({Math.round(f.winChance * 100)}%)</span>
            <span className="text-white/70">Country falls this attack</span>
            <span className="text-right tabular-nums">{Math.round(f.captureChance * 100)}%</span>
            <span className="text-white/70">You lose (average)</span>
            <span className="text-right tabular-nums">{formatDivisions(f.yourLosses)} of {formatDivisions(sent)} divisions</span>
            <span className="text-white/70">They lose (average)</span>
            <span className="text-right tabular-nums">{formatDivisions(f.theirLosses)} divisions</span>
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
      </div>
    </Modal>
  )
}
