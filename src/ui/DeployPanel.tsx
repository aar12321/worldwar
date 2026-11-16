import { FRONTIER } from '../data/systems'
import { UNIT_SPECS } from '../data/unitTypes'
import { COMMITS, type Commit } from '../data/war'
import { SENDABLE, deployBill, remainder, shareOfPool } from '../engine/deploy'
import { formatDivisions, totalUnits } from '../engine/helpers'
import type { GameState, Nation, UnitCounts, UnitType } from '../engine/types'
import { UnitIcon } from './icons'
import { CostEffect, NumberStepper } from './widgets'
import { FormationPreview } from '../fx/FormationPreview'
import { useGame } from '../store'

/** How many of a kind a stepper may reach: whole divisions, or tenths when less than one is free. */
const whole = (pool: number) => (pool >= 1 ? Math.floor(pool + 1e-9) : Math.floor(pool * 10 + 1e-9) / 10)

const QUICK: { id: string; label: string; share: number; commit?: Commit; tip: string }[] = [
  { id: 'none', label: 'None', share: 0, tip: 'Send nothing: start again from empty.' },
  { id: 'half', label: 'Half', share: 0.5, tip: 'Half of every kind that is free.' },
  { id: 'probe', label: COMMITS.probe.name, share: COMMITS.probe.share, commit: 'probe', tip: COMMITS.probe.blurb },
  { id: 'main', label: COMMITS.main.name, share: COMMITS.main.share, commit: 'main', tip: COMMITS.main.blurb },
  { id: 'max', label: 'Max', share: 1, tip: 'Everything that is free. Leaves home thin.' },
]

/**
 * Choose exactly what to send: a stepper for each kind of unit (never more than is free), quick buttons for the usual shares,
 * the missiles to fire with the attack, and what the force costs to keep and what stays home to defend.
 */
export function DeployPanel({
  game,
  player,
  pool,
  units,
  setUnits,
  missiles,
  setMissiles,
  missileMax,
  coastal,
  stanceCost,
  live,
  shortcuts,
  title = 'Your force',
}: {
  game: GameState
  player: Nation
  pool: UnitCounts
  units: UnitCounts
  setUnits: (u: UnitCounts) => void
  missiles: number
  setMissiles: (n: number) => void
  missileMax: number
  coastal: boolean
  stanceCost: number
  live: boolean
  shortcuts?: boolean
  title?: string
}) {
  const reducedMotion = useGame((s) => s.settings.reducedMotion)
  const force = player.military.units
  const owned = SENDABLE.filter((k) => force[k] >= 0.05)
  const sent = totalUnits(units)
  const bill = deployBill(units)
  const left = remainder(game, player.id, units)
  const posted = Math.max(0, totalUnits(force) - totalUnits(pool) - 0)
  const poolTotal = totalUnits(pool)
  const set = (k: UnitType, v: number) => setUnits({ ...units, [k]: v })
  const at = (share: number) => {
    const target = shareOfPool(pool, share)
    return SENDABLE.every((k) => Math.abs(target[k] - units[k]) < 0.05)
  }
  return (
    <section className="space-y-2.5" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <span className="text-[13px] text-white/80 tabular-nums" aria-live="polite">
          sending <b className="text-white">{formatDivisions(sent)}</b> of {formatDivisions(poolTotal)} free divisions
        </span>
      </div>
      <p className="text-[12px] text-white/65">
        {live ? 'A live army leaves for days or weeks, and a guard always stays home. ' : 'In a turn game your army stays in place and fights where it stands; the units you name are spent for the month. '}
        Free means after forces on station{posted > 0.05 ? ` (${formatDivisions(posted)} divisions)` : ''} and attacks already ordered.
        {shortcuts ? ' Keys: M max, H half, N none.' : ''}
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick amounts">
        {QUICK.map((q) => (
          <button key={q.id} type="button" className={`btn px-3 py-1.5 text-[13px] ${at(q.share) && (q.share > 0 || sent < 0.05) ? 'btn-primary' : 'btn-quiet'}`} title={q.tip} aria-pressed={at(q.share)} onClick={() => setUnits(shareOfPool(pool, q.share))}>
            {q.label}
            {q.share > 0 && q.share < 1 && <span className="ml-1 text-[11px] opacity-70">{Math.round(q.share * 100)}%</span>}
          </button>
        ))}
      </div>
      <FormationPreview units={units} color={player.color} reduced={reducedMotion} label="Force preview" />
      <div className="grid gap-2 sm:grid-cols-2">
        {owned.map((k) => {
          const spec = UNIT_SPECS[k]
          const free = pool[k]
          const inland = k === 'naval' && !coastal
          const max = inland ? 0 : whole(free)
          const stationed = force[k] - free
          return (
            <div key={k} className="inset-card p-2.5 space-y-1.5" data-unit={k}>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold" title={spec.role}>
                  <UnitIcon unit={k} size={17} />
                  {spec.name}
                </span>
                <span className="text-[12px] text-white/70 tabular-nums" title={`Attack ${spec.attack}, defence ${spec.defense}, soaks up ${spec.toughness} infantry's worth of damage`}>
                  {formatDivisions(free)} free · A{spec.attack} D{spec.defense}
                </span>
              </div>
              <NumberStepper
                label={`${spec.name} to send`}
                value={Math.min(units[k], max)}
                onChange={(v) => set(k, v)}
                max={max}
                step={max >= 1 ? 1 : 0.1}
                slider={false}
                quick={[0]}
                disabled={max <= 0}
                format={(n) => formatDivisions(n)}
                hint={inland ? 'Warships cannot fight inland.' : stationed >= 0.05 ? `${formatDivisions(stationed)} more on station or already spent` : undefined}
              />
            </div>
          )
        })}
      </div>
      {missileMax > 0 && (
        <div className="inset-card p-2.5 space-y-1" data-unit="missile">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold" title={UNIT_SPECS.missile.role}>
              <UnitIcon unit="missile" size={17} />
              Missiles fired with the attack
            </span>
            <span className="text-[12px] text-white/70 tabular-nums">{missileMax} free</span>
          </div>
          <NumberStepper label="Missiles to fire" value={Math.min(missiles, missileMax)} onChange={setMissiles} max={missileMax} slider={false} quick={[0]} hint={`Each is used up, strikes first and cuts the Defense Line ${FRONTIER.missileLine} even if the battle is lost (less through their shield).`} />
        </div>
      )}
      <CostEffect
        costs={stanceCost > 0 ? [{ label: 'money to launch', amount: stanceCost, have: player.resources.capital }] : []}
        effects={[
          <span key="home">
            Home keeps <b>{formatDivisions(totalUnits(left))}</b> divisions{totalUnits(force) > 0 ? ` (${Math.round((totalUnits(left) / totalUnits(force)) * 100)}% of your military)` : ''}
          </span>,
          <span key="bill">
            Upkeep of the force <b>{bill.upkeep.toFixed(1)}</b> money, <b>{bill.oil.toFixed(2)}</b> oil and <b>{bill.food.toFixed(1)}</b> food a month (paid whether it fights or not)
          </span>,
        ]}
      />
    </section>
  )
}
