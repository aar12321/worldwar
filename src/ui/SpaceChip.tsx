import { MISSIONS } from '../data/space'
import type { Mission } from '../data/space'
import { useGame } from '../store'

const PHASE = { build: 'being built', launch: 'on the pad', transit: 'in flight', arrival: 'at the target' } as const

/** The space missions that were launched months ago and are still flying. The same list until a mission changes. */
const flying = (s: { game: { playerId: string; nations: Record<string, { space?: { missions: Mission[] } }> } | null }) => {
  const g = s.game
  return g?.nations[g.playerId]?.space?.missions
}

/** Your flights under way, in the corner of the screen with the others: the one that lands soonest, and how many more. */
export function SpaceChip() {
  const missions = useGame(flying)
  const open = useGame((s) => s.openEconomy)
  // A desk covers the same news (the Missions bars), and the chip would sit on its title.
  const deskOpen = useGame((s) => s.panel !== 'none')
  if (!missions?.length || deskOpen) return null
  const soon = [...missions].sort((a, b) => a.left - b.left)[0]
  const spec = MISSIONS[soon.kind]
  return (
    <button className="advice-pill pointer-events-auto" onClick={() => open('space')} title="Open the space program">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#bf5af2' }} />
      <span className="truncate">
        {spec.name}: {PHASE[soon.phase]}, {soon.left} mo left{missions.length > 1 ? ` (+${missions.length - 1})` : ''}
      </span>
      <span className="text-white/65 shrink-0">Space ›</span>
    </button>
  )
}
