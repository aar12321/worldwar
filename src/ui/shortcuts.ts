import type { MapMode } from '../store'

/**
 * One key for each way of coloring the map, in the order the Map colors bar lists them.
 * 1, 2 and 3 already set the speed of a live game, so these start at 4 and work the same in both kinds of game.
 */
export const MAP_MODE_KEYS: Record<MapMode, string> = { political: '4', relations: '5', fronts: '6', borders: '7' }

/** The map coloring a key chooses, if it chooses one. */
export const mapModeForKey = (key: string): MapMode | null => (Object.keys(MAP_MODE_KEYS) as MapMode[]).find((m) => MAP_MODE_KEYS[m] === key) ?? null

const MAP_KEYS = Object.values(MAP_MODE_KEYS).join(', ')

const KEYS = `Esc: close. B briefing, E economy, M military, W wars, D diplomacy, R research, N news, I empire, A War Room for the selected country, ${MAP_KEYS}: map colors (with no desk open), / or Ctrl+K to jump anywhere, Ctrl+Z to undo, ? help.`

/** The keys, as they work in this kind of game. */
export const shortcutsFor = (live: boolean) => (live ? `Space: play or pause. 1, 2, 3: speed. ${KEYS}` : `Enter: next turn. ${KEYS}`)
