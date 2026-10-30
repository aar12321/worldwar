import { MAX_WARS } from '../data/war'
import { computeEconomy } from '../engine/economy'
import { enemiesOf, pairKey } from '../engine/helpers'
import { attackableRegions, canAttackRegion } from '../engine/warfare'
import { lineMax } from '../engine/economy'
import { netWarScore } from '../engine/warscore'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { PanelShell } from './panel'
import { LineBar } from './WarRoom'

/** Every war you are in (up to three): what it costs, how it is going, and where the front is. */
export function WarsPanel() {
  const view = usePlayerView()
  const openWarRoom = useGame((s) => s.openWarRoom)
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const selectRegion = useGame((s) => s.selectRegion)
  const { map } = getWorld()
  if (!view) return null
  const { game, player, econ } = view
  const enemies = enemiesOf(game, player.id).sort()
  const reachable = new Set(attackableRegions(game, map, player.id))
  const slots = Array.from({ length: MAX_WARS }, (_, i) => enemies[i] ?? null)
  const bills = new Map(computeEconomy(game, map, player.id).warBills.map((b) => [b.enemy, b.amount]))

  return (
    <PanelShell title="Wars" kicker={`${enemies.length} of ${MAX_WARS} wars. Each costs money every month and tires your people.`} panel="wars">
      <div className="inset-card p-3.5 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="label">War bills</div>
          <div className="text-[18px] font-semibold tabular-nums">−{econ.warBillTotal.toFixed(0)}</div>
          <div className="text-[12px] text-white/65">per month</div>
        </div>
        <div>
          <div className="label">Weariness</div>
          <div className="text-[18px] font-semibold tabular-nums">{player.warWeariness.toFixed(0)}</div>
          <div className="text-[12px] text-white/65">lowers stability</div>
        </div>
        <div>
          <div className="label">Held land</div>
          <div className="text-[18px] font-semibold tabular-nums">{econ.occupied}</div>
          <div className="text-[12px] text-white/65">still settling</div>
        </div>
      </div>

      {slots.map((enemyId, i) => {
        if (!enemyId) {
          return (
            <div key={i} className="rounded-2xl border border-dashed border-white/20 p-4 text-[14px] text-white/65">
              <span className="label block mb-1">War slot {i + 1}</span>
              Open. Pick a neighbor on the globe and declare war.
            </div>
          )
        }
        const enemy = game.nations[enemyId]
        const months = game.turn - (game.warStarted[pairKey(player.id, enemyId)] ?? game.turn)
        const fronts = Object.values(game.regions).filter((r) => r.owner === enemyId && canAttackRegion(game, map, player.id, r.id).ok)
        return (
          <div key={enemyId} className="inset-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: enemy.color }} />
                  <span className="text-[18px] font-semibold tracking-tight">{enemy.name}</span>
                </div>
                <div className="text-[13px] text-white/70 mt-0.5">
                  {months} {months === 1 ? 'month' : 'months'} · war score {netWarScore(game, player.id, enemyId) > 0 ? '+' : ''}
                  {netWarScore(game, player.id, enemyId)} · costs {(bills.get(enemyId) ?? 0).toFixed(1)}/month
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => openDiplomacy(enemyId)}>
                Make peace
              </button>
            </div>
            {fronts.length === 0 ? (
              <p className="text-[13px] text-white/70">No front yet. You can only attack countries that touch land you hold, or that a port of yours can reach.</p>
            ) : (
              <div className="space-y-2.5">
                {fronts.map((r) => {
                  const max = lineMax(game, map, r.id)
                  return (
                    <div key={r.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[14px]">
                        <button className="font-semibold hover:underline text-left" onClick={() => selectRegion(r.id)}>
                          {map.regions[r.id].name}
                        </button>
                        <span className="tabular-nums text-white/75">
                          line {Math.min(r.line, max).toFixed(1)} / {max.toFixed(1)}
                        </span>
                        <button className="btn btn-red" disabled={!reachable.has(r.id)} onClick={() => openWarRoom(r.id)}>
                          War Room
                        </button>
                      </div>
                      <LineBar now={Math.min(r.line, max)} max={max} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </PanelShell>
  )
}
