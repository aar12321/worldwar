import { useEffect, useMemo, useRef, useState } from 'react'
import { regionsOf } from '../engine/helpers'
import { describeOrder } from '../engine/resolveTurn'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { useDialogFocus } from './focus'
import { globeBridge } from './globeBridge'
import { goBack, useNav } from './navState'
import { pushRecent, togglePinned } from './prefs'
import { allDesks, currentTab, isVisible, pinId, resolvePin, type RegCtx } from './registry'
import { regCtxOf } from './regCtx'
import { rank } from './search'
import { SETTING_DEFS, SETTINGS_TABS } from './settingsDefs'

type Group = 'Recent' | 'Pinned' | 'Desks and tabs' | 'Settings' | 'Actions' | 'Orders' | 'Nations' | 'Countries'

export interface PaletteItem {
  id: string
  label: string
  /** The small grey text after the label: where it is, or whose it is. */
  hint?: string
  keywords?: string
  group: Group
  /** Keys that do the same thing, shown as key caps. */
  keys?: string[]
  run: () => void
}

/** What the filter chips narrow the results to. */
const FILTERS: [string, string, Group[] | null][] = [
  ['all', 'All', null],
  ['desks', 'Desks and tabs', ['Desks and tabs', 'Pinned']],
  ['settings', 'Settings', ['Settings']],
  ['places', 'Countries and nations', ['Countries', 'Nations']],
  ['actions', 'Actions and orders', ['Actions', 'Orders']],
]

const GROUP_ORDER: Group[] = ['Recent', 'Pinned', 'Desks and tabs', 'Actions', 'Orders', 'Settings', 'Nations', 'Countries']

/** Opens the Settings desk on the tab that holds a setting, and asks it to show that setting. */
export function openSetting(id: string): void {
  const def = SETTING_DEFS.find((s) => s.id === id)
  const st = useGame.getState()
  useGame.setState({ settingsFocus: id })
  st.openTab('settings', def?.tab ?? SETTINGS_TABS[0][0])
}

/** Everything the jump window can reach for this game right now. Built once each time it opens. */
export function buildPaletteItems(): PaletteItem[] {
  const st = useGame.getState()
  const game = st.game
  if (!game) return []
  const ctx: RegCtx = regCtxOf(game, st.orders)
  const { map } = getWorld()
  const out: PaletteItem[] = []
  const fly = (id: string) => {
    const r = map.regions[id]
    if (r) globeBridge.api?.pointOfView({ lat: r.lat, lng: r.lng, altitude: 1.6 }, st.settings.reducedMotion ? 0 : 700)
  }
  const goTo = (id: string) => () => {
    useGame.setState({ panel: 'none' })
    st.selectRegion(id)
    fly(id)
  }

  // Desks and their tabs, straight from the registry.
  for (const d of allDesks()) {
    if (!isVisible(d, ctx)) continue
    const keys = d.key ? [d.key.toUpperCase()] : undefined
    out.push({ id: pinId(d.id), label: d.label, hint: d.hint, keywords: (d.keywords ?? []).join(' '), group: 'Desks and tabs', keys, run: () => st.openTab(d.id) })
    for (const t of d.tabs ?? []) {
      if (!isVisible(t, ctx)) continue
      out.push({ id: pinId(d.id, t.id), label: `${d.label} \u203A ${t.label}`, hint: t.hint && t.hint !== t.label ? t.hint : undefined, keywords: [...(t.keywords ?? []), t.label].join(' '), group: 'Desks and tabs', keys: t.key ? [t.key.toUpperCase()] : undefined, run: () => st.openTab(d.id, t.id) })
    }
  }

  // Settings, each one found by name, description and keywords.
  for (const s of SETTING_DEFS) {
    if (s.only && (s.only === 'live') !== ctx.live) continue
    out.push({ id: `set:${s.id}`, label: `Setting: ${s.label}`, hint: s.description, keywords: (s.keywords ?? []).join(' '), group: 'Settings', run: () => openSetting(s.id) })
  }

  // Actions.
  if (ctx.live) out.push({ id: 'act:play', label: st.running ? 'Pause the clock' : 'Play the clock', keys: ['Space'], group: 'Actions', run: () => st.togglePause() })
  else out.push({ id: 'act:next', label: 'End the turn', keys: ['Enter'], keywords: 'next turn month', group: 'Actions', run: () => st.endTurn() })
  if (st.undoStack.length > 0) out.push({ id: 'act:undo', label: `Undo: ${st.undoStack[st.undoStack.length - 1].label}`, keys: ['Ctrl+Z'], group: 'Actions', run: () => st.undo() })
  if (useNav.getState().stack.length > 0) out.push({ id: 'act:back', label: 'Go back to the previous desk or tab', keys: ['Alt+←'], group: 'Actions', run: () => goBack() })
  if (st.panel !== 'none') {
    const tab = currentTab({ economyTab: st.economyTab, militaryTab: st.militaryTab, empireTab: st.empireTab, deskTabs: st.deskTabs }, st.panel)
    const hasTabs = !!allDesks().find((d) => d.id === st.panel)?.tabs?.length
    const id = pinId(st.panel, hasTabs ? tab : undefined)
    const pinned = st.settings.ui.pinned.includes(id)
    out.push({ id: 'act:pin', label: pinned ? 'Unpin this desk from the rail' : 'Pin this desk to the rail', group: 'Actions', keywords: 'favorite favourite star', run: () => st.updatePrefs({ pinned: togglePinned(st.settings.ui.pinned, id) }) })
    out.push({ id: 'act:close', label: 'Close the open desk', keys: ['Esc'], group: 'Actions', run: () => st.setPanel(st.panel) })
  }
  out.push({ id: 'act:help', label: 'How the game works', keys: ['?'], group: 'Actions', run: () => st.setHelp(true) })
  out.push({ id: 'act:keys', label: 'Keyboard shortcuts', hint: 'Every key the game answers', keywords: 'keys hotkeys cheat sheet', group: 'Actions', keys: ['?'], run: () => { st.setHelpTab('keys'); st.setHelp(true) } })
  out.push({ id: 'act:capital', label: 'Go to your capital', group: 'Actions', run: goTo(game.nations[game.playerId].capital) })

  // Orders waiting for the month to end: cancel any of them.
  st.orders.slice(0, 20).forEach((o, i) => out.push({ id: `ord:${i}:${describeOrder(game, map, o)}`, label: `Cancel order: ${describeOrder(game, map, o)}`, group: 'Orders', keywords: 'remove undo queued', run: () => st.removeOrder(i) }))

  // Rival nations: diplomacy and agencies for each.
  for (const n of Object.values(game.nations)) {
    if (!n.alive || n.id === game.playerId) continue
    const lands = `${regionsOf(game, n.id).length} countries`
    out.push({ id: `dip:${n.id}`, label: `Diplomacy with ${n.name}`, hint: lands, group: 'Nations', keywords: n.name, run: () => st.openDiplomacy(n.id) })
    out.push({ id: `ag:${n.id}`, label: `Agencies: ${n.name}`, hint: 'operations', group: 'Nations', keywords: n.name, run: () => st.openAgencies(n.id) })
  }

  // Every country on the map, named for its owner.
  for (const id of map.order) {
    const r = game.regions[id]
    const owner = game.nations[r.owner]
    out.push({ id: `go:${id}`, label: map.regions[id].name, hint: r.owner === game.playerId ? 'yours' : (owner?.name ?? ''), group: 'Countries', run: goTo(id) })
  }
  return out
}

/** Jump to anything: a desk or tab, a setting, an action, a nation or a country on the globe. Opens with Ctrl+K or /. */
export function Palette() {
  const open = useGame((s) => s.paletteOpen)
  return open ? <PaletteBody /> : null
}

function PaletteBody() {
  const close = useGame((s) => s.setPalette)
  const recents = useGame((s) => s.settings.ui.recents)
  const pinned = useGame((s) => s.settings.ui.pinned)
  const updatePrefs = useGame((s) => s.updatePrefs)
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const [filter, setFilter] = useState('all')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useDialogFocus(dialog, () => close(false))
  const [items] = useState<PaletteItem[]>(() => buildPaletteItems())

  const groups = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]))
    const allowed = FILTERS.find((f) => f[0] === filter)?.[2] ?? null
    const inFilter = (i: PaletteItem) => !allowed || allowed.includes(i.group)
    let picked: PaletteItem[]
    if (query.trim() === '') {
      // Nothing typed: what you used lately, what you pinned, then the desks.
      const ctx = regCtxOf(useGame.getState().game, useGame.getState().orders)
      const recent = recents.map((id) => byId.get(id)).filter((i): i is PaletteItem => !!i && inFilter(i)).slice(0, 5).map((i) => ({ ...i, group: 'Recent' as Group }))
      const pins = pinned.filter((id) => resolvePin(id, ctx)).map((id) => byId.get(id)).filter((i): i is PaletteItem => !!i && inFilter(i) && !recents.slice(0, 5).includes(i.id)).map((i) => ({ ...i, group: 'Pinned' as Group }))
      const rest = items.filter((i) => inFilter(i) && (i.group === 'Desks and tabs' ? !i.id.startsWith('tab:') : i.group === 'Actions' || i.group === 'Orders') && !recents.slice(0, 5).includes(i.id))
      picked = [...recent, ...pins, ...rest].slice(0, 16)
    } else {
      picked = rank(items.filter(inFilter), query, (i) => ({ label: i.label, keywords: `${i.keywords ?? ''} ${i.hint ?? ''}` }), 40)
    }
    const out: { group: Group; items: PaletteItem[] }[] = []
    for (const g of GROUP_ORDER) {
      const rows = picked.filter((i) => i.group === g)
      if (rows.length) out.push({ group: g, items: rows })
    }
    return out
  }, [items, query, filter, recents, pinned])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at, flat])

  const run = (item?: PaletteItem) => {
    if (!item) return
    close(false)
    // Remember it by its own id, not as "Recent", so it can be found the same way next time.
    updatePrefs({ recents: pushRecent(useGame.getState().settings.ui.recents, item.id) })
    item.run()
  }
  return (
    <div className="modal-backdrop palette-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div ref={dialog} className="surface palette" role="dialog" aria-modal="true" aria-label="Jump to anything">
        <div className="palette-input-row">
          <input
            ref={input}
            className="palette-input"
            placeholder="Jump to a desk, tab, setting, nation or country"
            aria-label="Jump to anything"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={flat[at] ? `pal-${flat[at].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setAt(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setAt((a) => Math.min(flat.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setAt((a) => Math.max(0, a - 1))
              } else if (e.key === 'Home' && !query) {
                setAt(0)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(flat[at])
              }
            }}
          />
          <button className="icon-close" aria-label="Close" onClick={() => close(false)}>
            ×
          </button>
        </div>
        <div className="palette-chips" role="radiogroup" aria-label="Narrow the results">
          {FILTERS.map(([id, name]) => (
            <button key={id} role="radio" aria-checked={filter === id} className={`btn px-2.5 py-1 text-[13px] ${filter === id ? 'btn-primary' : 'btn-quiet'}`} tabIndex={filter === id ? 0 : -1} onClick={() => { setFilter(id); setAt(0); input.current?.focus() }}>
              {name}
            </button>
          ))}
        </div>
        <div ref={list} id="palette-list" role="listbox" aria-label="Results" className="palette-list scroll-thin">
          {flat.length === 0 && <div className="px-3 py-4 text-[14px] text-white/70">Nothing matches &ldquo;{query}&rdquo;. Try a desk, a country, or a word like &ldquo;tax&rdquo;.</div>}
          {groups.map((g) => (
            <div key={g.group} role="group" aria-label={g.group}>
              <div className="palette-group">{g.group}</div>
              {g.items.map((item) => {
                const i = flat.indexOf(item)
                return (
                  <button key={`${g.group}:${item.id}`} id={`pal-${item.id}`} role="option" aria-selected={i === at} tabIndex={-1} className={`palette-row ${i === at ? 'on' : ''}`} onMouseMove={() => i !== at && setAt(i)} onClick={() => run(item)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{item.label}</span>
                      {item.hint && item.group !== 'Countries' && item.group !== 'Nations' && <span className="block truncate text-[12px] text-white/60">{item.hint}</span>}
                    </span>
                    {(item.group === 'Countries' || item.group === 'Nations') && item.hint && <span className="shrink-0 text-[12px] text-white/65">{item.hint}</span>}
                    {item.keys?.map((k) => (
                      <kbd key={k} className="kbd">
                        {k}
                      </kbd>
                    ))}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> choose
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> go
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> close
          </span>
          <span className="sr-only" role="status" aria-live="polite">
            {flat.length} results
          </span>
        </div>
      </div>
    </div>
  )
}
