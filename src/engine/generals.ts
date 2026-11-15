import type { GeneralTrait, Nation } from './types'

/** The trait of the nation's commander, if it has one. */
export function commanderTrait(n: Pick<Nation, 'generals' | 'military'> | undefined): GeneralTrait | null {
  if (!n?.military?.commanderId) return null
  return n.generals?.find((g) => g.id === n.military.commanderId)?.trait ?? null
}
