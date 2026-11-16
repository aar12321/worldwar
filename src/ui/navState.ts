import { create } from 'zustand'
import { useGame, type GameStore } from '../store'
import { regCtxOf } from './regCtx'
import { currentTab, visibleTabs, type TabMemory } from './registry'

/**
 * Back and last-tab memory for the desks. Nothing here changes how a desk opens: it watches the store, so any code that
 * opens a desk or a tab (a button, the advisor, the jump window, another agent's new desk) is remembered the same way.
 */
export interface Loc {
  panel: string
  tab?: string
}

const HISTORY_LIMIT = 20

export const useNav = create<{ stack: Loc[] }>(() => ({ stack: [] }))

const memory = (st: GameStore): TabMemory => ({ economyTab: st.economyTab, militaryTab: st.militaryTab, empireTab: st.empireTab, deskTabs: st.deskTabs })
export const locOf = (st: GameStore): Loc => (st.panel === 'none' ? { panel: 'none' } : { panel: st.panel, tab: currentTab(memory(st), st.panel) })
const same = (a: Loc, b: Loc) => a.panel === b.panel && a.tab === b.tab

let navigating = false
let installed = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Goes back to the desk and tab you were on before. */
export function goBack(): boolean {
  const stack = useNav.getState().stack
  const to = stack[stack.length - 1]
  if (!to) return false
  navigating = true
  try {
    useGame.getState().openTab(to.panel, to.tab)
  } finally {
    navigating = false
  }
  useNav.setState({ stack: stack.slice(0, -1) })
  return true
}

/** Opens the tab the player left each desk on in their last session, when it still exists in this kind of game. */
function restoreLastTabs(st: GameStore) {
  const remembered = st.settings.ui.lastTabs
  const ctx = regCtxOf(st.game, st.orders)
  for (const [desk, tab] of Object.entries(remembered)) {
    if (visibleTabs(desk, ctx).some((t) => t.id === tab)) st.setDeskTab(desk, tab)
  }
}

/** Starts watching. Safe to call more than once. */
export function installNav(): void {
  if (installed) return
  installed = true
  useGame.subscribe((st, prev) => {
    if (st.game && !prev.game) restoreLastTabs(st)
    if (st.panel === prev.panel && st.economyTab === prev.economyTab && st.militaryTab === prev.militaryTab && st.empireTab === prev.empireTab && st.deskTabs === prev.deskTabs) return
    if (!st.game) return
    const to = locOf(st)
    if (to.panel === 'none') {
      if (useNav.getState().stack.length) useNav.setState({ stack: [] })
      return
    }
    // Remember the tab this desk is on, a moment after the last change.
    if (to.tab) {
      const { panel, tab } = to
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        const s = useGame.getState()
        if (s.settings.ui.lastTabs[panel] !== tab) s.updatePrefs({ lastTabs: { ...s.settings.ui.lastTabs, [panel]: tab } })
      }, 600)
    }
    if (navigating) return
    const from = locOf(prev)
    if (from.panel === 'none' || same(from, to)) return
    const stack = useNav.getState().stack
    if (stack.length && same(stack[stack.length - 1], from)) return
    useNav.setState({ stack: [...stack, from].slice(-HISTORY_LIMIT) })
  })
}
