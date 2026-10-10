import { storedOpinion } from '../ai/opinion'
import { CAUGHT_SPYING } from '../engine/espionage'
import { alliesOf, enemiesOf, hasCasusBelli } from '../engine/helpers'
import type { EventEffect, GameState, NationId } from '../engine/types'

export interface EventOption {
  label: string
  description: string
  effects: EventEffect[]
}

export interface GameEventDef {
  id: string
  title: string
  /** Supports {region}, {rival}, and {nation} placeholders. */
  text: string
  tone: 'crisis' | 'opportunity' | 'war'
  needsRival?: boolean
  needsRegion?: 'any' | 'border'
  /** Nations this event can be about. When set, the event only fires if one exists. */
  rivalCandidates?: (s: GameState, nationId: NationId) => NationId[]
  weight: (s: GameState, nationId: NationId) => number
  options: [EventOption, EventOption]
}

const atWarWithAnyone = (s: GameState, id: NationId) => s.wars.some((k) => k.split('|').includes(id))

const embattledAllies = (s: GameState, id: NationId) => alliesOf(s, id).filter((a) => s.nations[a]?.alive && enemiesOf(s, a).length > 0).sort()

const grudgeHolders = (s: GameState, id: NationId) =>
  Object.values(s.nations)
    .filter((n) => n.alive && n.id !== id && (storedOpinion(s, n.id, id).reduce((sum, m) => sum + m.value, 0) <= -15 || hasCasusBelli(s, n.id, id)))
    .map((n) => n.id)
    .sort()

const spyVictims = (s: GameState, id: NationId) =>
  Object.values(s.nations)
    .filter((n) => n.alive && storedOpinion(s, n.id, id).some((m) => m.label === CAUGHT_SPYING && m.value <= -10))
    .map((n) => n.id)
    .sort()

const hasPorts = (s: GameState, id: NationId) => Object.values(s.regions).some((r) => r.owner === id && r.buildings.port > 0)

export const EVENTS: GameEventDef[] = [
  {
    id: 'bread_riot',
    title: 'The Bread Riot',
    text: 'A drought has caused food shortages in your capital. Crowds are storming the granaries and the police are wavering.',
    tone: 'crisis',
    weight: (s, id) => (s.nations[id].foodShortage ? 4 : 1.2),
    options: [
      {
        label: 'Use Force',
        description: 'Send in the troops. Order is maintained, at a cost in soldiers and political capital.',
        effects: [{ type: 'militaryPool', fraction: 0.15 }, { type: 'resource', key: 'pp', amount: -15 }, { type: 'stability', amount: 4 }],
      },
      {
        label: 'Import Food',
        description: 'Buy grain from abroad at ruinous prices. The people will remember your generosity.',
        effects: [{ type: 'resource', key: 'capital', amount: -40, perWorkforce: -2 }, { type: 'resource', key: 'food', amount: 10, perWorkforce: 3 }, { type: 'stability', amount: 10 }],
      },
    ],
  },
  {
    id: 'tech_defector',
    title: 'The Tech Defector',
    text: 'A brilliant scientist from {rival} has slipped across the border and offers you their nation\u2019s secrets.',
    tone: 'opportunity',
    needsRival: true,
    weight: () => 1,
    options: [
      {
        label: 'Accept',
        description: 'Instantly unlock a new technology, but {rival} gains a justification to declare war on you.',
        effects: [{ type: 'unlockRandomTech' }, { type: 'casusBelliForRival', turns: 12 }],
      },
      {
        label: 'Execute',
        description: 'Make an example of the traitor. Gain influence and keep the peace.',
        effects: [{ type: 'resource', key: 'pp', amount: 20 }],
      },
    ],
  },
  {
    id: 'border_skirmish',
    title: 'Border Skirmish',
    text: 'Separatist militias in {region} have attacked a border post and declared a breakaway republic.',
    tone: 'war',
    needsRegion: 'border',
    weight: (s, id) => (s.nations[id].stability < 50 ? 2 : 0.8),
    options: [
      {
        label: 'Divert Troops',
        description: 'Crush the rising by force. Rebels appear in {region}; station or send an army there to defeat them.',
        effects: [{ type: 'spawnRebels', strength: 2.5 }, { type: 'stability', amount: 3 }],
      },
      {
        label: 'Negotiate Autonomy',
        description: 'Buy off the separatist leaders. Costs money and influence, and looks weak.',
        effects: [{ type: 'resource', key: 'capital', amount: -30, perWorkforce: -1 }, { type: 'resource', key: 'pp', amount: -10 }, { type: 'stability', amount: -4 }],
      },
    ],
  },
  {
    id: 'industrial_accident',
    title: 'Industrial Catastrophe',
    text: 'A chemical explosion has gutted a major factory complex in {region}. Workers demand compensation.',
    tone: 'crisis',
    needsRegion: 'any',
    weight: () => 1,
    options: [
      {
        label: 'Rebuild Immediately',
        description: 'Pour state money into reconstruction. The factory is saved.',
        effects: [{ type: 'resource', key: 'capital', amount: -35, perWorkforce: -1 }, { type: 'stability', amount: 2 }],
      },
      {
        label: 'Write It Off',
        description: 'Lose the factory and let the unions grumble.',
        effects: [{ type: 'loseBuilding', building: 'factory' }, { type: 'stability', amount: -6 }],
      },
    ],
  },
  {
    id: 'foreign_investors',
    title: 'Foreign Investors',
    text: 'A consortium of overseas financiers offers a massive loan in exchange for concessions on your mineral rights.',
    tone: 'opportunity',
    weight: (s, id) => (s.nations[id].resources.capital < 50 ? 2 : 1),
    options: [
      {
        label: 'Sign the Deal',
        description: 'A flood of money, but nationalists call it treason.',
        effects: [{ type: 'resource', key: 'capital', amount: 50, perWorkforce: 3 }, { type: 'resource', key: 'pp', amount: -10 }, { type: 'stability', amount: -3 }],
      },
      {
        label: 'Refuse',
        description: 'Stand proud. Gain influence.',
        effects: [{ type: 'resource', key: 'pp', amount: 12 }],
      },
    ],
  },
  {
    id: 'coup_plot',
    title: 'The Generals\u2019 Plot',
    text: 'Intelligence reports that senior officers are plotting a coup. They meet in secret in {region}.',
    tone: 'crisis',
    needsRegion: 'any',
    weight: (s, id) => (s.nations[id].stability < 45 ? 2.5 : 0.6),
    options: [
      {
        label: 'Purge the Officers',
        description: 'Arrest hundreds. Your armies lose cohesion, but the regime is secure.',
        effects: [{ type: 'armyAttrition', fraction: 0.1 }, { type: 'stability', amount: 8 }],
      },
      {
        label: 'Grant Concessions',
        description: 'Buy their loyalty with promotions and budgets.',
        effects: [{ type: 'resource', key: 'pp', amount: -20 }, { type: 'resource', key: 'capital', amount: -20 }],
      },
    ],
  },
  {
    id: 'plague',
    title: 'Plague Outbreak',
    text: 'A virulent fever is spreading through the slums of {region}. Doctors beg for a quarantine.',
    tone: 'crisis',
    needsRegion: 'any',
    weight: () => 0.8,
    options: [
      {
        label: 'Quarantine',
        description: 'Seal the district. Expensive, but lives are saved.',
        effects: [{ type: 'resource', key: 'capital', amount: -25, perWorkforce: -1.5 }, { type: 'resource', key: 'tp', amount: -5 }],
      },
      {
        label: 'Keep the Economy Open',
        description: 'Business as usual. The population suffers.',
        effects: [{ type: 'popLoss', fraction: 0.03 }, { type: 'stability', amount: -10 }],
      },
    ],
  },
  {
    id: 'nationalist_rally',
    title: 'Nationalist Fervor',
    text: 'Huge crowds rally in the streets of {nation}, demanding total victory over the enemy.',
    tone: 'war',
    weight: (s, id) => (atWarWithAnyone(s, id) ? 2.5 : 0),
    options: [
      {
        label: 'Embrace the Fervor',
        description: 'Volunteers flood the recruiting offices. War weariness fades.',
        effects: [{ type: 'militaryPool', fraction: -0.25 }, { type: 'warWeariness', amount: -15 }, { type: 'stability', amount: 6 }],
      },
      {
        label: 'Call for Calm',
        description: 'A measured statesman earns respect in the halls of power.',
        effects: [{ type: 'resource', key: 'pp', amount: 15 }],
      },
    ],
  },
  {
    id: 'lab_breakthrough',
    title: 'Breakthrough in the Labs',
    text: 'Your scientists in {region} believe they are one big grant away from a revolutionary discovery.',
    tone: 'opportunity',
    needsRegion: 'any',
    weight: () => 1,
    options: [
      {
        label: 'Fund the Research',
        description: 'Spend money for a burst of research.',
        effects: [{ type: 'resource', key: 'capital', amount: -30, perWorkforce: -1 }, { type: 'resource', key: 'tp', amount: 25, perWorkforce: 1 }],
      },
      {
        label: 'Build Something Useful',
        description: 'Redirect the lab into a new university campus instead.',
        effects: [{ type: 'addBuilding', building: 'university' }, { type: 'resource', key: 'capital', amount: -20 }],
      },
    ],
  },
  {
    id: 'ally_aid',
    title: 'An Ally Begs for Aid',
    text: '{rival} is fighting for its life. Its envoy pleads for gold and grain, and reminds you of the oath your nations swore.',
    tone: 'war',
    needsRival: true,
    rivalCandidates: embattledAllies,
    weight: (s, id) => (embattledAllies(s, id).length ? 2.5 : 0),
    options: [
      {
        label: 'Send Aid',
        description: 'Ship money and food to {rival}. They will remember who stood by them.',
        effects: [
          { type: 'resource', key: 'capital', amount: -25, perWorkforce: -1 },
          { type: 'resource', key: 'food', amount: -8 },
          { type: 'rivalResource', key: 'capital', amount: 25, perWorkforce: 1 },
          { type: 'rivalResource', key: 'food', amount: 8 },
          { type: 'opinion', amount: 25, label: 'Sent aid in our darkest hour' },
        ],
      },
      {
        label: 'Keep Your Stores',
        description: 'Your people come first. {rival} will not forget this.',
        effects: [{ type: 'resource', key: 'pp', amount: 5 }, { type: 'opinion', amount: -20, label: 'Abandoned us in our need' }],
      },
    ],
  },
  {
    id: 'trade_embargo',
    title: 'Threat of Embargo',
    text: '{rival} accuses your merchants of smuggling and threatens to close the sea lanes to your ships unless you pay compensation.',
    tone: 'crisis',
    needsRival: true,
    rivalCandidates: grudgeHolders,
    weight: (s, id) => (hasPorts(s, id) && grudgeHolders(s, id).length ? 1.2 : 0),
    options: [
      {
        label: 'Pay Compensation',
        description: 'Hand money to {rival} and keep the ports open. Relations thaw.',
        effects: [
          { type: 'resource', key: 'capital', amount: -20, perWorkforce: -1 },
          { type: 'rivalResource', key: 'capital', amount: 20, perWorkforce: 1 },
          { type: 'opinion', amount: 15, label: 'Paid compensation' },
        ],
      },
      {
        label: 'Defy Them',
        description: 'Port trade collapses for 4 months, but the nation rallies behind you.',
        effects: [{ type: 'embargo', turns: 4 }, { type: 'stability', amount: 4 }, { type: 'opinion', amount: -10, label: 'Defied our ultimatum' }],
      },
    ],
  },
  {
    id: 'spy_scandal',
    title: 'Spy Scandal',
    text: 'The agents you sent into {rival} are paraded before the world press. Their government demands a formal apology.',
    tone: 'crisis',
    needsRival: true,
    rivalCandidates: spyVictims,
    weight: (s, id) => (spyVictims(s, id).length ? 3 : 0),
    options: [
      {
        label: 'Apologize',
        description: 'Swallow your pride. {rival} drops its grievance against you.',
        effects: [{ type: 'resource', key: 'pp', amount: -15 }, { type: 'opinion', amount: 25, label: 'Accepted our apology' }, { type: 'clearCasusBelli' }],
      },
      {
        label: 'Deny Everything',
        description: 'Call it a fabrication. Popular at home, poison abroad.',
        effects: [{ type: 'resource', key: 'pp', amount: 8 }, { type: 'stability', amount: 2 }, { type: 'opinion', amount: -15, label: 'Lied to our faces' }],
      },
    ],
  },
]

export const EVENT_BY_ID: Record<string, GameEventDef> = Object.fromEntries(EVENTS.map((e) => [e.id, e]))
