import type { MapRegion } from '../engine/types'
import type { PolicyEffects } from './government'
import { OIL_DEPOSITS, STEEL_DEPOSITS } from './deposits'

export type TraitId = 'chips' | 'finance' | 'energy' | 'minerals' | 'shipyards' | 'farmland' | 'manpower' | 'fortress' | 'research' | 'trade_hub' | 'heavy' | 'culture'

export interface TraitSpec {
  name: string
  blurb: string
  /** What holding the country gives the whole nation. Scaled by how settled the country is. */
  effects: Partial<PolicyEffects>
  /** Extra Defense Line for this country itself. */
  line?: number
}

export const TRAITS: Record<TraitId, TraitSpec> = {
  chips: { name: 'Chip foundries', blurb: 'Makes the processors everyone needs. Research and factories gain.', effects: { research: 0.06, factory: 0.04 } },
  finance: { name: 'Financial hub', blurb: 'Banks, exchanges and insurers. More income, faster business growth, more trade.', effects: { money: 0.02, growth: 0.06, trade: 0.1 } },
  energy: { name: 'Energy giant', blurb: 'Oil, gas and power. Cheap energy lifts output and factories.', effects: { output: 0.03, factory: 0.03 } },
  minerals: { name: 'Rare minerals', blurb: 'Mines for the metals modern industry runs on. Factories gain.', effects: { factory: 0.05, output: 0.01 } },
  shipyards: { name: 'Shipyards and ports', blurb: 'Great harbors. Trade capacity and factories gain.', effects: { trade: 0.12, factory: 0.02 } },
  farmland: { name: 'Breadbasket', blurb: 'Rich farmland. People eat less of your reserves and stay calmer.', effects: { foodUse: -0.05, stability: 1, output: 0.01 } },
  manpower: { name: 'Young population', blurb: 'Many young workers and recruits. Influence and output gain a little.', effects: { influence: 0.2, output: 0.015 } },
  fortress: { name: 'Mountain stronghold', blurb: 'Hard ground to take. Its Defense Line is much longer.', effects: { stability: 1 }, line: 1.2 },
  research: { name: 'Research hub', blurb: 'Universities and labs. Research and business growth gain.', effects: { research: 0.08, growth: 0.03 } },
  trade_hub: { name: 'Crossroads of trade', blurb: 'Where routes meet. Much more room to trade, and a little income.', effects: { trade: 0.18, money: 0.01 } },
  heavy: { name: 'Heavy industry', blurb: 'Steel, machines and big factories. Factory output gains strongly.', effects: { factory: 0.08 } },
  culture: { name: 'Soft power', blurb: 'Famous culture and tourism. More influence, calmer people.', effects: { influence: 0.4, stability: 1 } },
}

/** Hand-picked for the countries people know. */
const KNOWN: Record<string, TraitId> = {
  'united-states-of-america': 'finance', china: 'heavy', taiwan: 'chips', 'south-korea': 'chips', japan: 'research', germany: 'heavy',
  'united-kingdom': 'finance', france: 'culture', switzerland: 'finance', singapore: 'trade_hub', netherlands: 'trade_hub',
  'saudi-arabia': 'energy', kuwait: 'energy', qatar: 'energy', 'united-arab-emirates': 'finance', russia: 'energy', iran: 'energy', iraq: 'energy',
  norway: 'energy', canada: 'minerals', australia: 'minerals', brazil: 'farmland', argentina: 'farmland', ukraine: 'farmland',
  india: 'research', indonesia: 'manpower', nigeria: 'manpower', pakistan: 'manpower', bangladesh: 'manpower', egypt: 'trade_hub',
  panama: 'trade_hub', turkey: 'trade_hub', italy: 'culture', spain: 'culture', greece: 'shipyards', denmark: 'shipyards', israel: 'research',
  sweden: 'research', finland: 'research', 'south-africa': 'minerals', 'democratic-republic-of-the-congo': 'minerals', chile: 'minerals',
  peru: 'minerals', mongolia: 'minerals', afghanistan: 'fortress', nepal: 'fortress', vietnam: 'manpower', thailand: 'culture', mexico: 'manpower',
  'new-zealand': 'farmland', ireland: 'finance', poland: 'heavy', 'czech-republic': 'heavy', 'saudi arabia': 'energy', kazakhstan: 'energy',
  venezuela: 'energy', libya: 'energy', algeria: 'energy', 'north-korea': 'fortress', cuba: 'culture', 'hong-kong': 'finance',
}

/** The country's trait. Well-known countries have their own; the rest follow from what the land is like. */
export function traitOf(id: string, region?: MapRegion): TraitId {
  const known = KNOWN[id]
  if (known) return known
  if ((OIL_DEPOSITS[id] ?? 0) >= 3) return 'energy'
  if ((STEEL_DEPOSITS[id] ?? 0) >= 70) return 'minerals'
  if (region) {
    if (region.development > 0.75) return 'research'
    if (region.terrain === 'mountain') return 'fortress'
    if (region.coastal && region.development > 0.5) return 'shipyards'
    if (region.basePopulation > 40) return 'manpower'
    if ((region.terrain === 'plains' || region.terrain === 'forest') && region.development < 0.5) return 'farmland'
  }
  return 'culture'
}
