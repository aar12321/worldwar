import { SOCIAL, SOCIAL_RULES } from '../data/society'
import { describeOrder } from '../engine/resolveTurn'
import { orderCost } from '../engine/orders'
import type { GameState, Order, WorldMap } from '../engine/types'
import { NUCLEAR } from '../data/nuclear'
import { isLive } from '../engine/calendar'
import { leadingFactions, nukeThrough } from '../engine/nuclear'
import { formatDivisions, regionsOf, totalUnits } from '../engine/helpers'

export interface PendingConfirm {
  title: string
  text: string
  label: string
  /** A destructive choice is shown in red. */
  danger?: boolean
  /** Consequences, one line each, shown as a list under the text. */
  points?: string[]
  run: () => void
}

/** What to ask before an order that is large, hard to undo or hurts someone, or null for the ones that need no second thought. */
export function confirmFor(game: GameState, map: WorldMap, o: Order): Omit<PendingConfirm, 'run'> | null {
  const name = (id: string) => game.nations[id]?.name ?? id
  const cost = orderCost(game, o)
  const price = [cost.capital ? `${cost.capital} money` : '', cost.pp ? `${cost.pp} influence` : ''].filter(Boolean).join(' and ')
  const asks = (title: string, text: string, label: string, danger = false) => ({ title, text: price ? `${text} It costs ${price}.` : text, label, danger })
  switch (o.type) {
    case 'declareWar':
      return asks(`Declare war on ${name(o.target)}?`, `War costs money every month, tires your people, and cannot be undone except by peace. ${name(o.target)}'s allies may join.`, 'Declare war', true)
    case 'setGovernment':
      return asks('Change the government?', `${describeOrder(game, map, o)}. Stability drops at once and you cannot change it again for two years.`, 'Change it', true)
    case 'annexPuppet':
      return asks(`Annex ${name(o.target)}?`, 'Its land, army and treasury become yours, and the world takes note.', 'Annex')
    case 'breakPact':
      return asks(`Break the pact with ${name(o.target)}?`, 'They will remember it, and so will every other nation.', 'Break it', true)
    case 'leaveAlliance':
      return asks(`Leave the alliance with ${name(o.target)}?`, 'They will think less of you and may not come to your aid again.', 'Leave', true)
    case 'nuke': {
      const r = game.regions[o.target]
      const victim = game.nations[r?.owner]
      if (!r || !victim) return null
      const place = map.regions[o.target]?.name ?? o.target
      const stops = Math.round((1 - nukeThrough(victim.systems?.shield ?? 0)) * 100)
      const factions = leadingFactions(game, o.nationId, game.settings.difficulty === 'easy' ? NUCLEAR.factionsEasy : NUCLEAR.factions, victim.id).map((m) => (m.length > 1 ? `${name(m[0])} bloc (${m.length} nations)` : name(m[0])))
      const army = formatDivisions(totalUnits(victim.military.units))
      const points = [
        `${place} is destroyed: every building, factory and fortress there falls to almost nothing, and about two thirds of its ${r.population.toFixed(1)} million people die. Its output stays crippled for years and rebels rise in the ruins.`,
        `${victim.name}'s army (${army} divisions) is all but wiped out${victim.capital === o.target || regionsOf(game, victim.id).length <= NUCLEAR.smallNation ? '' : ' in part: the rest of its force stands elsewhere'}. Its Defense Line there breaks, so the country can be taken, and ${victim.name} can fall.`,
        stops > 0 ? `${victim.name}'s Interceptor Shield stops about ${stops}% of it.` : `${victim.name} has no Interceptor Shield to stop it.`,
        `Your reputation for aggression rises by ${NUCLEAR.infamy}. Every nation holds you in deep and lasting contempt, and cuts off trade with you for ${NUCLEAR.sanctionsMonths} months.`,
        factions.length ? `The world's strongest powers declare war on you at once: ${factions.join(' and ')}.` : 'The world\'s strongest powers declare war on you.',
        'World tension spikes. This cannot be undone.',
        isLive(game) ? `The warhead flies for ${NUCLEAR.flightDays} days before it lands, and ${victim.name} will see it coming. A war that ends first calls it off.` : 'It lands when the month ends.',
      ]
      return { title: `Launch a nuclear missile at ${place}?`, text: `A warhead of yours will strike ${victim.name}. Read what follows before you decide.`, label: 'Launch the missile', danger: true, points }
    }
    case 'strike':
      return o.weapon === 'orbital' ? asks('Fire the orbital weapon?', `${describeOrder(game, map, o)}. It can be used once a year.`, 'Fire', true) : null
    case 'setStateOwned':
      return o.mode === 'seize' ? asks('Seize this business?', 'Stability falls, business distrusts you for two years and foreign investors lose their stake.', 'Seize it', true) : null
    case 'moveCapital':
      return asks('Move the capital?', `${describeOrder(game, map, o)}. Stability falls and it cannot move again for five years.`, 'Move it')
    case 'cancelDeal': {
      const d = game.deals.find((x) => x.id === o.dealId)
      return d && d.kind === 'trade' ? asks('Tear up this trade deal?', 'The other side will not forget it.', 'Tear it up', true) : null
    }
    case 'setSocial': {
      const before = game.nations[o.nationId]?.social?.[o.policy]?.level ?? 0
      if (o.level >= before) return null
      return asks(`${before - o.level > 1 ? 'Cut' : 'Reduce'} ${SOCIAL[o.policy].name.toLowerCase()}?`, `People will lose it: stability falls by ${(before - o.level) * SOCIAL_RULES.cutStability} at once, and the benefit fades over a few months. Raising it again costs influence again.`, 'Cut it', true)
    }
    case 'repealLaw':
      return null
    default:
      return null
  }
}
