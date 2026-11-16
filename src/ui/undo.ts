import { useGame } from '../store'

/** Runs something that issues orders, then offers Undo (done at once) or Cancel (queued for the month end) in a toast. */
export function runWithUndo(what: string, fn: () => void): void {
  const before = useGame.getState()
  const undos = before.undoStack.length
  const queued = before.orders.length
  fn()
  const st = useGame.getState()
  if (st.undoStack.length > undos) st.toast(`Done: ${what}`, 'success', 6000, { label: 'Undo', run: () => useGame.getState().undo() })
  else if (st.orders.length > queued) {
    const index = st.orders.length - 1
    st.toast(`Queued: ${what}`, 'info', 6000, { label: 'Cancel', run: () => useGame.getState().removeOrder(index) })
  }
}
