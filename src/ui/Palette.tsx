import { useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../store'
import { useDialogFocus } from './focus'
import { pushRecent } from './prefs'
import { resolvePin } from './registry'
import { regCtxOf } from './regCtx'
import { rank } from './search'

import { buildPaletteItems, type Group, type PaletteItem } from './paletteItems'
/** What the filter chips narrow the results to. */
const FILTERS: [string, string, Group[] | null][] = [
  ['all', 'All', null],
  ['desks', 'Desks and tabs', ['Desks and tabs', 'Pinned']],
  ['settings', 'Settings', ['Settings']],
  ['places', 'Countries and nations', ['Countries', 'Nations']],
  ['actions', 'Actions and orders', ['Actions', 'Orders']],
]

const GROUP_ORDER: Group[] = ['Recent', 'Pinned', 'Desks and tabs', 'Actions', 'Orders', 'Settings', 'Countries', 'Nations']

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
