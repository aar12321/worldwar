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
        description: 'Crush the rising by force. Rebels appear in {region}; your military and the garrison there must defeat them.',
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
        description: 'Arrest hundreds. Your military loses cohesion, but the regime is secure.',
        effects: [{ type: 'armyAttrition', fraction: 0.1 }, { type: 'stability', amount: 8 }],
      },
      {
        label: 'Grant Concessions',
        description: 'Buy their loyalty with promotions and budgets.',
        effects: [{ type: 'resource', key: 'pp', amount: -20 }, { type: 'resource', key: 'capital', amount: -20 }],
      },
    ],
  },
  // ---- Statecraft events: money, people, health and empire ----
  {
    id: 'bank_run',
    title: 'Run on the Banks',
    text: 'Rumors of bad loans have savers queuing at every bank in {nation}. Two banks have already shut their doors.',
    tone: 'crisis',
    weight: (s, id) => (s.nations[id].programs?.creditSector || s.nations[id].debt > 0 ? 1.5 : 0.4),
    options: [
      { label: 'Guarantee Deposits', description: 'The treasury stands behind every saver. Expensive, but the panic ends.', effects: [{ type: 'resource', key: 'capital', amount: -30, perWorkforce: -4 }, { type: 'stability', amount: 3 }] },
      { label: 'Let Them Fail', description: 'Save the money. Savers lose everything, prices wobble and the currency slips.', effects: [{ type: 'stability', amount: -8 }, { type: 'bank', key: 'inflation', amount: 3 }, { type: 'bank', key: 'currency', amount: -0.08 }] },
    ],
  },
  {
    id: 'inflation_riot',
    title: 'Prices Out of Reach',
    text: 'Bread has doubled in price in a year. Crowds march on the central bank demanding something be done.',
    tone: 'crisis',
    weight: (s, id) => ((s.nations[id].bank?.inflation ?? 0) > 8 ? 4 : 0),
    options: [
      { label: 'Raise Wages', description: 'Pay people more. They calm down, and prices climb further.', effects: [{ type: 'stability', amount: 6 }, { type: 'bank', key: 'inflation', amount: 2 }, { type: 'resource', key: 'capital', amount: -20, perWorkforce: -2 }] },
      { label: 'Hold the Line', description: 'Tight money. Prices settle sooner, but people go without work for a while.', effects: [{ type: 'bank', key: 'inflation', amount: -3 }, { type: 'people', key: 'unemployment', amount: 0.02 }, { type: 'stability', amount: -4 }] },
    ],
  },
  {
    id: 'brain_drain',
    title: 'Brain Drain',
    text: 'Engineers and scientists are leaving {nation} for better pay abroad. Universities report empty labs.',
    tone: 'crisis',
    weight: (s, id) => ((s.nations[id].people?.migration ?? 0) < 0 ? 3 : 0.5),
    options: [
      { label: 'Match Their Pay', description: 'Grants and salaries to keep them home.', effects: [{ type: 'resource', key: 'capital', amount: -25, perWorkforce: -3 }] },
      { label: 'Let Them Go', description: 'Others will rise in their place, in time.', effects: [{ type: 'skills', from: 'engineers', to: 'basic', amount: 0.006 }, { type: 'skills', from: 'scientists', to: 'basic', amount: 0.004 }] },
    ],
  },
  {
    id: 'doctors_strike',
    title: 'The Doctors Walk Out',
    text: 'Overworked and underpaid, the doctors of {nation} are on strike. Hospitals run on skeleton staff.',
    tone: 'crisis',
    weight: (s, id) => ((s.nations[id].spending?.health ?? 2) <= 1 ? 3 : 0.6),
    options: [
      { label: 'Meet Their Demands', description: 'A pay rise for every doctor. The wards fill again.', effects: [{ type: 'resource', key: 'capital', amount: -20, perWorkforce: -2.5 }, { type: 'people', key: 'health', amount: 0.01 }] },
      { label: 'Call In the Army Medics', description: 'Free, and the strike collapses, but health and trust suffer.', effects: [{ type: 'people', key: 'health', amount: -0.04 }, { type: 'stability', amount: -5 }] },
    ],
  },
  {
    id: 'medical_breakthrough',
    title: 'A Medical Breakthrough',
    text: 'Researchers in {nation} have a promising new treatment. They ask for the money to bring it to everyone.',
    tone: 'opportunity',
    weight: (s, id) => (s.nations[id].techs.some((t) => t.startsWith('med_')) || s.nations[id].projects?.medCentre ? 2 : 0.5),
    options: [
      { label: 'Fund It', description: 'Pay for trials and factories. Health rises across the country.', effects: [{ type: 'resource', key: 'capital', amount: -30, perWorkforce: -2 }, { type: 'people', key: 'health', amount: 0.05 }] },
      { label: 'Sell the Patent', description: 'Let a foreign company buy it. Money now, and a little research.', effects: [{ type: 'resource', key: 'capital', amount: 40, perWorkforce: 3 }, { type: 'resource', key: 'tp', amount: 15 }] },
    ],
  },
  {
    id: 'engineering_scandal',
    title: 'The Collapsed Bridge',
    text: 'A new bridge in {region} has collapsed. Inspectors find corners cut on every public project in the country.',
    tone: 'crisis',
    needsRegion: 'any',
    weight: (s, id) => (Object.values(s.nations[id].projects ?? {}).some((p) => p && !p.done) ? 3 : 0.3),
    options: [
      { label: 'Stop and Inspect', description: 'Halt the work and check everything. Projects lose time, but trust is kept.', effects: [{ type: 'projectProgress', months: -2 }, { type: 'stability', amount: 2 }] },
      { label: 'Cover It Up', description: 'Blame a contractor and carry on. The public is not fooled.', effects: [{ type: 'stability', amount: -6 }, { type: 'resource', key: 'pp', amount: -10 }] },
    ],
  },
  {
    id: 'housing_boom',
    title: 'Housing Boom',
    text: 'Builders want to throw up new towns around your cities. They ask for land and cheap loans.',
    tone: 'opportunity',
    weight: (s, id) => ((s.nations[id].people?.unemployment ?? 0) > 0.06 ? 2.5 : 0.8),
    options: [
      { label: 'Back the Builders', description: 'Cheap loans and free land. Jobs now, and prices rise a little.', effects: [{ type: 'people', key: 'unemployment', amount: -0.02 }, { type: 'bank', key: 'inflation', amount: 1.5 }, { type: 'stability', amount: 3 }] },
      { label: 'Keep It Orderly', description: 'Plan it slowly. Nothing much changes.', effects: [{ type: 'resource', key: 'pp', amount: 8 }] },
    ],
  },
  {
    id: 'pension_crisis',
    title: 'The Pension Crisis',
    text: 'Actuaries warn that the pension fund will be empty within a decade unless something changes.',
    tone: 'crisis',
    weight: (s, id) => ((s.nations[id].spending?.pensions ?? 1) >= 2 ? 3 : 0.4),
    options: [
      { label: 'Top Up the Fund', description: 'Pay in now to keep the promise.', effects: [{ type: 'resource', key: 'capital', amount: -30, perWorkforce: -3 }, { type: 'stability', amount: 2 }] },
      { label: 'Raise the Retirement Age', description: 'Save the money. The old are furious.', effects: [{ type: 'stability', amount: -7 }, { type: 'resource', key: 'pp', amount: -8 }] },
    ],
  },
  {
    id: 'refugee_wave',
    title: 'Refugees at the Border',
    text: 'War next door has driven thousands to your border with {rival}. They ask to be let in.',
    tone: 'crisis',
    needsRival: true,
    rivalCandidates: (s, id) =>
      Object.values(s.nations)
        .filter((n) => n.alive && n.id !== id && enemiesOf(s, n.id).length > 0)
        .map((n) => n.id)
        .sort(),
    weight: (s, id) => (Object.values(s.nations).some((n) => n.alive && n.id !== id && enemiesOf(s, n.id).length > 0) ? 1.2 : 0),
    options: [
      { label: 'Open the Gates', description: 'Shelter them. More workers in time, some unease now, and goodwill abroad.', effects: [{ type: 'people', key: 'unemployment', amount: 0.015 }, { type: 'stability', amount: -3 }, { type: 'opinion', amount: 10, label: 'Sheltered our people' }] },
      { label: 'Close the Border', description: 'Turn them away. Calm at home, scorn abroad.', effects: [{ type: 'stability', amount: 2 }, { type: 'opinion', amount: -10, label: 'Turned our people away' }] },
    ],
  },
  {
    id: 'currency_attack',
    title: 'Speculators Attack the Currency',
    text: 'Foreign funds are betting against your money. It is falling by the hour.',
    tone: 'crisis',
    weight: (s, id) => ((s.nations[id].bank?.inflation ?? 2) > 6 || (s.nations[id].bank?.currency ?? 1) < 0.9 ? 3 : 0.3),
    options: [
      { label: 'Defend It', description: 'Sell reserves and raise rates. It holds, at a price.', effects: [{ type: 'resource', key: 'capital', amount: -25, perWorkforce: -3 }, { type: 'bank', key: 'currency', amount: 0.05 }] },
      { label: 'Let It Fall', description: 'Cheaper exports, dearer imports, and prices climb.', effects: [{ type: 'bank', key: 'currency', amount: -0.12 }, { type: 'bank', key: 'inflation', amount: 2 }] },
    ],
  },
  {
    id: 'council_deadlock',
    title: 'Deadlock at the Council',
    text: 'The World Council is paralysed. Delegates say only {nation} can break the stalemate, for a price.',
    tone: 'opportunity',
    weight: (s, id) => ((s.nations[id].tier ?? 1) >= 4 ? 2 : 0),
    options: [
      { label: 'Broker a Deal', description: 'Spend influence to lead. Your reputation improves.', effects: [{ type: 'resource', key: 'pp', amount: -20 }, { type: 'stability', amount: 2 }] },
      { label: 'Stay Aloof', description: 'Let them squabble. Nothing changes.', effects: [{ type: 'resource', key: 'pp', amount: 5 }] },
    ],
  },
  {
    id: 'project_collapse',
    title: 'Overruns on the Grand Project',
    text: 'Your national project is over budget and behind schedule. The contractors want more money.',
    tone: 'crisis',
    weight: (s, id) => (Object.values(s.nations[id].projects ?? {}).some((p) => p && !p.done) ? 2 : 0),
    options: [
      { label: 'Pay the Overrun', description: 'Pay up and keep the work going.', effects: [{ type: 'resource', key: 'capital', amount: -40, perWorkforce: -3 }] },
      { label: 'Renegotiate', description: 'Hold firm. The work slips by months.', effects: [{ type: 'projectProgress', months: -3 }] },
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
        description: 'Business as usual. The population suffers, and the fever may spread into an epidemic.',
        effects: [{ type: 'popLoss', fraction: 0.03 }, { type: 'stability', amount: -10 }, { type: 'epidemic', severity: 0.3 }],
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
