import { useSyncExternalStore } from 'react'
import { useGame } from '../store'

/** The sections of the Missile Program tab (the segmented control at its top). */
export type ProgramSection = 'overview' | 'facilities' | 'staff' | 'development' | 'arsenal' | 'rivals'

export const PROGRAM_SECTIONS: readonly (readonly [ProgramSection, string])[] = [
  ['overview', 'Overview'],
  ['facilities', 'Facilities'],
  ['staff', 'Staff'],
  ['development', 'Development'],
  ['arsenal', 'Arsenal'],
  ['rivals', 'Rivals'],
]

export const isProgramSection = (v: unknown): v is ProgramSection => PROGRAM_SECTIONS.some(([id]) => id === v)

/** The section last open, so coming back to the tab lands where the player left it, and other screens can link to a section. */
let current: ProgramSection = 'overview'
const listeners = new Set<() => void>()

export function setProgramSection(s: ProgramSection) {
  if (s === current) return
  current = s
  for (const l of listeners) l()
}

/** The open section; the tab re-renders when a link elsewhere changes it. */
export function useProgramSection(): ProgramSection {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

/** Opens Military, Missile Program on one section (a link from Missile War, Systems or the advisor to where a thing is done). */
export function openProgram(section?: ProgramSection) {
  if (section) setProgramSection(section)
  useGame.getState().openMilitary('program')
}
