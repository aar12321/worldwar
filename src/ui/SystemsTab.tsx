import { SYSTEM_IDS, SYSTEM_MAX, SYSTEM_SPECS, systemsCost, type SystemId } from '../data/systems'
import { TECH_BY_ID } from '../data/techTree'
import { hasTech } from '../engine/helpers'
import { systemUpkeep } from '../engine/systems'
import { fmt, usePlayerView } from './hooks'
import { Pips } from './bits'
import { OrderButton } from './panel'

function SystemCard({ id }: { id: SystemId }) {
  const view = usePlayerView()!
  const { player } = view
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
      {level < SYSTEM_MAX && unlocked && <p className="text-[13px] text-white/75">Next level: {spec.levels[level]}</p>}
      <p className="text-[12px] text-white/60">Weakness: {spec.counter}</p>
      <div className="text-[13px] text-white/75">Costs {spec.upkeep} money a month for each level.</div>
      {!unlocked ? (
        <p className="text-[13px] text-[#ffd60a]">Research {TECH_BY_ID[spec.tech]?.name ?? 'a technology'} to unlock it.</p>
      ) : (
        level + queued < SYSTEM_MAX && (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: SYSTEM_MAX - level }, (_, i) => i + 1).map((levels) => (
              <OrderButton
                key={levels}
                order={{ type: 'fundSystem', nationId: player.id, system: id, levels }}
                label={`Raise to level ${level + levels}`}
                cost={`${fmt(systemsCost(id, level, levels), 0)} money`}
                effect={levels === 1 ? 'Takes effect at once.' : `${levels} levels at once.`}
              />
            ))}
          </div>
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
    </div>
  )
}
