import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'
import { findDesk, isVisible, visibleTabs, type DeskDef } from './registry'
import { useRegCtx } from './regCtx'
import { DeskTabs, PanelShell, TabHost } from './panel'
import { EmptyState, Skeleton } from './widgets'
import type { Panel } from '../store'

const desks = new Map<string, LazyExoticComponent<ComponentType>>()
function lazyDesk(def: DeskDef): LazyExoticComponent<ComponentType> | null {
  const hit = desks.get(def.id)
  if (hit) return hit
  if (!def.load) return null
  const made = lazy(def.load)
  desks.set(def.id, made)
  return made
}

const bodies = new Map<string, LazyExoticComponent<ComponentType>>()
function lazyBody(def: DeskDef): LazyExoticComponent<ComponentType> | null {
  const hit = bodies.get(def.id)
  if (hit) return hit
  if (!def.body) return null
  const made = lazy(def.body)
  bodies.set(def.id, made)
  return made
}

/** While a desk's code loads: the same drawer, with grey bars where the text will be, so nothing pops in. */
function DeskLoading({ title }: { title: string }) {
  return (
    <aside className="drawer surface drawer-wide" aria-label={title} aria-busy="true">
      <div className="px-5 pt-4 pb-3 border-b border-white/10">
        <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="p-5">
        <Skeleton lines={7} />
      </div>
    </aside>
  )
}

/** A desk whose shell, tab bar and loading state the game draws, for a desk that only supplies tabs or a body (see registry.ts). */
function DeskHost({ def }: { def: DeskDef }) {
  const ctx = useRegCtx()
  const tabs = visibleTabs(def.id, ctx)
  // The lazy component is cached per desk (see lazyBody), so it is the same component on every render.
  const Body = lazyBody(def)
  return (
    <PanelShell title={def.label} kicker={def.kicker?.(ctx) ?? def.hint ?? ''} panel={def.id as Panel} wide tabs={tabs.length > 1 ? <DeskTabs desk={def.id} /> : undefined}>
      {tabs.length > 0 ? (
        <TabHost desk={def.id} />
      ) : Body ? (
        <Suspense fallback={<Skeleton lines={6} />}>
          {/* oxlint-disable-next-line react/static-components */}
          <Body />
        </Suspense>
      ) : (
        <EmptyState title="Nothing here yet" body="This desk has no tabs or content registered." />
      )}
    </PanelShell>
  )
}

/** Whichever desk is open, found in the registry by id and loaded the first time it is needed. */
export function DeskSlot({ id }: { id: string }) {
  const def = findDesk(id)
  const ctx = useRegCtx()
  if (!def || !isVisible(def, ctx)) return null
  const custom = def.shell === 'custom' || (def.shell === undefined && !!def.load)
  const Desk = custom ? lazyDesk(def) : null
  if (Desk) {
    return (
      <Suspense fallback={<DeskLoading title={def.label} />}>
        {/* oxlint-disable-next-line react/static-components */}
        <Desk />
      </Suspense>
    )
  }
  return <DeskHost def={def} />
}
