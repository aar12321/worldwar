import { BODIES, MISSIONS } from '../data/space'
import { BLOC } from '../data/blocs'
import { quote } from '../engine/space'
import { SOCIAL, SOCIAL_RULES } from '../data/society'
import { describeOrder } from '../engine/resolveTurn'
import { orderCost } from '../engine/orders'
import type { GameState, Order, WorldMap } from '../engine/types'
import { NUCLEAR } from '../data/nuclear'
import { isLive } from '../engine/calendar'
import { leadingFactions, nukeAir, nukeThrough } from '../engine/nuclear'
import { PUPPET } from '../data/puppets'
import { previewGovern } from '../engine/puppets'
import { formatDivisions, regionsOf, totalUnits } from '../engine/helpers'
import { VISIT } from '../data/relations'
import { opinionOf } from '../ai/opinion'
import { getWorld } from '../map/world'

const opinionNow = (game: GameState, o: Extract<Order, { type: 'relate' }>) => opinionOf(game, getWorld().map, o.target, o.nationId)

function opinionRisk(game: GameState, map: WorldMap, o: Extract<Order, { type: 'relate' }>): boolean {
  void map
  return !!game.nations[o.target] && opinionNow(game, o) < VISIT.riskBelow
}

export interface PendingConfirm {
  title: string
  text: string
  label: string
  /** A destructive choice is shown in red. */
  danger?: boolean
  /** Consequences, one line each, shown as a list under the text. */
  points?: string[]
  /** A red banner above the text, for the gravest choices. */
  warning?: string
  /** A sentence the player must tick before the button works. */
  require?: string
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
    case 'governPuppet': {
      const pv = previewGovern(game, map, o.nationId, o.target, o.patch)
      // Only a harsh change asks: one that would leave the puppet on the edge of revolt, or shocks it badly at once.
      if (pv.settlesAfter >= PUPPET.rebelBelow && pv.shock > -6) return null
      return {
        ...asks(`Press ${name(o.target)} this hard?`, `${describeOrder(game, map, o)}.`, 'Do it', true),
        points: [
          `Its loyalty drops by ${Math.abs(pv.shock).toFixed(1)} at once, from ${Math.round(pv.loyalty)}.`,
          `It would settle near ${Math.round(pv.settlesAfter)}${pv.settlesAfter < PUPPET.rebelBelow ? ': rebels, and a growing chance it breaks free' : ''}.`,
        ],
      }
    }
    case 'breakPact':
      return asks(`Break the pact with ${name(o.target)}?`, 'They will remember it, and so will every other nation.', 'Break it', true)
    case 'leaveAlliance':
      return asks(`Leave the alliance with ${name(o.target)}?`, 'They will think less of you and may not come to your aid again.', 'Leave', true)
    case 'nuke': {
      const r = game.regions[o.target]
      const victim = game.nations[r?.owner]
      if (!r || !victim) return null
      const place = map.regions[o.target]?.name ?? o.target
      const stops = Math.round((1 - nukeThrough(victim.systems?.shield ?? 0, nukeAir(game, o.nationId, victim.id))) * 100)
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
      return { title: `Launch a nuclear missile at ${place}?`, text: `A warhead of yours will strike ${victim.name}. Read what follows before you decide.`, label: 'Launch the missile', danger: true, points, warning: 'This starts a world war and cannot be undone.', require: 'I understand that the whole world will turn on me, and I want to fire.' }
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
    case 'factionLeave':
      if (BLOC.on) return asks('Leave the bloc?', 'You lose its perks and your role, your pledges to its operations are dropped, and the members will think less of you. Your divisions are your own: there is nothing to take back.', 'Leave', true)
      return asks('Leave the faction?', 'You take back what is left of your claim, less the exit fee (or nothing, if the charter forfeits). Soldiers stay in the pool while the faction is at war, and the members will think less of you.', 'Leave', true)
    case 'factionPropose':
      return o.proposal.kind === 'war' ? asks(`Put war on ${name(o.proposal.target)} to the vote?`, 'If the members pass it, every member that can joins the war, and the pooled army attacks. The influence is spent whether or not it passes.', 'Put it to the vote') : null
    case 'space': {
      const a = o.action
      if (a.kind === 'claim') return asks(`Claim ${BODIES[a.body].name}?`, 'Only you may build there from now on, and rivals will not forget it.', 'Claim it')
      if (a.kind === 'launch') {
        const spec = MISSIONS[a.mission]
        const risk = spec.crew > 0 ? ` ${spec.crew} astronauts will fly it, and a failure can kill them.` : ' A failure loses the payload and the rocket.'
        const me = game.nations[o.nationId]
        const odds = me ? quote(game, me, a.mission, a.mode, a.company).odds.total : null
        const chance = odds === null ? '' : ` The odds of it all going well are ${Math.round(odds * 100)}%.`
        if (a.mode === 'outsource' || spec.crew > 0 || spec.payload >= 300) return asks(`${a.mode === 'house' ? 'Fly' : 'Hire a company for'} the ${spec.name.toLowerCase()}?`, `It takes months and cannot be called back.${risk}${chance}`, a.mode === 'house' ? 'Fly it' : 'Hire them', spec.crew > 0)
      }
      return null
    }
    case 'relate': {
      const them = name(o.target)
      switch (o.act) {
        case 'cede':
          return asks(`Give ${game.regions[o.give ?? '']?.owner === o.nationId ? (map.regions[o.give ?? '']?.name ?? 'this country') : 'this country'} to ${them}?`, 'The country, its people and its buildings become theirs for good. They will be grateful and owe you two favours.', 'Give it away', true)
        case 'techShare':
          return asks(`Share this technology with ${them}?`, 'They keep it for good, and it makes them stronger.', 'Share it')
        case 'endPlan':
          return asks('End the joint war plan?', `${them} will remember being left alone in the war.`, 'End it', true)
        case 'endProgram':
          return asks('Walk away?', 'They will think less of you, and a joint venture returns only half your stake.', 'Walk away', true)
        case 'closeEmbassy':
          return asks('Close the embassy?', 'They will take it as a slight, and you lose your window onto them.', 'Close it', true)
        case 'warPlan':
          return asks(`Agree a joint war plan with ${them}?`, 'While it lasts neither of you can declare war on the other, and whoever takes a country pays the partner a share of its value.', 'Agree the plan')
        case 'visit':
          return opinionRisk(game, map, o) ? asks(`Visit ${them}?`, 'They do not think well of you. There is a real chance of a protocol incident.', 'Go anyway') : null
        default:
          return null
      }
    }
    case 'repealLaw':
      return null
    default:
      return null
  }
}
