/**
 * The Superpower weapon: nuclear warheads. A nation of 25 countries that has the missile technology can build a handful of them over
 * months, and fire one at a country it is at war with. The strike wipes out the country's army and infrastructure, and the
 * world never forgives it. Everything about the weapon is here, so it can be tuned in one place.
 */
import type { Tier } from '../engine/types'

export const NUCLEAR = {
  /** The tier needed to build or fire a warhead: 4 is a Superpower. */
  tier: 4 as Tier,
  /** The technology the program rests on: the missiles that cross a continent. */
  tech: 'frontier_hypersonic',
  /** What one warhead costs, in money, steel and research. They are paid when the work begins. */
  money: 450,
  steel: 40,
  research: 60,
  /** Months one warhead takes to build, how many a nation may have under construction, and how many it may keep in store. */
  months: 4,
  inProgress: 1,
  maxStock: 4,
  /** Money each warhead in store costs every month: guards, upkeep and security. */
  upkeep: 1.5,
  /** Months a nation must wait between two launches, and the whole world's quiet after a bomb: no rival fires in this time. */
  cooldown: 3,
  worldQuiet: 18,
  /** Reach of the missile that carries it, in km from a country with a factory. Far enough for anywhere on Earth. */
  km: 20000,
  /** Days it flies in a live game before it lands. This is the warning. */
  flightDays: 5,
  /** The Interceptor Shield stops only a fraction: this much of its own rating, so a level 3 shield (50%) stops 25%. */
  intercept: 0.5,

  /** Share of the struck country's buildings destroyed, of its people killed, and how far its Defense Line falls (to the floor). */
  buildings: 1,
  people: 0.65,
  lineFloor: 0.5,
  /** Share of the victim's army that dies when it is the capital or a small nation, and when it is a part of a large one. */
  armyCore: 0.97,
  armyPart: 0.6,
  /** A nation holding this many countries or fewer loses its whole army to a strike on any of them. */
  smallNation: 3,
  /** Months the country's factories stop, and months of devastation: the output of the land stays crippled and heals slowly. */
  factoryMonths: 24,
  falloutMonths: 48,
  /** Share of normal output the land produces at the start of the devastation, and how fast it recovers each month after. */
  falloutOutput: 0.1,
  /** Rebels that rise in the ruins, and stability the struck nation loses. */
  rebels: 4,
  stability: 35,
  weariness: 20,

  /** What the world thinks of the one who fires it. */
  infamy: 60,
  /** Opinion every nation holds of the attacker, fading slowly: about eleven years. */
  opinion: -50,
  opinionDecay: 0.35,
  /** The victim's opinion is worse still, and fades slower. */
  victimOpinion: -60,
  victimDecay: 0.2,
  /** A spike in the world's tension that fades by this share each month. */
  tension: 38,
  tensionFade: 0.07,
  /** Months every nation that is not allied to the attacker cuts off its trade. */
  sanctionsMonths: 24,
  /** The strongest alliance blocs (or, failing that, nations) forced to declare war on the attacker. Easy rivals send only the first. */
  factions: 2,
  factionsEasy: 1,
  /** Months the reason for war stays open for the factions. */
  reasonMonths: 12,

  /** Rivals: only Hard ones fire, only when desperate or provoked, and never as often as this many months apart. */
  aiEvery: 36,
  /** A rival is desperate when its capital's line is under this share of its best, or its force is under this share of the foe's. */
  aiDesperateLine: 0.35,
  aiDesperatePower: 0.4,
  /** Money a rival keeps in hand while it builds one. */
  aiReserve: 700,
}

/** The parts of the warning a player sees before they commit, in the confirmation dialog. */
export const NUCLEAR_CONSEQUENCES: string[] = [
  'The country\'s army is destroyed and every building, factory and Defense Line there falls to almost nothing.',
  'About two thirds of its people die. Its output stays crippled for years and rebels rise in the ruins.',
  'An Interceptor Shield stops only part of it.',
  'Your reputation for aggression soars. Every nation holds you in deep and lasting contempt.',
  'The world\'s two strongest alliance blocs declare war on you, and trade with you is cut off by sanctions.',
  'World tension spikes. There is no taking it back.',
]

/** Share of its normal output a ruined country produces, given the months of devastation still to run (undefined or 0: all of it). */
export function falloutFactor(remaining: number | undefined): number {
  if (!remaining || remaining <= 0) return 1
  return NUCLEAR.falloutOutput + (1 - NUCLEAR.falloutOutput) * (1 - Math.min(1, remaining / NUCLEAR.falloutMonths))
}
