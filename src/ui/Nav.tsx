import { AnimatePresence, motion } from 'framer-motion'
import { useRef, useState } from 'react'
import { useGame } from '../store'
import { useDialogFocus, useWidth } from './focus'
import { ChevronIcon, DeskIcon as RegistryIcon, MoreIcon, PinIcon, SearchIcon } from './navIcons'
import { phoneSlots, splitForPhone } from './navLayout'
import { currentTab, findDesk, groupedNav, resolvePin, visibleTabs, tabLabel, type DeskDef, type RegCtx } from './registry'
import { useRegCtx } from './regCtx'

/** The more-than-this-many desks at which the rail starts showing group names and lets groups fold. */
const GROUP_HEADS_FROM = 7

function Badge({ n, label }: { n: number; label: string }) {
  return (
    <span className="nav-badge" aria-label={`${n} ${label}`}>
      {n}
    </span>
  )
}

function useOpenPin() {
  const openTab = useGame((s) => s.openTab)
  return (id: string, ctx: RegCtx) => {
    const p = resolvePin(id, ctx)
    if (p) openTab(p.desk.id, p.tab?.id)
  }
}

/** The pinned desks and tabs, as one-tap buttons. */
function PinnedButtons({ ctx, onDone, layout }: { ctx: RegCtx; onDone?: () => void; layout: 'rail' | 'sheet' }) {
  const pinned = useGame((s) => s.settings.ui.pinned)
  const panel = useGame((s) => s.panel)
  const eco = useGame((s) => s.economyTab)
  const mil = useGame((s) => s.militaryTab)
  const emp = useGame((s) => s.empireTab)
  const others = useGame((s) => s.deskTabs)
  const openPin = useOpenPin()
  const items = pinned.map((id) => ({ id, p: resolvePin(id, ctx) })).filter((x) => x.p)
  if (items.length === 0) return null
  return (
    <>
      {items.map(({ id, p }) => {
        const active = panel === p!.desk.id && (!p!.tab || currentTab({ economyTab: eco, militaryTab: mil, empireTab: emp, deskTabs: others }, p!.desk.id) === p!.tab.id)
        return (
          <button key={id} type="button" className={`pin-chip ${layout === 'sheet' ? 'sheet' : ''}`} aria-pressed={active} title={`${p!.desk.label}${p!.tab ? ` › ${p!.tab.label}` : ''} (pinned)`} onClick={() => { openPin(id, ctx); onDone?.() }}>
            <span className="pin-chip-icon" aria-hidden>
              <PinIcon size={13} filled />
            </span>
            <span className="truncate">{p!.label}</span>
          </button>
        )
      })}
    </>
  )
}

function DeskButton({ desk, ctx, active, onPick }: { desk: DeskDef; ctx: RegCtx; active: boolean; onPick: () => void }) {
  const n = desk.badge?.(ctx) ?? 0
  const keyHint = desk.key ? ` (${desk.key.toUpperCase()})` : ''
  return (
    <button onClick={onPick} aria-pressed={active} aria-label={n ? `${desk.label}, ${n} need you` : desk.label} className={`nav-btn ${active ? 'on' : ''}`} title={`${desk.label}${keyHint}${desk.hint ? `: ${desk.hint}` : ''}`}>
      <RegistryIcon id={desk.icon} />
      <span className="nav-label">{desk.label}</span>
      {n > 0 && <Badge n={n} label="need you" />}
    </button>
  )
}

/** The bottom sheet on a phone: every desk and tab, the pinned ones and search, one tap away. */
function MoreSheet({ ctx, onClose }: { ctx: RegCtx; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose)
  const openTab = useGame((s) => s.openTab)
  const setPalette = useGame((s) => s.setPalette)
  const setPanel = useGame((s) => s.setPanel)
  const setHelp = useGame((s) => s.setHelp)
  const groups = groupedNav(ctx)
  const go = (desk: string, tab?: string) => {
    onClose()
    openTab(desk, tab)
  }
  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div ref={ref} className="sheet surface" role="dialog" aria-modal="true" aria-label="All desks" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
        <div className="sheet-head">
          <h2 className="text-[18px] font-semibold">All desks</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sheet-body scroll-thin">
          <button className="btn w-full flex items-center justify-center gap-2 py-2.5" data-autofocus onClick={() => { onClose(); setPalette(true) }}>
            <SearchIcon size={16} /> Search desks, countries, settings
          </button>
          <PinnedBlock ctx={ctx} onDone={onClose} />
          {groups.map((g) => (
            <section key={g.id} aria-label={g.label} className="space-y-1.5">
              <h3 className="label">{g.label}</h3>
              {g.desks.map((d) => {
                const tabs = visibleTabs(d.id, ctx)
                return (
                  <div key={d.id} className="sheet-desk">
                    <button className="sheet-desk-main" onClick={() => go(d.id)}>
                      <RegistryIcon id={d.icon} />
                      <span className="min-w-0 text-left">
                        <span className="block text-[15px] font-semibold">{d.label}</span>
                        {d.hint && <span className="block text-[12px] text-white/65">{d.hint}</span>}
                      </span>
                      {(d.badge?.(ctx) ?? 0) > 0 && <Badge n={d.badge!(ctx)!} label="need you" />}
                    </button>
                    {tabs.length > 1 && (
                      <div className="sheet-tabs" role="group" aria-label={`${d.label} tabs`}>
                        {tabs.map((t) => (
                          <button key={t.id} className="btn btn-quiet sheet-tab" onClick={() => go(d.id, t.id)}>
                            {tabLabel(t, ctx)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <button className="btn" onClick={() => { onClose(); setPanel('log') }}>News</button>
            <button className="btn" onClick={() => { onClose(); setPanel('settings') }}>Settings</button>
            <button className="btn" onClick={() => { onClose(); setHelp(true) }}>Help and keys</button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function PinnedBlock({ ctx, onDone }: { ctx: RegCtx; onDone: () => void }) {
  const has = useGame((s) => s.settings.ui.pinned.some((id) => resolvePin(id, ctx)))
  if (!has) {
    return (
      <p className="text-[12px] text-white/65">
        Tip: press the star at the top of any desk to pin it here.
      </p>
    )
  }
  return (
    <section aria-label="Pinned" className="space-y-1.5">
      <h3 className="label">Pinned</h3>
      <div className="flex flex-wrap gap-2">
        <PinnedButtons ctx={ctx} onDone={onDone} layout="sheet" />
      </div>
    </section>
  )
}

/**
 * The way around the game. On a computer: a rail of desks on the left, grouped, with the pinned ones and Search under them.
 * On a phone: a bar of desks along the bottom, with More opening a sheet that holds every desk and tab. Everything in it
 * comes from the registry (registry.ts), so a new desk shows up here by itself.
 */
export function NavRail() {
  const ctx = useRegCtx()
  const panel = useGame((s) => s.panel)
  const setPanel = useGame((s) => s.setPanel)
  const setPalette = useGame((s) => s.setPalette)
  const ui = useGame((s) => s.settings.ui)
  const collapsed = ui.navCollapsed
  const hasPins = useGame((s) => s.settings.ui.pinned.some((id) => resolvePin(id, ctx)))
  const updatePrefs = useGame((s) => s.updatePrefs)
  const width = useWidth()
  const [sheet, setSheet] = useState(false)
  const groups = groupedNav(ctx)
  const desks = groups.flatMap((g) => g.desks)
  const phone = width <= 900
  const heads = desks.length >= GROUP_HEADS_FROM

  if (phone) {
    const split = splitForPhone(desks, findDesk(panel)?.nav === false ? null : panel, phoneSlots(width / ui.scale), hasPins)
    // A desk hidden behind More still shows its badge on the More button, so nothing urgent is out of sight.
    const hiddenBadge = split.more.reduce((n, d) => n + (d.badge?.(ctx) ?? 0), 0)
    return (
      <>
        <nav className="nav-dock" aria-label="Desks">
          <div className="surface rail">
            {split.shown.map((d) => (
              <DeskButton key={d.id} desk={d} ctx={ctx} active={panel === d.id} onPick={() => setPanel(d.id)} />
            ))}
            {split.hasMore && (
              <button className={`nav-btn ${sheet ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)} title="Every desk, tab and pinned item">
                <MoreIcon />
                <span className="nav-label">More</span>
                {hiddenBadge > 0 && <Badge n={hiddenBadge} label="need you in other desks" />}
              </button>
            )}
          </div>
        </nav>
        <AnimatePresence>{sheet && <MoreSheet ctx={ctx} onClose={() => setSheet(false)} />}</AnimatePresence>
      </>
    )
  }

  const toggle = (id: string) => updatePrefs({ navCollapsed: collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id] })
  return (
    <nav className="nav-dock" aria-label="Desks">
      <div className="surface rail">
        <div className="rail-scroll scroll-thin">
        {groups.map((g) => {
          const folded = heads && collapsed.includes(g.id)
          const shown = folded ? g.desks.filter((d) => d.id === panel) : g.desks
          return (
            <div key={g.id} role="group" aria-label={g.label} className="rail-group">
              {heads && (
                <button type="button" className="rail-head" aria-expanded={!folded} onClick={() => toggle(g.id)} title={folded ? `Show ${g.label}` : `Fold ${g.label}`}>
                  <ChevronIcon size={11} dir={folded ? 'right' : 'down'} />
                  <span>{g.label}</span>
                </button>
              )}
              {shown.map((d) => (
                <DeskButton key={d.id} desk={d} ctx={ctx} active={panel === d.id} onPick={() => setPanel(d.id)} />
              ))}
            </div>
          )
        })}
        {hasPins && (
          <div role="group" aria-label="Pinned" className="rail-group">
            <div className="rail-head static">Pinned</div>
            <PinnedButtons ctx={ctx} layout="rail" />
          </div>
        )}
        </div>
        <div className="rail-group rail-foot">
          <button className="nav-btn" onClick={() => setPalette(true)} title="Jump to anything (Ctrl+K or /)" aria-label="Search everything">
            <SearchIcon size={20} />
            <span className="nav-label">Search</span>
          </button>
        </div>
      </div>
    </nav>
  )
}
