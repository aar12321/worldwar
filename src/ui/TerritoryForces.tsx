import { useMemo } from 'react'
import { STANCES, type Stance } from '../data/war'
import { totalUnits } from '../engine/helpers'
import { attackPool } from '../engine/deploy'
import { labelFor } from '../engine/forecast'
import { validateOrder } from '../engine/orders'
import type { GameState, NationId, RegionId } from '../engine/types'
import { getWorld } from '../map/world'
import { choiceForecast, choiceUnits, type Choice } from './attackChoices'
import { DeployPanel } from './DeployPanel'
import { sendingTerritories, territoryAttack, useTerritoryPrefs } from './territoryPrefs'

/**
 * "Send territory forces": for each territory that could join the attack, a switch (the same one the Territories desk has) and, when it is on,
 * how much of it goes (the same four choices as your own force), with the odds of its own army's attack alone. Each is its own army and its own attack: your own force and
 * the forecast above are unchanged, and a territory's capture is the territory's.
 */
export function TerritoryForces({ game, me, target, stance, picks, setPicks, live }: { game: GameState; me: NationId; target: RegionId; stance: Stance; picks: Record<NationId, Choice>; setPicks: (p: Record<NationId, Choice>) => void; live: boolean }) {
  const send = useTerritoryPrefs((s) => s.send)
  const setSend = useTerritoryPrefs((s) => s.setSend)
  const ids = sendingTerritories(game, me, target)
  if (ids.length === 0) return null
  return (
    <section className="space-y-3" aria-label="Territory forces">
      <h3 className="text-[15px] font-semibold">Send territory forces</h3>
      {ids.map((id) => (
        <TerritoryRow key={id} game={game} id={id} target={target} stance={stance} on={!!send[id]} setOn={(v) => setSend(id, v)} choice={picks[id] ?? 'main'} setChoice={(c) => setPicks({ ...picks, [id]: c })} live={live} />
      ))}
    </section>
  )
}

function TerritoryRow({ game, id, target, stance, on, setOn, choice, setChoice, live }: { game: GameState; id: NationId; target: RegionId; stance: Stance; on: boolean; setOn: (v: boolean) => void; choice: Choice; setChoice: (c: Choice) => void; live: boolean }) {
  const { map } = getWorld()
  const t = game.nations[id]
  const coastal = map.regions[target].coastal
  const pool = useMemo(() => attackPool(game, id, [], live), [game, id, live])
  const mine = choiceUnits(pool, choice, coastal)
  const forecast = (c: Choice) => (on ? choiceForecast(game, map, id, target, stance, pool, c, coastal, 64) : null)
  const f = totalUnits(mine) > 0.05 ? forecast(choice) : null
  const err = on && totalUnits(mine) > 0.05 ? validateOrder(game, map, territoryAttack(game.playerId, id, target, stance, mine)) : null
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
          <DeployPanel
            player={t}
            pool={pool}
            choice={choice}
            setChoice={setChoice}
            coastal={coastal}
            stanceCost={0}
            live={live}
            title={`${t.name}'s force`}
            odds={(c) => {
              const g = forecast(c)
              if (!g) return null
              const label = labelFor(g.winChance)
              return { text: `${Math.round(g.winChance * 100)}%`, tone: label === 'Likely' ? 'good' : label === 'Even' ? 'even' : 'bad', losses: g.yourLosses }
            }}
          />
          <p className="text-[13px] text-white/75" aria-live="polite">
            {err ? `Cannot go: ${err}` : f ? `On its own it has ${Math.round(f.winChance * 100)}% to win and would lose about ${Math.round(f.yourLosses)}.` : 'It sends nothing.'} It fights first, from its own army and at its own cost.
          </p>
        </>
      )}
    </div>
  )
}
