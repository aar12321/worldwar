import { NUCLEAR, NUCLEAR_CONSEQUENCES } from '../data/nuclear'
import { isLive } from '../engine/calendar'
import { nuclearAccess, nukeAir, nukeThrough, warheadsBuilding, warheadsOf } from '../engine/nuclear'
import type { RegionId } from '../engine/types'
import { getWorld } from '../map/world'
import { usePlayerView } from './hooks'
import { OrderButton } from './panel'

/**
 * The Superpower weapon, in the War Room: build a stockpile of warheads over months, then fire one at the country you are looking
 * at. It sits in a section of its own so the rest of the War Room does not depend on it.
 */
export function NuclearCard({ target }: { target: RegionId }) {
  const view = usePlayerView()
  if (!view) return null
  const { game, player } = view
  const region = game.regions[target]
  const victim = region ? game.nations[region.owner] : null
  // Only a Superpower sees the weapon at all. Anyone smaller finds it in the Empire desk's list of what the next tier opens.
  if (!region || !victim || player.tier < NUCLEAR.tier - 1) return null
  const locked = nuclearAccess(game, player.id)
  const live = isLive(game)
  const have = warheadsOf(player)
  const building = warheadsBuilding(player)
  const left = building ? Math.max(0, Math.min(...(player.nuclear?.building ?? [game.turn])) - game.turn) : 0
  const stops = Math.round((1 - nukeThrough(victim.systems?.shield ?? 0, nukeAir(game, player.id, victim.id))) * 100)

  return (
    <section className="rounded-2xl border border-[#ff453a]/45 bg-[#ff453a]/8 p-3.5 space-y-2.5" aria-label="Nuclear strike" data-testid="nuclear-card">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-[#ff8a84]">Nuclear strike</h3>
        <span className="text-[13px] tabular-nums text-white/80">
          {have} warhead{have === 1 ? '' : 's'}
          {building > 0 ? ` · 1 ready in ${left || 1} month${left === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      {locked ? (
        <p className="text-[13px] text-white/75">{locked} A Superpower can build a handful of warheads over months and fire them at a country it is at war with. The whole world turns on whoever does.</p>
      ) : (
        <>
          <p className="text-[13px] text-white/75">
            The weapon of last resort. A warhead destroys every building in {getWorld().map.regions[target]?.name ?? 'this country'} and most of {victim.name}&rsquo;s army. {live ? `It flies for ${NUCLEAR.flightDays} days, and ${victim.name} sees it coming.` : 'It lands when the month ends.'} {stops > 0 ? `Their shield stops about ${stops}%.` : 'They have no shield.'}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <OrderButton
              order={{ type: 'buildWarhead', nationId: player.id }}
              label="Build a warhead"
              cost={`${NUCLEAR.money} money`}
              effect={`Also ${NUCLEAR.steel} steel and ${NUCLEAR.research} research. Ready in ${NUCLEAR.months} months; you can keep ${NUCLEAR.maxStock}.`}
            />
            <OrderButton order={{ type: 'nuke', nationId: player.id, target }} label="Launch the missile" tone="btn-red" effect={`Asks you to confirm. ${live ? `Lands in ${NUCLEAR.flightDays} days.` : 'Lands at month end.'}`} />
          </div>
          <ul className="text-[12px] text-white/70 list-disc pl-5 space-y-0.5">
            {NUCLEAR_CONSEQUENCES.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
