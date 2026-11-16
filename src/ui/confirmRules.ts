import { BODIES, MISSIONS } from '../data/space'
import { SOCIAL, SOCIAL_RULES } from '../data/society'
import { describeOrder } from '../engine/resolveTurn'
import { orderCost } from '../engine/orders'
import type { GameState, Order, WorldMap } from '../engine/types'

export interface PendingConfirm {
  title: string
  text: string
  label: string
  /** A destructive choice is shown in red. */
  danger?: boolean
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
    case 'space': {
      const a = o.action
      if (a.kind === 'claim') return asks(`Claim ${BODIES[a.body].name}?`, 'Only you may build there from now on, and rivals will not forget it.', 'Claim it')
      if (a.kind === 'launch') {
        const spec = MISSIONS[a.mission]
        const risk = spec.crew > 0 ? ` ${spec.crew} astronauts will fly it, and a failure can kill them.` : ' A failure loses the payload and the rocket.'
        if (a.mode === 'outsource' || spec.crew > 0 || spec.payload >= 300) return asks(`${a.mode === 'house' ? 'Fly' : 'Hire a company for'} the ${spec.name.toLowerCase()}?`, `It takes months and cannot be called back.${risk}`, a.mode === 'house' ? 'Fly it' : 'Hire them', spec.crew > 0)
      }
      return null
    }
    case 'repealLaw':
      return null
    default:
      return null
  }
}
