import { useGame, type GovSection } from '../../../store'

export type { GovSection }

/** Opens the Government tab on one section (a link from People, Space or Budget to where a number is explained). */
export function openGovernment(section: GovSection) {
  useGame.getState().goTo({ desk: 'economy', tab: 'government', gov: section })
}
