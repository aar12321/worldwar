import { useMemo, useState } from 'react'
import { TERRAIN } from '../data/terrain'
import { COMMITS, STANCES, type Commit, type Stance } from '../data/war'
import { planTrip, tripSchedule } from '../engine/armies'
import { absDate, clockOf, isLive } from '../engine/calendar'
import { computeEconomy } from '../engine/economy'
import { freeUnits } from '../engine/deployment'
import { formatDivisions, maxAttacks, totalUnits } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import { forecastAttack } from '../engine/warfare'
import type { GameState, NationId, RegionId } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { UnitIcon } from './icons'
import { MilitaryCompare } from './MilitaryCompare'
import { MissileSection } from './MissileSection'
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
  // A chosen share of the military, in percent. null means one of the three presets.
  const [custom, setCustom] = useState<number | null>(null)
  const customShare = custom === null ? undefined : custom / 100
  const { map } = getWorld()
  const game = view?.game
  const player = view?.player
  // An attack on land never carries missiles by itself. They are fired on purpose, from the Missiles section below.
  const missiles = 0
  const forecasts = useMemo(() => {
    if (!game || !player) return null
    return Object.fromEntries(STANCE_KEYS.map((st) => [st, forecastAttack(game, map, player.id, target, commit, st, undefined, missiles, customShare)])) as Record<Stance, ReturnType<typeof forecastAttack>>
  }, [game, player, target, commit, map, missiles, customShare])
  // AI Battle Command level 3 also recommends how much to send: the smallest force that wins with good odds, or all in if that is the best hope.
  const aiLevelNow = player?.systems?.ai ?? 0
  const bestCommit = useMemo<Commit | null>(() => {
    if (!game || !player || aiLevelNow < 3) return null
    const odds = COMMIT_KEYS.map((c) => ({ c, f: forecastAttack(game, map, player.id, target, c, 'assault', undefined, undefined) })).filter((x) => x.f)
    const good = odds.find((x) => x.f!.winChance >= 0.75)
    if (good) return good.c
    const best = odds.reduce<(typeof odds)[number] | null>((b, x) => (!b || x.f!.winChance > b.f!.winChance ? x : b), null)
    return best && best.f!.winChance >= 0.4 ? best.c : null
  }, [game, player, aiLevelNow, target, map])
  if (!view || !game || !player || !game.regions[target]) return null

  const region = game.regions[target]
  const mr = map.regions[target]
  const owner = game.nations[region.owner]
  const order = { type: 'attack' as const, nationId: player.id, target, commit, stance, missiles, ...(customShare !== undefined ? { share: customShare } : {}) }
  const err = validateOrder(game, map, order, view.orders)
  const f = forecasts?.[stance] ?? null
  const aiLevel = player.systems?.ai ?? 0
  // AI Battle Command recommends the stance with the best mix of line damage, odds and losses.
  const bestStance = aiLevel >= 2 && forecasts ? STANCE_KEYS.reduce((best, st) => (score(forecasts[st]) > score(forecasts[best]) ? st : best), STANCE_KEYS[0]) : null
  const bill = computeEconomy(game, map, player.id).warBills.find((b) => b.enemy === owner.id)?.amount ?? 0
  const nominal = customShare ?? COMMITS[commit].share
  // Only the reserve can be sent: forces on station keep their posts.
  const reserve = freeUnits(game, player.id)
  const onStation = !!player.military.deployment
  const sent = totalUnits(reserve) * (f?.share ?? nominal)
  const away = Math.min(1, player.military.exposed + (f?.share ?? nominal))
  const lineNow = f?.lineBefore ?? region.line
  const lineMaxNow = f?.lineMax ?? lineNow
  const live = isLive(game)
  const trip = live ? planTrip(game, map, player.id, target) : null
  const when = trip ? tripSchedule(trip, today) : null
  const share = f?.share ?? nominal
  const sentAway = totalUnits(reserve) * share
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
          {f && !err && (
            <span className="text-[13px] text-white/80 tabular-nums mr-1 hidden sm:inline" aria-live="polite">
              {f.label} · {Math.round(f.winChance * 100)}% to win · lose about {f.yourLosses.toFixed(1)}
            </span>
          )}
          {err && <span className="text-[13px] text-white/80 max-w-[260px] text-right">{speak(err)}</span>}
          <button className="btn btn-red px-5" data-autofocus disabled={!!err} onClick={() => attack(target, commit, stance, missiles, customShare)}>
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
          {onStation && (
            <p className="text-[12px] text-white/70">
              Shares are of your reserve, {formatDivisions(totalUnits(reserve))} divisions. {formatDivisions(totalUnits(player.military.units) - totalUnits(reserve))} stay on station: patrols, screens and garrisons cannot attack.
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Force size">
            {COMMIT_KEYS.map((c) => {
              const share = Math.min(COMMITS[c].share, 1 - player.military.exposed)
              return (
                <button
                  key={c}
                  role="radio"
                  aria-checked={commit === c && custom === null}
                  onClick={() => {
                    setCommit(c)
                    setCustom(null)
                  }}
                  className={`rounded-xl p-2.5 text-left border ${commit === c && custom === null ? 'border-[#0a84ff] bg-[#0a84ff]/20' : 'border-white/10 bg-white/6 hover:bg-white/10'}`}
                >
                  <div className="text-[14px] font-semibold">
                    {COMMITS[c].name}
                    {bestCommit === c && <span className="ml-1.5 rounded-full bg-[#30d158]/25 px-1.5 py-0.5 text-[10px] font-semibold text-[#6eeb8a]">AI recommends</span>}
                  </div>
                  <div className="text-[12px] text-white/75 tabular-nums">{formatDivisions(totalUnits(reserve) * share)} divisions</div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[12px] text-white/80 tabular-nums">
                    {UNIT_TYPES.filter((u) => reserve[u] * share >= 0.05).map((u) => (
                      <span key={u} className="inline-flex items-center gap-1">
                        <UnitIcon unit={u} size={13} />
                        {formatDivisions(reserve[u] * share)}
                      </span>
                    ))}
                  </div>
                </button>
              )
            })}
            <button
              role="radio"
              aria-checked={custom !== null}
              onClick={() => setCustom((c) => c ?? Math.max(5, Math.min(100, Math.round(COMMITS[commit].share * 20) * 5)))}
              className={`rounded-xl p-2.5 text-left border ${custom !== null ? 'border-[#0a84ff] bg-[#0a84ff]/20' : 'border-white/10 bg-white/6 hover:bg-white/10'}`}
            >
              <div className="text-[14px] font-semibold">Choose</div>
              <div className="text-[12px] text-white/75 tabular-nums">{custom !== null ? `${formatDivisions(totalUnits(reserve) * Math.min(custom / 100, 1 - player.military.exposed))} divisions` : 'Any amount'}</div>
              <div className="mt-1 text-[12px] text-white/80">{custom !== null ? `${custom}% of your ${onStation ? 'reserve' : 'military'}` : 'Pick a share yourself'}</div>
            </button>
          </div>
          {custom !== null && (
            <div className="rounded-xl bg-white/5 px-3 py-2">
              <input
                type="range"
                className="w-full"
                min={5}
                max={100}
                step={5}
                value={custom}
                onChange={(e) => setCustom(+e.target.value)}
                aria-label="Share of your military to send"
                aria-valuetext={`${custom} percent`}
              />
              <div className="flex justify-between text-[12px] text-white/65">
                <span>5%</span>
                <span>100%</span>
              </div>
            </div>
          )}
          <p className="text-[13px] text-white/70">
            {custom !== null ? 'A force of your own choosing. Send little to keep home strong, or more to be sure of the win.' : COMMITS[commit].blurb}{' '}
            {live
              ? `${formatDivisions(sentAway)} divisions leave and ${formatDivisions(stayHome)} stay home to defend. The army is gone until it is back.`
              : away > 0
                ? `Until the turn ends, your army at home fights at ${Math.round((1 - away * 0.5) * 100)}% strength, so rivals can hit you while it is away.`
                : ''}
          </p>
        </section>

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

        <MissileSection game={game} player={player} target={target} orders={view.orders} live={live} />

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
