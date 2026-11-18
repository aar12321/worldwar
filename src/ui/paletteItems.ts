import { regionsOf } from '../engine/helpers'
import { describeOrder } from '../engine/resolveTurn'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { globeBridge } from './globeBridge'
import { goBack, useNav } from './navState'
import { togglePinned } from './prefs'
import { allDesks, currentTab, isVisible, pinId, type RegCtx } from './registry'
import { regCtxOf } from './regCtx'
import { SETTING_DEFS, SETTINGS_TABS } from './settingsDefs'

export type Group = 'Recent' | 'Pinned' | 'Desks and tabs' | 'Settings' | 'Actions' | 'Orders' | 'Nations' | 'Countries'

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
  out.push({ id: 'act:aircraft', label: 'Aircraft development', hint: 'Design and develop new aircraft (Military, Forces)', keywords: 'fighters bombers jets planes develop research', group: 'Actions', run: () => { st.openTab('military', 'forces'); st.setAircraftOpen(true) } })
  out.push({ id: 'act:missiles', label: 'Missile program and stockpile', hint: 'Facilities, talent, development, tests and the stock (Military, Missile Program)', keywords: 'rockets hypersonic strike warheads cruise tactical ballistic build', group: 'Actions', run: () => st.openTab('military', 'program') })
  // The map's colors are buttons on the globe only while no desk is open, so the jump window offers them too.
  for (const [mode, label, hint] of [['political', 'Nations', 'Each nation in its own color'], ['relations', 'Relations', 'Who is with you and who is against you'], ['fronts', 'Fronts', 'Defense Line left in your countries and your enemies\''], ['borders', 'Borders', 'Border tension, forces on station and sea chokepoints']] as const)
    out.push({ id: `map:${mode}`, label: `Map colors: ${label}`, hint, keywords: 'globe map mode layer borders tension fronts relations straits', group: 'Actions', run: () => { if (useGame.getState().panel !== 'none') useGame.getState().setPanel(useGame.getState().panel); useGame.getState().setMapMode(mode) } })
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
    out.push({ id: `rel:${n.id}`, label: `Relations with ${n.name}`, hint: 'visits, aid, ventures, plans', group: 'Nations', keywords: `${n.name} relationship opinion`, run: () => st.openRelations(n.id) })
    out.push({ id: `loc:${n.id}`, label: `Locate ${n.name} on the map`, hint: 'closes the desk and turns the globe', group: 'Nations', keywords: `${n.name} find show where`, run: () => st.locateNation(n.id) })
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

