/**
 * Small shared building blocks for panels. Use these instead of writing a new one-off, so every desk looks, feels
 * and works the same: an empty state, a loading skeleton, a number stepper, a cost and effect row, a confirmed action,
 * a jargon term with its explanation, and a number that ticks when it changes. See docs/UX.md ("Building a panel").
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useGame } from '../store'
import { Tip } from './bits'
import { TERMS } from './Help'

// --- Empty and loading states -----------------------------------------------------------------------------------------

/** What a list or tab shows when there is nothing to show: say why, and what to do next. */
export function EmptyState({ title, body, action, compact = false }: { title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`} role="status">
      <div className="empty-mark" aria-hidden />
      <div className="text-[15px] font-semibold">{title}</div>
      {body && <p className="text-[13px] text-white/70 max-w-sm">{body}</p>}
      {action}
    </div>
  )
}

/** Grey bars where text will be, while a tab or list loads. Same height as the real thing, so nothing jumps. */
export function Skeleton({ lines = 4, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`} role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton h-[18px]" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  )
}

// --- Number stepper ---------------------------------------------------------------------------------------------------

const clampTo = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * A quantity picker: type a number, press - and + (hold to repeat), drag the slider or press Max.
 * It never lets the value leave `min` to `max`, and says why when the maximum is lower than you might expect.
 */
export function NumberStepper({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  unit,
  hint,
  quick,
  slider = true,
  disabled = false,
  format = (n) => String(n),
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max: number
  step?: number
  /** Shown after the number: "missiles", "levels". */
  unit?: string
  /** One line under the control, e.g. what limits the maximum. */
  hint?: ReactNode
  /** Buttons that jump to a value: [1, 5, 10]. */
  quick?: number[]
  slider?: boolean
  disabled?: boolean
  format?: (n: number) => string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  })
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const byPointer = useRef(false)
  const hi = Math.max(min, max)
  const set = (v: number) => {
    const next = clampTo(Math.round(v / step) * step, min, hi)
    if (next !== latest.current) onChange(next)
  }
  const stop = () => clearTimeout(holdTimer.current)
  useEffect(() => stop, [])
  const bump = (dir: 1 | -1, mult = 1) => set(latest.current + dir * step * mult)
  const hold = (dir: 1 | -1) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
      byPointer.current = true
      bump(dir)
      let n = 0
      const tick = () => {
        bump(dir, n > 10 ? 5 : 1)
        n++
        holdTimer.current = setTimeout(tick, n > 6 ? 45 : 100)
      }
      holdTimer.current = setTimeout(tick, 380)
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: () => {
      // A press already did its work on pointer down; a keyboard or screen reader "click" does it here.
      if (byPointer.current) byPointer.current = false
      else bump(dir)
    },
  })
  const commit = () => {
    if (draft === null) return
    const n = Number(draft.replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(n) && draft.trim() !== '') set(n)
    setDraft(null)
  }
  return (
    <div className="stepper" role="group" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn stepper-btn" aria-label={`Less ${label}`} disabled={disabled || value <= min} {...hold(-1)}>
          &minus;
        </button>
        <input
          className="field stepper-input tabular-nums"
          role="spinbutton"
          inputMode="numeric"
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={hi}
          aria-valuenow={value}
          disabled={disabled}
          value={draft ?? format(value)}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape' && draft !== null) {
              e.stopPropagation()
              setDraft(null)
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              bump(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1)
            }
          }}
        />
        <button type="button" className="btn stepper-btn" aria-label={`More ${label}`} disabled={disabled || value >= hi} {...hold(1)}>
          +
        </button>
        {unit && <span className="text-[13px] text-white/70">{unit}</span>}
        <button type="button" className="btn btn-quiet" disabled={disabled || value >= hi} onClick={() => set(hi)} title={`Set to the most you can: ${format(hi)}`}>
          Max
        </button>
        {quick?.map((q) => (
          <button key={q} type="button" className="btn btn-quiet" disabled={disabled || q > hi || q < min} aria-pressed={value === q} onClick={() => set(q)}>
            {q}
          </button>
        ))}
      </div>
      {slider && hi > min && (
        <input type="range" className="w-full mt-2" aria-label={`${label} slider`} min={min} max={hi} step={step} value={clampTo(value, min, hi)} disabled={disabled} onChange={(e) => set(+e.target.value)} />
      )}
      {hint && <div className="text-[12px] text-white/65 mt-1">{hint}</div>}
    </div>
  )
}

// --- Cost and effect ---------------------------------------------------------------------------------------------------

export interface CostPart {
  label: string
  amount: number
  /** What you have; the cost turns red and says so when it is more. */
  have?: number
}

/**
 * What something costs and what it does, side by side, before you commit. Costs you cannot pay turn red and are written out,
 * so the answer never depends on color alone.
 */
export function CostEffect({ costs, effects, time, why }: { costs: CostPart[]; effects?: ReactNode[]; time?: string; why?: string | null }) {
  return (
    <div className="cost-row" role="group" aria-label="Cost and effect">
      <div className="cost-col">
        <div className="label">Cost</div>
        {costs.length === 0 && <div className="text-[14px] font-semibold">Free</div>}
        {costs.map((c) => {
          const short = c.have !== undefined && c.amount > c.have
          return (
            <div key={c.label} className={`text-[14px] font-semibold tabular-nums ${short ? 'text-[#ff8a84]' : ''}`}>
              {Math.round(c.amount).toLocaleString()} {c.label}
              {short && <span className="text-[12px] font-medium"> (you have {Math.round(c.have as number).toLocaleString()})</span>}
            </div>
          )
        })}
        {time && <div className="text-[12px] text-white/65">{time}</div>}
      </div>
      <div className="cost-col">
        <div className="label">Effect</div>
        {why ? (
          <div className="text-[13px] text-[#ffd60a]">{why}</div>
        ) : (
          (effects ?? []).map((e, i) => (
            <div key={i} className="text-[13px] text-white/85">
              {e}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// --- Confirmed action --------------------------------------------------------------------------------------------------

/**
 * A button for something big or hard to take back. It asks first (what it costs and why it matters), and once it has run it
 * says so and offers Undo when the game can take it back (an order that took effect at once) or Cancel (an order waiting for the month to end).
 */
export function ConfirmButton({
  label,
  title,
  text,
  confirmLabel,
  danger = false,
  onConfirm,
  className = '',
  disabled = false,
  skipAsking = false,
}: {
  label: ReactNode
  title: string
  text: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  className?: string
  disabled?: boolean
  /** Runs at once, without the question, for cheap cases. The undo toast still shows. */
  skipAsking?: boolean
}) {
  const askConfirm = useGame((s) => s.askConfirm)
  const run = () => runWithUndo(title, onConfirm)
  return (
    <button className={`btn ${danger ? 'btn-red' : 'btn-primary'} ${className}`} disabled={disabled} onClick={() => (skipAsking ? run() : askConfirm({ title, text, label: confirmLabel, danger, run }))}>
      {label}
    </button>
  )
}

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

// --- Jargon --------------------------------------------------------------------------------------------------------------

/** A word the game explains: hover, focus or tap it for the meaning. The text comes from the glossary in the help window. */
export function Term({ word, children, text }: { word: string; children?: ReactNode; text?: string }) {
  const meaning = text ?? TERMS.find(([t]) => t.toLowerCase() === word.toLowerCase())?.[1]
  if (!meaning) return <>{children ?? word}</>
  return <Tip text={meaning}>{children ?? word}</Tip>
}

/** A small "i" that opens an explanation, for labels that are not words you can underline. */
export function InfoTip({ text, label = 'More about this' }: { text: string; label?: string }) {
  return (
    <Tip text={text}>
      <span className="info-dot" role="img" aria-label={label}>
        i
      </span>
    </Tip>
  )
}

// --- A number that ticks -------------------------------------------------------------------------------------------------

/**
 * A number that flashes when it changes: green for up, red for down (or the other way round when down is good), with the
 * sign shown too, so color is never the only cue. It does not move anything around, so lists do not jump.
 */
export function Ticker({ value, format = (v) => Math.round(v).toLocaleString(), upIs = 'good', className = '' }: { value: number; format?: (v: number) => string; upIs?: 'good' | 'bad' | 'neutral'; className?: string }) {
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; n: number } | null>(null)
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current === value) return
    const dir = value > prev.current ? 'up' : 'down'
    prev.current = value
    setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }))
    const t = setTimeout(() => setFlash(null), 900)
    return () => clearTimeout(t)
  }, [value])
  const tone = !flash || upIs === 'neutral' ? '' : (flash.dir === 'up') === (upIs === 'good') ? 'tick-good' : 'tick-bad'
  return (
    <span key={flash?.n ?? 0} className={`tabular-nums ${tone} ${className}`}>
      {format(value)}
      {flash && <span className="sr-only">{flash.dir === 'up' ? ' (went up)' : ' (went down)'}</span>}
    </span>
  )
}

/** A visually hidden message that screen readers announce. */
export function Announce({ message }: { message: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  )
}
