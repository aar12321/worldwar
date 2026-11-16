import { useEffect, useRef } from 'react'
import { useGame } from '../store'
import { EASE, TIMING, lerp } from './timing'

/**
 * A number that counts to its new value instead of jumping (casualties, damage, money). It writes straight into the element, so a
 * counting number re-renders nothing. With reduced motion it simply shows the value.
 */
export function Ticker({ value, format = (v: number) => v.toFixed(1), ms = TIMING.ticker, className }: { value: number; format?: (v: number) => string; ms?: number; className?: string }) {
  const el = useRef<HTMLSpanElement>(null)
  const shown = useRef(value)
  const reduced = useGame((s) => s.settings.reducedMotion)
  const fmt = useRef(format)
  fmt.current = format
  useEffect(() => {
    const node = el.current
    if (!node) return
    if (reduced || ms <= 0 || typeof requestAnimationFrame === 'undefined') {
      shown.current = value
      node.textContent = fmt.current(value)
      return
    }
    const from = shown.current
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      shown.current = lerp(from, value, EASE.outCubic(t))
      node.textContent = fmt.current(shown.current)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms, reduced])
  return (
    <span ref={el} className={className}>
      {format(value)}
    </span>
  )
}
