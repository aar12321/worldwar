import type { MapMode } from '../store'
import { navDesks, allDesks, isVisible, type RegCtx } from './registry'

/**
 * One key for each way of coloring the map, in the order the Map colors bar lists them.
 * 1, 2 and 3 already set the speed of a live game, so these start at 4 and work the same in both kinds of game.
 */
export const MAP_MODE_KEYS: Record<MapMode, string> = { political: '4', relations: '5', fronts: '6', borders: '7' }

/** The map coloring a key chooses, if it chooses one. */
export const mapModeForKey = (key: string): MapMode | null => (Object.keys(MAP_MODE_KEYS) as MapMode[]).find((m) => MAP_MODE_KEYS[m] === key) ?? null

const MAP_KEYS = Object.values(MAP_MODE_KEYS).join(', ')

/** A row of the shortcut sheet. */
export interface ShortcutRow {
  /** Each entry is one way to press it; the sheet shows them with "or" between. */
  keys: string[]
  label: string
  group: 'Anywhere' | 'Desks' | 'Tabs' | 'Map' | 'Live games' | 'In lists'
}

/** A context for listing keys when there is no game yet (the tests, the help sheet before a game starts). */
export const NO_CTX: RegCtx = { game: null, live: false, tier: 1, offers: 0, urgent: 0, factionDue: 0, wars: 0, armies: 0, puppets: 0 }

const show = (k: string) => (k.length === 1 ? k.toUpperCase() : k)

/** Every key the game answers, built from the registry so a new desk or tab lists itself. */
export function shortcutRows(ctx: RegCtx): ShortcutRow[] {
  const rows: ShortcutRow[] = []
  if (ctx.live) {
    rows.push({ group: 'Live games', keys: ['Space'], label: 'Play or pause the clock' })
    rows.push({ group: 'Live games', keys: ['1', '2', '3'], label: 'Normal, 2x and 4x speed' })
  } else {
    rows.push({ group: 'Anywhere', keys: ['Enter'], label: 'Next turn' })
  }
  rows.push({ group: 'Anywhere', keys: ['Ctrl+K', '/'], label: 'Jump to any desk, tab, country, nation or setting' })
  rows.push({ group: 'Anywhere', keys: ['?'], label: 'Help and this list of keys' })
  rows.push({ group: 'Anywhere', keys: ['Esc'], label: 'Close the open desk, window or card' })
  rows.push({ group: 'Anywhere', keys: ['Ctrl+Z'], label: 'Undo the last order that took effect at once' })
  rows.push({ group: 'Anywhere', keys: ['Alt+←'], label: 'Back to the desk or tab you were on' })
  rows.push({ group: 'Anywhere', keys: ['A'], label: 'Open the War Room for the selected country' })
  for (const d of navDesks(ctx)) rows.push({ group: 'Desks', keys: [d.key, ...(d.aliases ?? [])].filter(Boolean).map(show), label: `${d.label}: ${d.hint ?? 'open the desk'}` })
  for (const d of allDesks()) {
    if (d.nav === false && d.key && isVisible(d, ctx)) rows.push({ group: 'Desks', keys: [d.key, ...(d.aliases ?? [])].map(show), label: `${d.label}: ${d.hint ?? 'open'}` })
    for (const t of d.tabs ?? []) if (t.key && isVisible(d, ctx) && isVisible(t, ctx)) rows.push({ group: 'Tabs', keys: [show(t.key)], label: `${d.label}: ${t.hint ?? t.label}` })
  }
  rows.push({ group: 'Tabs', keys: ['['], label: 'Previous tab in the open desk' })
  rows.push({ group: 'Tabs', keys: [']'], label: 'Next tab in the open desk' })
  rows.push({ group: 'Map', keys: Object.values(MAP_MODE_KEYS), label: 'Map colors: nations, relations, fronts (with no desk open)' })
  rows.push({ group: 'In lists', keys: ['↑', '↓'], label: 'Move between rows; Home and End jump to the ends' })
  rows.push({ group: 'In lists', keys: ['Enter'], label: 'Open the row you are on' })
  return rows
}

const KEYS = (ctx: RegCtx) => {
  const desks = navDesks(ctx).map((d) => `${show(d.key)} ${d.label.toLowerCase()}`)
  const tabs = allDesks().flatMap((d) => (d.tabs ?? []).filter((t) => t.key && isVisible(t, ctx)).map((t) => `${show(t.key as string)} ${t.label.toLowerCase()}`))
  return `Esc: close. ${[...desks, ...tabs, 'N news'].join(', ')}, A War Room for the selected country, ${MAP_KEYS}: map colors (with no desk open), / or Ctrl+K to jump anywhere, Ctrl+Z to undo, Alt+Left to go back, ? for every key.`
}

/** The keys, as they work in this kind of game. */
export const shortcutsFor = (live: boolean, ctx: RegCtx = { ...NO_CTX, live }) => (live ? `Space: play or pause. 1, 2, 3: speed. ${KEYS(ctx)}` : `Enter: next turn. ${KEYS(ctx)}`)

/** Whether a key press should be left to the control that has focus (typing, a button's own Enter and so on). */
export function belongsToControl(e: { key: string; target: unknown }): boolean {
  const t = e.target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null
  if (!t || !t.tagName) return false
  if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return true
  if (e.key === 'Enter' || e.key === ' ') {
    return t.tagName === 'BUTTON' || t.tagName === 'SUMMARY' || t.tagName === 'A' || !!t.closest?.('[role="button"], [role="tab"], [role="option"], [role="radio"], [role="menuitem"], summary')
  }
  return false
}

/** Moves a tab index by one, wrapping round. */
export const stepIndex = (i: number, n: number, dir: 1 | -1): number => (n <= 0 ? 0 : (i + dir + n) % n)
