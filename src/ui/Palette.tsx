import { useEffect, useMemo, useRef, useState } from 'react'
import { isLive } from '../engine/calendar'
import { regionsOf } from '../engine/helpers'
import { getWorld } from '../map/world'
import { useGame, type EconomyTab, type EmpireTab, type MilitaryTab } from '../store'
import { globeBridge } from './globeBridge'

interface Item {
  id: string
  label: string
  hint: string
  group: 'Go to' | 'Open' | 'Do'
  run: () => void
}

const ECONOMY: [EconomyTab, string][] = [
  ['country', 'Country and cities'],
  ['people', 'People: schools, health, welfare'],
  ['budget', 'Budget and taxes'],
  ['bank', 'Bank: rates, printing, bonds'],
  ['business', 'Business and state enterprises'],
  ['projects', 'Projects and public works'],
  ['market', 'Market'],
  ['stocks', 'Stocks'],
  ['government', 'Government and laws'],
]
const MILITARY: [MilitaryTab, string][] = [
  ['forces', 'Forces and academy'],
  ['wars', 'Wars'],
  ['agencies', 'Agencies'],
  ['systems', 'Frontier systems'],
]
const EMPIRE: [EmpireTab, string][] = [
  ['overview', 'Tiers and what they open'],
  ['provinces', 'Administration and capitals'],
  ['world', 'World Council and reserve currency'],
  ['stats', 'Statistics'],
]

/** Jump to anything: a country or nation on the globe, a desk or tab, or an action. Opens with Ctrl+K or /. */
export function Palette() {
  const open = useGame((s) => s.paletteOpen)
  return open ? <PaletteBody /> : null
}

function PaletteBody() {
  const close = useGame((s) => s.setPalette)
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => input.current?.focus())
  }, [])

  const items = useMemo<Item[]>(() => {
    const st = useGame.getState()
    const game = st.game
    if (!game) return []
    const { map } = getWorld()
    const out: Item[] = []
    const fly = (id: string) => {
      const r = map.regions[id]
      if (r) globeBridge.api?.pointOfView({ lat: r.lat, lng: r.lng, altitude: 1.6 }, st.settings.reducedMotion ? 0 : 700)
    }
    const goTo = (id: string) => () => {
      useGame.setState({ panel: 'none' })
      st.selectRegion(id)
      fly(id)
    }
    // Countries: every one on the map, named for its owner.
    for (const id of map.order) {
      const r = game.regions[id]
      const owner = game.nations[r.owner]
      out.push({ id: `go-${id}`, label: map.regions[id].name, hint: r.owner === game.playerId ? 'yours' : (owner?.name ?? ''), group: 'Go to', run: goTo(id) })
    }
    // Nations: diplomacy and agencies for each rival.
    for (const n of Object.values(game.nations)) {
      if (!n.alive || n.id === game.playerId) continue
      out.push({ id: `dip-${n.id}`, label: `Diplomacy with ${n.name}`, hint: `${regionsOf(game, n.id).length} countries`, group: 'Open', run: () => st.openDiplomacy(n.id) })
      out.push({ id: `ag-${n.id}`, label: `Agencies: ${n.name}`, hint: 'operations', group: 'Open', run: () => st.openAgencies(n.id) })
    }
    out.push({ id: 'o-brief', label: 'Briefing', hint: 'B', group: 'Open', run: () => st.setPanel('briefing') })
    for (const [t, name] of ECONOMY) out.push({ id: `o-e-${t}`, label: `Economy: ${name}`, hint: 'E', group: 'Open', run: () => st.openEconomy(t) })
    for (const [t, name] of MILITARY) out.push({ id: `o-m-${t}`, label: `Military: ${name}`, hint: 'M', group: 'Open', run: () => st.openMilitary(t) })
    if (isLive(game)) out.push({ id: 'o-m-armies', label: 'Military: Armies', hint: 'M', group: 'Open', run: () => st.openMilitary('armies') })
    out.push({ id: 'o-dip', label: 'Diplomacy', hint: 'D', group: 'Open', run: () => st.openDiplomacy(null) })
    for (const [t, name] of EMPIRE) out.push({ id: `o-i-${t}`, label: `Empire: ${name}`, hint: 'I', group: 'Open', run: () => st.openEmpire(t) })
    out.push({ id: 'o-tech', label: 'Research', hint: 'R', group: 'Open', run: () => st.setPanel('tech') })
    out.push({ id: 'o-news', label: 'News', hint: 'N', group: 'Open', run: () => st.setPanel('log') })
    out.push({ id: 'o-set', label: 'Settings and saves', hint: '', group: 'Open', run: () => st.setPanel('settings') })
    out.push({ id: 'o-help', label: 'How the game works', hint: '?', group: 'Open', run: () => st.setHelp(true) })
    if (isLive(game)) out.push({ id: 'd-play', label: st.running ? 'Pause the clock' : 'Play the clock', hint: 'Space', group: 'Do', run: () => st.togglePause() })
    else out.push({ id: 'd-next', label: 'End the turn', hint: 'Enter', group: 'Do', run: () => st.endTurn() })
    if (st.undoStack.length > 0) out.push({ id: 'd-undo', label: `Undo: ${st.undoStack[st.undoStack.length - 1].label}`, hint: 'Ctrl+Z', group: 'Do', run: () => st.undo() })
    out.push({ id: 'd-capital', label: 'Go to your capital', hint: '', group: 'Go to', run: goTo(game.nations[game.playerId].capital) })
    return out
  }, [])

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return items.filter((i) => i.group !== 'Go to' || i.id === 'd-capital').slice(0, 14)
    const scored = items
      .map((i) => {
        const text = `${i.label} ${i.hint}`.toLowerCase()
        if (!words.every((w) => text.includes(w))) return null
        // Names that start with what was typed come first, then the shorter ones.
        const first = i.label.toLowerCase().startsWith(words[0]) ? 0 : 1
        return { i, score: first * 100 + i.label.length + (i.group === 'Go to' ? 0 : 10) }
      })
      .filter((x): x is { i: Item; score: number } => !!x)
      .sort((a, b) => a.score - b.score)
    return scored.slice(0, 14).map((x) => x.i)
  }, [items, query])

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const run = (item?: Item) => {
    if (!item) return
    close(false)
    item.run()
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="surface rounded-2xl w-[min(560px,92vw)] mx-auto mt-[12vh] self-start overflow-hidden" role="dialog" aria-modal="true" aria-label="Jump to">
        <input
          ref={input}
          className="w-full bg-transparent px-4 py-3.5 text-[16px] outline-none border-b border-white/10"
          placeholder="Jump to a country, a desk or an action"
          aria-label="Jump to"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[at] ? `pal-${shown[at].id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setAt(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close(false)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setAt((a) => Math.min(shown.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setAt((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(shown[at])
            }
          }}
        />
        <div ref={list} id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto scroll-thin p-1.5">
          {shown.length === 0 && <div className="px-3 py-4 text-[14px] text-white/60">Nothing matches.</div>}
          {shown.map((item, i) => (
            <button key={item.id} id={`pal-${item.id}`} role="option" aria-selected={i === at} className={`w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[14px] ${i === at ? 'bg-white/14' : 'hover:bg-white/8'}`} onMouseEnter={() => setAt(i)} onClick={() => run(item)}>
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="shrink-0 text-[12px] text-white/55">
                {item.group === 'Go to' ? 'go to' : ''} {item.hint}
              </span>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 text-[12px] text-white/50 border-t border-white/10">↑ ↓ to choose · Enter to go · Esc to close</div>
      </div>
    </div>
  )
}
