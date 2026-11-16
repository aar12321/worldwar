import { useEffect, useState } from 'react'
import { turnDate } from '../engine/helpers'
import { describeOrder } from '../engine/resolveTurn'
import { getWorld } from '../map/world'
import { useGame } from '../store'

/**
 * Says what just happened for people who cannot see it: a new month, an order given or taken back, something undone.
 * One quiet live region for the whole game, so screen readers hear these once and in order. Toasts have their own.
 */
export function Announcer() {
  const [message, setMessage] = useState('')
  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | undefined
    const say = (text: string) => {
      setMessage(text)
      clearTimeout(clear)
      clear = setTimeout(() => setMessage(''), 4000)
    }
    const unsub = useGame.subscribe((st, prev) => {
      const g = st.game
      if (!g || !prev.game) return
      if (g.turn !== prev.game.turn) say(`${turnDate(g.turn)} has begun.`)
      else if (st.orders.length > prev.orders.length) {
        const o = st.orders[st.orders.length - 1]
        say(`Order queued for the next turn: ${describeOrder(g, getWorld().map, o)}.`)
      } else if (st.orders.length < prev.orders.length) say('Order cancelled.')
      else if (st.undoStack.length > prev.undoStack.length) say(`Done: ${st.undoStack[st.undoStack.length - 1].label}. Press Control Z to undo.`)
    })
    return () => {
      unsub()
      clearTimeout(clear)
    }
  }, [])
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  )
}
