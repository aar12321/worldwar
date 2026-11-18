import { useState } from 'react'
import { MISSILES } from '../data/missiles'
import { FRONTIER } from '../data/systems'
import { AIMS } from '../data/missileWar'
import { strikeForecast } from '../engine/missileForecast'
import { launchSite, missileKinds, missileStock, missilesFree } from '../engine/missiles'
import { strikeCost } from '../engine/systems'
import type { GameState, MissileType, Nation, Order, RegionId, StrikeAim } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { OrderButton } from './panel'
import { MISSILE_SWATCH, clampCount, effectText, flightText, missileName, shieldNote } from './missileText'

/**
 * A whole number between 1 and `max`, with a stepper either side. The box can be emptied while typing; it settles on a valid
 * count when you leave it. Used for how many missiles to fire and how many to build.
 */
export function CountPicker({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = clampCount(value, max)
  const step = (by: number) => {
    setDraft(null)
    onChange(clampCount(shown + by, max))
  }
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="btn px-2.5 py-1.5 text-[16px] leading-none min-w-[34px]" aria-label="One fewer" disabled={max < 1 || shown <= 1} onClick={() => step(-1)}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={Math.max(1, max)}
        step={1}
        disabled={max < 1}
        className="field w-16 px-2 py-1.5 text-[15px] text-center tabular-nums"
        value={draft ?? shown}
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value)
          if (e.target.value !== '' && Number.isFinite(+e.target.value)) onChange(clampCount(+e.target.value, max))
        }}
        onBlur={() => setDraft(null)}
      />
      <button type="button" className="btn px-2.5 py-1.5 text-[16px] leading-none min-w-[34px]" aria-label="One more" disabled={max < 1 || shown >= max} onClick={() => step(1)}>
        +
      </button>
    </div>
  )
}

function KindRow({ game, player, target, orders, live, kind }: { game: GameState; player: Nation; target: RegionId; orders: Order[]; live: boolean; kind: MissileType }) {
  const { map } = getWorld()
  const openMilitary = useGame((s) => s.openMilitary)
  const [count, setCount] = useState(3)
  const [aim, setAim] = useState<StrikeAim>('country')
  const spec = MISSILES[kind]
  const stock = missileStock(player, kind)
  const free = missilesFree(player, kind, orders)
  const n = clampCount(count, free)
  const victim = game.nations[game.regions[target].owner]
  const shield = shieldNote(victim.systems?.shield ?? 0, kind)
  const site = launchSite(game, map, player.id, target, kind)
  const canSite = game.regions[target].buildings.factory > 0
  const useAim: StrikeAim = canSite ? aim : 'country'
  const fire = (c: number) => ({ type: 'strike' as const, nationId: player.id, target, weapon: 'missile' as const, kind, count: c, ...(useAim === 'site' ? { aim: 'site' as const } : {}) })
  const forecast = stock >= 1 ? strikeForecast(game, map, player.id, target, kind, n, useAim) : null
  const launch = `${strikeCost(fire(1)).capital} money`
  const effect = live ? `Flies ${spec.days === 1 ? 'a day' : `${spec.days} days`}, then hits.` : 'Resolves when the month ends.'
  return (
    <div className="inset-card p-3 space-y-2" data-missile={kind}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="h-3 w-3 rounded-full shrink-0" style={{ background: MISSILE_SWATCH[kind] }} aria-hidden />
            <span className="text-[15px] font-semibold">{spec.name}</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">{spec.role}</span>
          </div>
          <p className="mt-1 text-[13px] text-white/75">{effectText(kind)}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[22px] font-semibold tabular-nums leading-none">{stock}</div>
          <div className="label">in stock</div>
        </div>
      </div>
      <p className="text-[12px] text-white/70">
        Reaches {spec.km} km from a country with a factory · {flightText(kind, live)}
        {site ? ` · leaves from ${map.regions[site].name}` : ' · out of range of this country'}
      </p>
      <p className={`text-[12px] ${shield.through < 1 ? 'text-[#ffd60a]' : 'text-white/65'}`} data-shield={shield.through < 1 ? 'yes' : 'no'}>
        {shield.text}
      </p>
      {stock >= 1 && (
        <div className="space-y-1.5">
          <div className="inline-flex rounded-lg overflow-hidden border border-white/15" role="group" aria-label="What to aim at">
            {(['country', 'site'] as const).map((a) => (
              <button key={a} className={`px-2.5 py-1.5 text-[13px] ${useAim === a ? 'bg-[#0a84ff] text-white' : 'bg-white/6 text-white/80'} disabled:opacity-40`} onClick={() => setAim(a)} aria-pressed={useAim === a} disabled={a === 'site' && !canSite} title={a === 'site' && !canSite ? 'No launch site here: it needs a factory' : AIMS[a].blurb}>
                {AIMS[a].name}
              </button>
            ))}
          </div>
          {forecast && (
            <p className="text-[12px] text-white/85" data-forecast={Math.round(forecast.chance * 100)}>
              <b>Forecast for {n}:</b> {forecast.text.replace(`${spec.name}: `, '')}
            </p>
          )}
        </div>
      )}
      {stock >= 1 ? (
        <div className="grid gap-2 sm:grid-cols-2 items-start">
          <OrderButton order={fire(1)} label={`${useAim === 'site' ? 'Counterforce: ' : ''}Fire 1 ${missileName(kind)}`} cost={launch} effect={effect} tone="btn-red" />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-white/75">Custom</span>
              <CountPicker value={n} max={free} onChange={setCount} label={`How many ${missileName(kind, 2)} to fire`} />
              <span className="text-[12px] text-white/60 tabular-nums">of {free} free</span>
            </div>
            <OrderButton order={fire(n)} label={`Fire ${n}`} cost={launch} effect={effect} tone="btn-red" className="w-full" />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] text-white/70">{kind === 'hypersonic' ? 'None in stock. Train them under Forces.' : 'None in stock. Build them in the missile program.'}</span>
          <button className="btn btn-quiet px-3 py-1.5 text-[13px]" onClick={() => openMilitary(kind === 'hypersonic' ? 'forces' : 'program')}>
            {kind === 'hypersonic' ? 'Open Forces' : 'Open the program'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The War Room's missile section: every kind you have or can build, and what each does to this country. Pressing Fire orders the
 * strike at once, so nothing leaves with an attack by itself. In a live game the salvo flies and lands after its days; in a turn game
 * it resolves at the month's end.
 */
export function MissileSection({ game, player, target, orders, live }: { game: GameState; player: Nation; target: RegionId; orders: Order[]; live: boolean }) {
  const openMilitary = useGame((s) => s.openMilitary)
  const kinds = missileKinds(player)
  const orbital = (player.systems?.orbital ?? 0) > 0
  const orbitalOrder: Order = { type: 'strike', nationId: player.id, target, weapon: 'orbital' }
  return (
    <section className="space-y-2" aria-label="Missiles">
      <h3 className="text-[15px] font-semibold">Missiles</h3>
      <p className="text-[13px] text-white/70">
        {live ? 'Missiles need no army. Press Fire and they leave at once, then land after the days shown.' : 'Missiles need no army. Press Fire and the strike is ordered now; it resolves when the month ends.'} Each one fired is used up. An attack on land never carries missiles by itself.
      </p>
      {kinds.map((k) => (
        <KindRow key={k} game={game} player={player} target={target} orders={orders} live={live} kind={k} />
      ))}
      {kinds.length === 0 && (
        <div className="inset-card p-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] text-white/75">You have no missiles. Raise the missile program, or research Hypersonic Missiles.</span>
          <button className="btn btn-quiet px-3 py-1.5 text-[13px]" onClick={() => openMilitary('program')}>
            Open the program
          </button>
        </div>
      )}
      {orbital && (
        <div className="inset-card p-3 space-y-2">
          <div className="text-[15px] font-semibold">Orbital strike</div>
          <OrderButton order={orbitalOrder} label="Orbital strike" cost={`${FRONTIER.orbitalMoney} money, ${FRONTIER.orbitalPP} influence`} effect="Once a year. Cuts the line hard, wrecks a building, and shames you." />
        </div>
      )}
    </section>
  )
}
