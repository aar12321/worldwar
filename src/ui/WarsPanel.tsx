import { EmptyState, Term } from './widgets'
import { StatTile, Tiles } from './kit'
import { useMemo, useState } from 'react'
import { computeEconomy } from '../engine/economy'
import { enemiesOf, maxWars, pairKey } from '../engine/helpers'
import type { NationId } from '../engine/types'
import { commandLevel } from '../engine/commander'
import { forecastMemo, roughOdds } from '../engine/forecast'
import { attackableRegions, canAttackRegion } from '../engine/warfare'
import { lineMax } from '../engine/economy'
import { netWarScore } from '../engine/warscore'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { LineBar } from './WarRoom'
import { WarPicture } from './WarPicture'

/** Every war you are in: what it costs, how it is going, and where the front is. The one home for a war's detail. */
export function WarsTab() {
  const view = usePlayerView()
  const { map } = getWorld()
  const viewGame = view?.game
  const viewPlayer = view?.player.id
  // One set per game state, so the odds on each front are only worked out when something changes.
  const reachable = useMemo(() => (viewGame && viewPlayer ? new Set<string>(attackableRegions(viewGame, map, viewPlayer)) : new Set<string>()), [viewGame, map, viewPlayer])
  if (!view) return null
  const { game, player, econ } = view
  const enemies = enemiesOf(game, player.id).sort()
  const limit = maxWars(game, player.id)
  const open = Math.max(0, limit - enemies.length)
  const bills = new Map(computeEconomy(game, map, player.id).warBills.map((b) => [b.enemy, b.amount]))

  return (
    <div className="space-y-4 max-w-3xl">
      <Tiles>
        <StatTile label="Wars" value={`${enemies.length} of ${limit}`} sub={open > 0 ? `${open} more possible` : 'at the limit'} tone={enemies.length >= limit ? 'warn' : undefined} />
        <StatTile label="War bills" value={`−${econ.warBillTotal.toFixed(0)}`} sub="money a month" tone={econ.warBillTotal > 0 ? 'bad' : undefined} />
        <StatTile label="Weariness" value={player.warWeariness.toFixed(0)} sub="lowers stability" tone={player.warWeariness > 15 ? 'warn' : undefined} />
        <StatTile label="Held land" value={econ.occupied} sub="still settling" />
      </Tiles>
      <p className="text-[13px] text-white/70">
        Each war costs money every month and tires your people. Win battles to push a country's <Term word="Defense Line">Defense Line</Term> to zero and it is yours. Fronts are listed most winnable first.
      </p>
      {enemies.length === 0 && (
        <EmptyState
          title="You are at peace"
          body={`You can fight up to ${limit} wars at once. Click a neighbor on the globe and press Declare war, or build a case against them first in Diplomacy.`}
        />
      )}
      {enemies.map((enemyId) => (
        <EnemyCard key={enemyId} enemyId={enemyId} reachable={reachable} bill={bills.get(enemyId) ?? 0} />
      ))}
    </div>
  )
}

const TONE = { Likely: 'text-[#6eeb8a]', Even: 'text-[#ffd60a]', Unlikely: 'text-[#ff8a84]' }
const FIRST_FRONTS = 5

/** One war: the score, and its fronts with the weakest, most winnable country first. */
function EnemyCard({ enemyId, reachable, bill }: { enemyId: NationId; reachable: Set<string>; bill: number }) {
  const view = usePlayerView()
  const openWarRoom = useGame((s) => s.openWarRoom)
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const selectRegion = useGame((s) => s.selectRegion)
  const [all, setAll] = useState(false)
  const { map } = getWorld()
  const game = view?.game
  const playerId = view?.player.id
  const exact = !!game && !!playerId && commandLevel(game, playerId) >= 1
  const rows = useMemo(() => {
    if (!game || !playerId) return []
    return Object.values(game.regions)
      .filter((r) => r.owner === enemyId && canAttackRegion(game, map, playerId, r.id).ok)
      .map((r) => {
        const max = lineMax(game, map, r.id)
        // An even-handed look: a main-force assault, a few plays, so the list stays quick.
        const f = reachable.has(r.id) ? forecastMemo(game, map, playerId, { target: r.id, stance: 'assault', commit: 'main' }, 128) : null
        // Without AI Battle Command the number is a rough band: a label and a rounded guess, never the exact chance.
        const odds = f ? (exact ? { label: f.label, text: `${Math.round(f.winChance * 100)}%`, win: f.winChance } : (() => { const q = roughOdds(game, playerId, r.id, f.winChance); return { label: q.label, text: q.text.replace('about ', '~'), win: f.winChance } })()) : null
        return { id: r.id, line: Math.min(r.line, max), max, odds }
      })
      .sort((a, b) => (b.odds?.win ?? -1) - (a.odds?.win ?? -1) || a.line - b.line || (a.id < b.id ? -1 : 1))
  }, [game, map, enemyId, playerId, reachable, exact])
  if (!game || !playerId) return null
  const enemy = game.nations[enemyId]
  const months = game.turn - (game.warStarted[pairKey(playerId, enemyId)] ?? game.turn)
  const shown = all ? rows : rows.slice(0, FIRST_FRONTS)
  const score = netWarScore(game, playerId, enemyId)
  return (
    <div className="inset-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: enemy.color }} />
            <span className="text-[18px] font-semibold tracking-tight">{enemy.name}</span>
          </div>
          <div className="text-[13px] text-white/70 mt-0.5">
            {months} {months === 1 ? 'month' : 'months'} · war score {score > 0 ? '+' : ''}
            {score} · costs {bill.toFixed(1)} money a month
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => openDiplomacy(enemyId, { peace: true })}>
          Make peace
        </button>
      </div>
      <WarPicture enemyId={enemyId} />
      {rows.length === 0 ? (
        <p className="text-[13px] text-white/70">No front yet. You can only attack countries that touch land you hold, or that a port of yours can reach.</p>
      ) : (
        <div className="space-y-2.5">
          {shown.map((r, i) => (
            <div key={r.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[14px]">
                <button className="font-semibold hover:underline text-left min-w-0 truncate" onClick={() => selectRegion(r.id)}>
                  {map.regions[r.id].name}
                  {i === 0 && r.odds && r.odds.win >= 0.5 && <span className="ml-1.5 text-[11px] font-semibold text-[#6eeb8a]">best target</span>}
                </button>
                <span className="tabular-nums text-white/75 whitespace-nowrap">
                  line {r.line.toFixed(1)} / {r.max.toFixed(1)}
                </span>
                {r.odds && (
                  <span className={`tabular-nums whitespace-nowrap text-[13px] font-semibold ${TONE[r.odds.label]}`} title="With your main force, in a full assault">
                    {r.odds.label} {r.odds.text}
                  </span>
                )}
                <button className="btn btn-red" disabled={!reachable.has(r.id)} onClick={() => openWarRoom(r.id)}>
                  Plan an attack
                </button>
              </div>
              <LineBar now={r.line} max={r.max} />
            </div>
          ))}
          {rows.length > FIRST_FRONTS && (
            <button className="btn w-full" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${rows.length} fronts`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
