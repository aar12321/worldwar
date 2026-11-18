import { describe, expect, it } from 'vitest'
import { MAP_MODE_KEYS, mapModeForKey, shortcutsFor } from './shortcuts'

describe('the map color keys', () => {
  it('give each way of coloring the map its own key, in the order of the Map colors bar', () => {
    expect(Object.keys(MAP_MODE_KEYS)).toEqual(['political', 'relations', 'fronts', 'borders', 'blocs'])
    const keys = Object.values(MAP_MODE_KEYS)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('turn a key into its map mode, and ignore every other key', () => {
    expect(mapModeForKey('4')).toBe('political')
    expect(mapModeForKey('5')).toBe('relations')
    expect(mapModeForKey('6')).toBe('fronts')
    expect(mapModeForKey('7')).toBe('borders')
    expect(mapModeForKey('8')).toBe('blocs')
    for (const other of ['1', '2', '3', '9', '0', 'a', 'f', ' ', 'Enter', 'Escape', '']) expect(mapModeForKey(other)).toBeNull()
  })

  it('stay clear of the live speed keys, so they work the same in both kinds of game', () => {
    for (const key of Object.values(MAP_MODE_KEYS)) expect(['1', '2', '3']).not.toContain(key)
  })
})

describe('the shortcut sheet', () => {
  const [p, r, f, b, k] = Object.values(MAP_MODE_KEYS)

  it('lists the map color keys in a turn game and in a live game', () => {
    for (const live of [false, true]) expect(shortcutsFor(live)).toContain(`${p}, ${r}, ${f}, ${b}, ${k}: map colors`)
  })

  it('keeps 1, 2, 3 as speed in a live game only', () => {
    expect(shortcutsFor(true)).toContain('1, 2, 3: speed')
    expect(shortcutsFor(true)).toContain('Space: play or pause')
    expect(shortcutsFor(false)).not.toContain('speed')
    expect(shortcutsFor(false)).toContain('Enter: next turn')
    expect(shortcutsFor(false)).not.toContain('Space')
  })
})
