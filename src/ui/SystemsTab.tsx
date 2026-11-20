import { SYSTEM_IDS, SYSTEM_MAX, SYSTEM_SPECS, type SystemId } from '../data/systems'
import { TECH_BY_ID } from '../data/techTree'
import { hasTech } from '../engine/helpers'
import { fundSystemCost, systemUpkeep } from '../engine/systems'
import { fmt, usePlayerView } from './hooks'
import { Pips } from './bits'
import { MissileProgramCard } from './MissileProgram'
import { OrderButton } from './panel'

function SystemCard({ id }: { id: SystemId }) {
  const view = usePlayerView()!
  const { player, game } = view
  const spec = SYSTEM_SPECS[id]
  const level = player.systems[id] ?? 0
  const unlocked = hasTech(player, spec.tech)
  const queued = view.orders.filter((o) => o.type === 'fundSystem' && o.system === id).length
  return (
    <div className={`inset-card p-3.5 space-y-2.5 ${unlocked ? '' : 'opacity-70'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold tracking-tight">{spec.name}</div>
          <p className="text-[13px] text-white/70">{spec.role}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="label">Level</div>
          <div className="text-[22px] font-semibold tabular-nums">
            {level}
            <span className="text-white/50 text-[14px]"> / {SYSTEM_MAX}</span>
          </div>
        </div>
      </div>
      <Pips value={level} max={SYSTEM_MAX} />
      {level > 0 && <p className="text-[13px] text-[#6eeb8a]">Now: {spec.levels[level - 1]}</p>}
      <p className="text-[12px] text-white/60">Weakness: {spec.counter}</p>
      <div className="text-[13px] text-white/75">Costs {spec.upkeep} money a month for each level.</div>
      {!unlocked ? (
        <p className="text-[13px] text-[#ffd60a]">Research {TECH_BY_ID[spec.tech]?.name ?? 'a technology'} to unlock it.</p>
      ) : (
        level + queued < SYSTEM_MAX ? (
          <div className="space-y-1.5" data-raise={level + queued + 1}>
            <OrderButton
              order={{ type: 'fundSystem', nationId: player.id, system: id, levels: 1 }}
              label={`Raise to level ${level + queued + 1}`}
              cost={`${fmt(fundSystemCost(game, { type: 'fundSystem', nationId: player.id, system: id, levels: 1 }), 0)} money · +${spec.upkeep}/mo`}
              effect={spec.levels[level + queued]}
              tone="btn-primary"
              className="w-full sm:w-auto"
            />
            {level + queued + 1 < SYSTEM_MAX && (
              <ul className="text-[12px] text-white/60 space-y-0.5" aria-label="Later levels">
                {spec.levels.slice(level + queued + 1).map((text, i) => (
                  <li key={i}>
                    <span className="text-white/75 font-semibold">Level {level + queued + 2 + i}:</span> {text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          level >= SYSTEM_MAX && <p className="text-[13px] text-[#6eeb8a]">At its highest level.</p>
        )
      )}
    </div>
  )
}

/** The Frontier systems: national programs you buy in levels, each from a technology and each with a weakness. */
export function SystemsTab() {
  const view = usePlayerView()
  if (!view) return null
  const { player } = view
  const owned = SYSTEM_IDS.filter((id) => hasTech(player, SYSTEM_SPECS[id].tech))
  return (
    <div className="space-y-5">
      <p className="text-[14px] text-white/80">
        Frontier technologies unlock systems you run for the whole nation. Each has three levels, costs upkeep, and has something that beats it, so no single program wins a war alone.
        {owned.length > 0 ? ` You run ${fmt(systemUpkeep(player), 1)} money a month of them.` : ' Research the Frontier branch to unlock them.'}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {SYSTEM_IDS.map((id) => (
          <SystemCard key={id} id={id} />
        ))}
      </div>
      <MissileProgramCard />
    </div>
  )
}
