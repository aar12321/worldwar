import { useMemo } from 'react'
import { STANCES, type Stance } from '../data/war'
import { totalUnits } from '../engine/helpers'
import { attackPool, compactUnits } from '../engine/deploy'
import { forecastMemo } from '../engine/forecast'
import { validateOrder } from '../engine/orders'
import type { GameState, NationId, RegionId, UnitCounts } from '../engine/types'
import { getWorld } from '../map/world'
import { DeployPanel } from './DeployPanel'
import { defaultPick, sendingTerritories, territoryAttack, useTerritoryPrefs } from './territoryPrefs'

/**
 * "Send territory forces": for each territory that could join the attack, a switch (the same one the Territories desk has) and, when it is on,
 * exactly which of its divisions go, with the odds of its own army's attack alone. Each is its own army and its own attack: your own force and
 * the forecast above are unchanged, and a territory's capture is the territory's.
 */
export function TerritoryForces({ game, me, target, stance, picks, setPicks, live }: { game: GameState; me: NationId; target: RegionId; stance: Stance; picks: Record<NationId, UnitCounts>; setPicks: (p: Record<NationId, UnitCounts>) => void; live: boolean }) {
  const send = useTerritoryPrefs((s) => s.send)
  const setSend = useTerritoryPrefs((s) => s.setSend)
  const ids = sendingTerritories(game, me, target)
  if (ids.length === 0) return null
  return (
    <section className="space-y-3" aria-label="Territory forces">
      <h3 className="text-[15px] font-semibold">Send territory forces</h3>
      {ids.map((id) => (
        <TerritoryRow key={id} game={game} id={id} target={target} stance={stance} on={!!send[id]} setOn={(v) => setSend(id, v)} units={picks[id]} setUnits={(u) => setPicks({ ...picks, [id]: u })} live={live} />
      ))}
    </section>
  )
}

function TerritoryRow({ game, id, target, stance, on, setOn, units, setUnits, live }: { game: GameState; id: NationId; target: RegionId; stance: Stance; on: boolean; setOn: (v: boolean) => void; units: UnitCounts | undefined; setUnits: (u: UnitCounts) => void; live: boolean }) {
  const { map } = getWorld()
  const t = game.nations[id]
  const pool = useMemo(() => attackPool(game, id, [], live), [game, id, live])
  const mine = units ?? defaultPick(pool)
  const f = on && totalUnits(mine) > 0.05 ? forecastMemo(game, map, id, { target, stance, units: compactUnits(mine) }, 64) : null
  const err = on ? validateOrder(game, map, territoryAttack(game.playerId, id, target, stance, mine)) : null
  return (
    <div className="inset-card p-3 space-y-2" data-territory={id}>
      <label className="flex items-center gap-2 text-[14px] font-medium">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} aria-label={`Send ${t.name}'s forces`} />
        <span>
          Send {t.name}'s forces <span className="text-white/60 font-normal">· {STANCES[stance].name}</span>
        </span>
      </label>
      {on && (
        <>
          <DeployPanel game={game} player={t} pool={pool} units={mine} setUnits={setUnits} missiles={0} setMissiles={() => {}} missileMax={0} coastal={map.regions[target].coastal} stanceCost={0} live={live} title={`${t.name}'s force`} />
          <p className="text-[13px] text-white/75" aria-live="polite">
            {err ? `Cannot go: ${err}` : f ? `On its own it has ${Math.round(f.winChance * 100)}% to win and would lose about ${Math.round(f.yourLosses)}.` : 'Choose some divisions to send.'} It fights first, from its own army and at its own cost.
          </p>
        </>
      )}
    </div>
  )
}
