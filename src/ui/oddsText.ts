import type { CallOutlook } from '../ai/blocs'
import type { OfferOutlook } from '../ai/diplomat'

/** Colours for a verdict, as everywhere on the desks. */
export const TONE_TEXT = { good: 'text-[#6eeb8a]', warn: 'text-[#ffd60a]', bad: 'text-[#ff8a84]', none: 'text-white/60' } as const
export type OddsTone = keyof typeof TONE_TEXT

/** A chance as a percentage that never reads 0% or 100% while the dice still decide. */
export const chanceText = (c: number) => `${Math.min(99, Math.max(1, Math.round(c * 100)))}%`

/** The verdict in words and its colour: "Likely to accept", "May join (40%)", "Your friend decides". */
export function verdictOf(outlook: OfferOutlook['outlook'] | CallOutlook['outlook'], chance: number, verb: 'accept' | 'join'): { text: string; tone: OddsTone } {
  switch (outlook) {
    case 'likely':
      return { text: `Likely to ${verb}`, tone: 'good' }
    case 'unsure':
      return { text: `May ${verb} (${chanceText(chance)})`, tone: 'warn' }
    case 'unlikely':
      return { text: `Unlikely to ${verb}`, tone: 'bad' }
    case 'human':
      return { text: 'Your friend decides', tone: 'none' }
  }
}
