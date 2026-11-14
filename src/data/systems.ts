export type SystemId = 'cyber' | 'shield' | 'ai' | 'quantum' | 'orbital' | 'nano'

export const SYSTEM_IDS: SystemId[] = ['cyber', 'shield', 'ai', 'quantum', 'orbital', 'nano']

export const SYSTEM_MAX = 3

export interface SystemSpec {
  name: string
  /** The technology that unlocks it. */
  tech: string
  role: string
  /** What each level adds. */
  levels: [string, string, string]
  /** What beats it, or what it beats. */
  counter: string
  /** Money for level 1. Each next level costs this much more again. */
  baseCost: number
  /** Money every month for each level. */
  upkeep: number
}

export const SYSTEM_SPECS: Record<SystemId, SystemSpec> = {
  cyber: {
    name: 'Cyber Command',
    tech: 'cyber_warfare',
    role: 'Hackers in uniform. In battle, a higher level than the enemy jams their drones and robots. At home it shields you from cyber attacks and spies.',
    levels: ['Jams enemy drones and robots 10% (needs a higher level than theirs). Cyber attacks on you do 20% less. +4% to your operations.', '20% jamming, 40% less cyber damage, +8% to operations.', '30% jamming, 60% less cyber damage, +12% to operations.'],
    counter: 'Beaten by a Cyber Command of equal or higher level. Does nothing against tanks, planes and soldiers.',
    baseCost: 80,
    upkeep: 2,
  },
  shield: {
    name: 'Interceptor Shield',
    tech: 'frontier_missile_defense',
    role: 'Batteries that shoot down what flies. They stop a share of every hypersonic and drone attack on you, a little of the bomber damage, and strikes from space.',
    levels: ['Stops 20% of missiles, drones and strikes.', 'Stops 35%.', 'Stops 50%.'],
    counter: 'Does nothing against tanks, soldiers and warships. A big salvo still gets through.',
    baseCost: 120,
    upkeep: 3,
  },
  ai: {
    name: 'AI Battle Command',
    tech: 'frontier_ai',
    role: 'Software that plans, predicts and runs your campaigns. More attacks a month, exact battle forecasts, a better combined-arms bonus and advice on how to fight.',
    levels: ['+1 attack a month. Combined arms +5%. Exact odds in the War Room.', '+2 attacks. Combined arms +10%. Recommends the best stance.', '+3 attacks. Combined arms +15%. Recommends the best force size too.'],
    counter: 'Only helps you command. It does not make units stronger one by one, so it matters most with a big, mixed army.',
    baseCost: 100,
    upkeep: 2,
  },
  quantum: {
    name: 'Quantum Codebreaking',
    tech: 'frontier_quantum',
    role: 'Reads enemy secrets. You see which of your countries an enemy could take next month, and spies and saboteurs find it harder to work against you.',
    levels: ['Threat warnings in the Briefing. +5% to your operations. -5% against you.', 'More detail, +10% / -10%.', 'Full picture of every front, +15% / -15%.'],
    counter: 'Only information: it cannot stop an army by itself. An enemy with higher Cyber Command can mask what it plans.',
    baseCost: 120,
    upkeep: 3,
  },
  orbital: {
    name: 'Orbital Network',
    tech: 'frontier_space',
    role: 'Satellites that see everything and a weapon that hits anywhere. Permanent intelligence on your enemies, easier landings from sea and air, and a once-a-year orbital strike.',
    levels: ['See every enemy at war with you. Landings lose 7% less strength. One strike a year.', 'Landings lose 14% less. Strikes hit harder.', 'Landings lose 21% less. Strikes hit hardest.'],
    counter: 'An Interceptor Shield stops a share of the strike. The strike itself comes once a year and costs influence and reputation.',
    baseCost: 200,
    upkeep: 4,
  },
  nano: {
    name: 'Nano-armor and Nano-medicine',
    tech: 'frontier_nano',
    role: 'Materials and medicine built atom by atom. Your units take less damage, part of what you lose comes back, and your people are calmer.',
    levels: ['Units take 8% less damage. 15% of losses come back. Stability +2.', '15% less damage. 30% come back. Stability +4.', '22% less damage. 45% come back. Stability +6.'],
    counter: 'Does not stop a strike on the Defense Line, and armor does not help against a hacked robot or a shot-down drone.',
    baseCost: 150,
    upkeep: 3,
  },
}

export const systemCost = (id: SystemId, level: number) => SYSTEM_SPECS[id].baseCost * (level + 1)

export function systemsCost(id: SystemId, level: number, levels: number): number {
  let total = 0
  for (let i = 0; i < levels; i++) total += systemCost(id, level + i)
  return total
}

/** Share of missiles, drones and strikes the Interceptor Shield stops, by level. */
export const SHIELD_STOPS = [0, 0.2, 0.35, 0.5]
/** Share of enemy drones and robots a Cyber Command jams, for each level it is ahead. */
export const CYBER_JAM_PER_LEVEL = 0.1
export const CYBER_JAM_MAX = 0.3
/** Damage a nation's units take less, and the share of its losses that come back. */
export const NANO_LESS_DAMAGE = [0, 0.08, 0.15, 0.22]
export const NANO_REVIVE = [0, 0.15, 0.3, 0.45]

/** Rules for the new weapons. */
export const FRONTIER = {
  /** Drones hit tanks and guns harder, up to this much extra when the enemy army is all heavy. */
  droneVsHeavy: 0.5,
  /** Drones fly at this share of their strength against enemy fighters that outmatch them, and this share when only present. */
  droneVsFighters: 0.7,
  droneVsFightersWeak: 0.85,
  /** Defense Line each hypersonic battery cuts in every attack it joins, before the shield. */
  missileLine: 0.35,
  /** Hypersonic strike from afar. */
  strikeKm: 6000,
  strikeLine: 0.6,
  strikeLineMax: 8,
  /** Launch cost of a strike, whatever the number of missiles. The missiles themselves are used up. */
  strikeMoney: 15,
  strikeFactoryTurns: 2,
  /** Orbital strike once every this many months. */
  orbitalCooldown: 12,
  orbitalMoney: 100,
  orbitalPP: 25,
  orbitalLine: 4,
  orbitalLinePerLevel: 2,
  orbitalInfamy: 8,
  /** Share of an attacker's amphibious penalty an Orbital Network takes off, per level. */
  orbitalLanding: 0.07,
  /** Stability each Nano level adds. */
  nanoStability: 2,
  /** Odds Quantum and Cyber add to operations, per level. */
  quantumOps: 0.05,
  cyberOps: 0.04,
  cyberDefense: 0.2,
}
