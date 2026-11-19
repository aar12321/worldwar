import { useGame } from '../../../store'

/** The sections of the Government tab. */
export type GovSection = 'command' | 'cabinet' | 'talent' | 'jobs' | 'policies' | 'groups' | 'constitution'

/** The section last open, so coming back to the tab lands where the player left it, and other tabs can link to a section. */
export const govSection: { current: GovSection } = { current: 'command' }

/** Opens the Government tab on one section (a link from People, Space or Budget to where a number is explained). */
export function openGovernment(section: GovSection) {
  govSection.current = section
  useGame.getState().openTab('economy', 'government')
}
