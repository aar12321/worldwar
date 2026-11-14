import { useEffect } from 'react'
import { LIVE } from '../data/live'
import { clockOf, isLive } from '../engine/calendar'
import { liveHold, useGame } from '../store'

type Listener = (t: number) => void

/**
 * The live game's time as the screen sees it: the day, plus how far through it we are. Armies are drawn from this, so they
 * glide between day ticks. It lives outside React on purpose: it changes every frame and nothing re-renders for it.
 */
export const liveClock = {
  /** Absolute days, with a fraction. */
  t: 0,
  /** How far through the current day, from 0 to 1. */
  fraction: 0,
  listeners: new Set<Listener>(),
  set(t: number, fraction: number) {
    this.t = t
    this.fraction = fraction
    for (const fn of this.listeners) fn(t)
  },
  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  },
}

/** Runs the clock of a live single-player game. It is the only thing that moves time: one loop, one source. */
export function useLiveClock(active: boolean) {
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const frame = (now: number) => {
      // A tab that was hidden or a slow frame never makes the game race to catch up.
      const dt = Math.min(250, now - last)
      last = now
      let st = useGame.getState()
      if (st.game && isLive(st.game)) {
        if (st.running && !liveHold(st)) {
          acc += dt * st.settings.liveSpeed
          let steps = 0
          while (acc >= LIVE.msPerDay && steps < LIVE.maxCatchUpDays) {
            st.stepDay()
            acc -= LIVE.msPerDay
            steps++
            st = useGame.getState()
            if (!st.running || liveHold(st)) break
          }
          if (acc >= LIVE.msPerDay) acc = LIVE.msPerDay - 1
        }
        const game = st.game
        if (game) liveClock.set(clockOf(game) + Math.min(0.999, acc / LIVE.msPerDay), Math.min(0.999, acc / LIVE.msPerDay))
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [active])
}
