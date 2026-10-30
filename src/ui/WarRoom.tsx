import { useMemo, useState } from 'react'
import { TERRAIN } from '../data/terrain'
import { COMMITS, STANCES, type Commit, type Stance } from '../data/war'
import { computeEconomy } from '../engine/economy'
import { formatDivisions, totalUnits } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import { forecastAttack } from '../engine/warfare'
import type { GameState, NationId, RegionId } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
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
  const view = usePlayerView()
  const [commit, setCommit] = useState<Commit>(() => (view ? suggestedCommit(view.game, view.player.id, target) : 'main'))
  const [stance, setStance] = useState<Stance>('assault')
  const { map } = getWorld()
  const game = view?.game
  const player = view?.player
  const forecasts = useMemo(() => {
    if (!game || !player) return null
    return Object.fromEntries(STANCE_KEYS.map((st) => [st, forecastAttack(game, map, player.id, target, commit, st)])) as Record<Stance, ReturnType<typeof forecastAttack>>
  }, [game, player, target, commit, map])
  if (!view || !game || !player || !game.regions[target]) return null

  const region = game.regions[target]
  const mr = map.regions[target]
  const owner = game.nations[region.owner]
  const order = { type: 'attack' as const, nationId: player.id, target, commit, stance }
  const err = validateOrder(game, map, order, view.orders)
  const f = forecasts?.[stance] ?? null
  const bill = computeEconomy(game, map, player.id).warBills.find((b) => b.enemy === owner.id)?.amount ?? 0
  const sent = totalUnits(player.military.units) * (f?.share ?? COMMITS[commit].share)
  const away = Math.min(1, player.military.exposed + (f?.share ?? COMMITS[commit].share))
  const lineNow = f?.lineBefore ?? region.line
  const lineMaxNow = f?.lineMax ?? lineNow

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
          <button className="btn btn-red px-5" data-autofocus disabled={!!err} onClick={() => attack(target, commit, stance)}>
            Launch attack
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
                </button>
              )
            })}
          </div>
          <p className="text-[13px] text-white/70">
            {COMMITS[commit].blurb} {away > 0 ? `Until the turn ends, your army at home fights at ${Math.round((1 - away * 0.5) * 100)}% strength, so rivals can hit you while it is away.` : ''}
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
                    <span className="block text-[15px] font-semibold">{STANCES[st].name}</span>
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

        {f && (
          <section className="inset-card p-3.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[14px]">
            <span className="text-white/70">Chance to win</span>
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
