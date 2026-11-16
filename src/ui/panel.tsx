import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { validateOrder } from '../engine/orders'
import type { Order } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame, type Panel } from '../store'
import { tabBodies, useDeskTab } from './deskTab'
import { goBack, useNav } from './navState'
import { BackIcon, ChevronIcon, PinIcon } from './navIcons'
import { clampWidth, togglePinned } from './prefs'
import { crumbs, findDesk, pinId, visibleTabs } from './registry'
import { useRegCtx } from './regCtx'
import { EmptyState, Skeleton } from './widgets'
import { runWithUndo } from './undo'
import { usePlayerView } from './hooks'
import { speak } from './plain'
import { confirmFor } from './confirmRules'

/** Lets a desk's drawer be dragged wider or narrower; the width is remembered per desk. */
function useDrawerWidth(panel: string) {
  const stored = useGame((s) => s.settings.ui.panelWidths[panel])
  const updatePrefs = useGame((s) => s.updatePrefs)
  const ref = useRef<HTMLElement>(null)
  const apply = (w: number | null) => {
    const el = ref.current
    if (!el) return
    if (w === null) {
      el.style.removeProperty('--drawer-w')
      el.removeAttribute('data-sized')
    } else {
      el.style.setProperty('--drawer-w', `${w}px`)
      el.setAttribute('data-sized', '')
    }
  }
  const commit = (w: number | null) => {
    const widths = { ...useGame.getState().settings.ui.panelWidths }
    if (w === null) delete widths[panel]
    else widths[panel] = clampWidth(w)
    updatePrefs({ panelWidths: widths })
  }
  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    e.preventDefault()
    const startX = e.clientX
    const startW = el.getBoundingClientRect().width
    let w = startW
    const move = (ev: PointerEvent) => {
      w = clampWidth(startW + ev.clientX - startX)
      apply(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
      commit(w)
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = ref.current
    if (!el) return
    const now = el.getBoundingClientRect().width
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const w = clampWidth(now + (e.key === 'ArrowRight' ? 32 : -32))
      apply(w)
      commit(w)
    } else if (e.key === 'Home' || e.key === 'Enter') {
      e.preventDefault()
      apply(null)
      commit(null)
    }
  }
  const reset = () => {
    apply(null)
    commit(null)
  }
  return { ref, style: stored ? ({ '--drawer-w': `${stored}px` } as React.CSSProperties) : undefined, sized: stored !== undefined, handle: { onPointerDown, onKeyDown, onDoubleClick: reset } }
}

/** A side drawer. The header stays put and the body is the only part that scrolls. */
export function PanelShell({ title, kicker, panel, children, wide = false, tabs }: { title: string; kicker: string; panel: Panel; children: ReactNode; wide?: boolean; tabs?: ReactNode }) {
  const setPanel = useGame((s) => s.setPanel)
  const tab = useDeskTab(panel)
  const previous = useNav((s) => s.stack[s.stack.length - 1])
  const pinned = useGame((s) => s.settings.ui.pinned)
  const updatePrefs = useGame((s) => s.updatePrefs)
  const drawer = useDrawerWidth(panel)
  const hasTabs = !!findDesk(panel)?.tabs?.length
  const pin = pinId(panel, hasTabs ? tab : undefined)
  const isPinned = pinned.includes(pin)
  const where = crumbs(panel, hasTabs ? tab : undefined).join(' › ')
  const back = previous && previous.panel !== 'none' ? crumbs(previous.panel, previous.tab).join(' › ') : null
  // Focus moves into the desk when it opens and goes back to what had it when it closes, so the keyboard never gets lost.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const el = drawer.ref.current
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    return () => {
      if (document.activeElement === document.body || el?.contains(document.activeElement)) before?.focus?.({ preventScroll: true })
    }
    // Only on open and close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <motion.aside
      ref={drawer.ref}
      tabIndex={-1}
      data-section={panel}
      aria-label={title}
      data-sized={drawer.sized ? '' : undefined}
      style={drawer.style}
      className={`drawer surface ${wide ? 'drawer-wide' : ''}`}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.09 } }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="px-5 pt-4 pb-3 border-b border-white/10 flex-none space-y-3 drawer-head">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {back && (
              <button type="button" className="crumb-back" onClick={() => goBack()} title="Back (Alt+Left)" aria-label={`Back to ${back}`}>
                <BackIcon size={14} />
                <span className="truncate">{back}</span>
              </button>
            )}
            <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
            <p className="text-[14px] text-white/65 mt-0.5">{kicker}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              className={`icon-close pin-btn ${isPinned ? 'on' : ''}`}
              aria-pressed={isPinned}
              aria-label={isPinned ? `Unpin ${where}` : `Pin ${where}`}
              title={isPinned ? 'Unpin from the rail' : 'Pin to the rail for one-tap access'}
              onClick={() => updatePrefs({ pinned: togglePinned(useGame.getState().settings.ui.pinned, pin) })}
            >
              <PinIcon filled={isPinned} size={15} />
            </button>
            <button className="icon-close" aria-label="Close" title="Close (Esc)" onClick={() => setPanel(panel)}>
              ×
            </button>
          </div>
        </div>
        {tabs}
      </div>
      <div data-panel-body className="flex-1 min-h-0 overflow-y-auto scroll-thin p-5 space-y-5">
        {children}
      </div>
      <div className="drawer-grip" role="separator" aria-orientation="vertical" aria-label={`Resize the ${title} desk. Arrow keys change the width, Enter resets it.`} aria-valuenow={0} tabIndex={0} {...drawer.handle} title="Drag to resize. Double-click to reset." />
    </motion.aside>
  )
}

/**
 * Tabs inside a desk. Arrow keys, Home and End move between them; only the chosen tab is in the tab order. When there are more
 * tabs than fit, the chosen one scrolls into view, the edges fade, and small arrows scroll the bar.
 */
export function Tabs<T extends string>({ value, onChange, options, label = 'Tabs', badges }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; label?: string; badges?: Partial<Record<T, number | string | null>> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = () => {
    const el = ref.current
    if (el) setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    measure()
  }, [value])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const move = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? (i + 1) % options.length : e.key === 'ArrowLeft' ? (i - 1 + options.length) % options.length : e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    onChange(options[to][0])
    requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus())
  }
  const nudge = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * Math.max(120, ref.current.clientWidth * 0.6), behavior: 'smooth' })
  return (
    <div className={`segmented-wrap ${edges.left ? 'fade-left' : ''} ${edges.right ? 'fade-right' : ''}`}>
      {edges.left && (
        <button type="button" className="seg-edge seg-edge-left" tabIndex={-1} aria-hidden onClick={() => nudge(-1)}>
          <ChevronIcon dir="left" />
        </button>
      )}
      <div ref={ref} className="segmented" role="tablist" aria-label={label} onScroll={measure}>
        {options.map(([id, name], i) => {
          const badge = badges?.[id]
          return (
            <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={value === id} tabIndex={value === id ? 0 : -1} onKeyDown={(e) => move(e, i)} onClick={() => onChange(id)}>
              {name}
              {badge ? <span className="tab-badge">{badge}</span> : null}
            </button>
          )
        })}
      </div>
      {edges.right && (
        <button type="button" className="seg-edge seg-edge-right" tabIndex={-1} aria-hidden onClick={() => nudge(1)}>
          <ChevronIcon dir="right" />
        </button>
      )}
    </div>
  )
}

/** The tab bar of a registered desk: its visible tabs, with badges, remembering where you were. */
export function DeskTabs({ desk }: { desk: string }) {
  const ctx = useRegCtx()
  const current = useDeskTab(desk)
  const setTab = useGame((s) => s.setDeskTab)
  const tabs = visibleTabs(desk, ctx)
  const value = tabs.some((t) => t.id === current) ? (current as string) : (tabs[0]?.id ?? '')
  const badges: Record<string, number | null> = {}
  for (const t of tabs) badges[t.id] = t.badge?.(ctx) ?? null
  return <Tabs value={value} onChange={(t) => setTab(desk, t)} options={tabs.map((t) => [t.id, t.label] as const)} badges={badges} label={`${findDesk(desk)?.label ?? 'Desk'} tabs`} />
}

/** Starts loading the other tabs of a desk when the browser is idle, so switching tabs never waits. */
function usePreloadTabs(desk: string) {
  useEffect(() => {
    const run = () => {
      for (const t of findDesk(desk)?.tabs ?? []) void t.load?.().catch(() => {})
    }
    const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run)
      return () => w.cancelIdleCallback?.(id)
    }
    const id = setTimeout(run, 400)
    return () => clearTimeout(id)
  }, [desk])
}

/** The body of the tab a registered desk is on: fades in, scrolls to the top, shows a skeleton while it loads. */
export function TabHost({ desk }: { desk: string }) {
  const ctx = useRegCtx()
  const current = useDeskTab(desk)
  const tabs = visibleTabs(desk, ctx)
  const tab = tabs.some((t) => t.id === current) ? (current as string) : tabs[0]?.id
  const Body = tab ? tabBodies[`${desk}:${tab}`] : undefined
  const ref = useRef<HTMLDivElement>(null)
  usePreloadTabs(desk)
  useEffect(() => {
    ref.current?.closest('[data-panel-body]')?.scrollTo({ top: 0 })
  }, [tab])
  if (!Body || !tab) return <EmptyState title="Nothing here yet" body="This tab has no content." />
  return (
    <motion.div ref={ref} key={tab} role="tabpanel" aria-labelledby={`tab-${tab}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14, ease: 'easeOut' }}>
      <Suspense fallback={<Skeleton lines={6} />}>
        <Body />
      </Suspense>
    </motion.div>
  )
}

/**
 * The one button for anything that issues an order. It always says what it does and what it costs,
 * and when it cannot be pressed it says why in place of the effect.
 */
export function OrderButton({
  order,
  label,
  cost,
  effect,
  tone = '',
  className = '',
  onDone,
}: {
  order: Order
  label: string
  /** Shown after the label, e.g. "40 money". */
  cost?: string
  /** One line on what pressing it does. Replaced by the reason when the order is not allowed. */
  effect?: string
  tone?: string
  className?: string
  onDone?: () => void
}) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const askConfirm = useGame((s) => s.askConfirm)
  const err = validateOrder(view.game, getWorld().map, order, view.orders)
  const why = err ? speak(err) : null
  const detail = why ?? effect
  return (
    <button
      className={`btn ${tone} ${className} ${detail ? 'order-btn' : ''}`}
      disabled={!!err}
      title={why ?? effect ?? ''}
      onClick={() => {
        const ask = confirmFor(view.game, getWorld().map, order)
        // Big or hard-to-reverse orders ask first.
        // Big orders ask first, and once done say so with Undo (or Cancel, if it waits for the month end).
        if (ask) askConfirm({ ...ask, run: () => runWithUndo(label, () => issueOrder(order) && onDone?.()) })
        else if (issueOrder(order)) onDone?.()
      }}
    >
      {detail ? (
        <>
          <span className="order-btn-top">
            <span>{label}</span>
            {cost && <span className="order-btn-cost">{cost}</span>}
          </span>
          <span className={`order-btn-detail ${why ? 'order-btn-why' : ''}`}>{detail}</span>
        </>
      ) : (
        <span>
          {label}
          {cost && <span className="opacity-80"> · {cost}</span>}
        </span>
      )}
    </button>
  )
}
