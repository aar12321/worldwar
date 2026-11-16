import { describe, expect, it } from 'vitest'
import { MAX_PINNED, MAX_RECENTS, PANEL_WIDTH, clampWidth, defaultPrefs, migrateSettingsUi, motionReduced, pushRecent, rootAttributes, sanitizePrefs, togglePinned } from './prefs'

describe('sanitizePrefs', () => {
  it('gives the defaults for anything that is not an object', () => {
    for (const bad of [undefined, null, 'x', 4, [], true]) expect(sanitizePrefs(bad)).toEqual(defaultPrefs())
  })

  it('keeps good values and drops bad ones one by one', () => {
    const p = sanitizePrefs({ scale: 1.25, contrast: 'high', density: 'wide', motion: 'reduce', palette: 'colorblind', pinned: ['desk:tech', 5, 'tab:economy:bank'], recents: 'nope' })
    expect(p.scale).toBe(1.25)
    expect(p.contrast).toBe('high')
    expect(p.density).toBe('comfortable')
    expect(p.motion).toBe('reduce')
    expect(p.palette).toBe('colorblind')
    expect(p.pinned).toEqual(['desk:tech', 'tab:economy:bank'])
    expect(p.recents).toEqual([])
  })

  it('refuses a text size the interface was never built for', () => {
    expect(sanitizePrefs({ scale: 3 }).scale).toBe(1)
    expect(sanitizePrefs({ scale: '1.25' }).scale).toBe(1)
  })

  it('caps the lists, removes repeats and clamps desk widths', () => {
    const many = Array.from({ length: 40 }, (_, i) => `desk:d${i}`)
    const p = sanitizePrefs({ pinned: [...many, ...many], recents: many, panelWidths: { economy: 5000, military: 10, bad: 'x' }, lastTabs: { economy: 'bank', bad: 7 } })
    expect(p.pinned).toHaveLength(MAX_PINNED)
    expect(p.recents).toHaveLength(MAX_RECENTS)
    expect(p.panelWidths).toEqual({ economy: PANEL_WIDTH.max, military: PANEL_WIDTH.min })
    expect(p.lastTabs).toEqual({ economy: 'bank' })
  })

  it('survives a stored value that went through JSON', () => {
    const p = { ...defaultPrefs(), scale: 1.1 as const, pinned: ['desk:log'] }
    expect(sanitizePrefs(JSON.parse(JSON.stringify(p)))).toEqual(p)
  })
})

describe('settings migration', () => {
  it('keeps the old reduce motion choice for settings saved before preferences existed', () => {
    expect(migrateSettingsUi({ reducedMotion: true }).motion).toBe('reduce')
    expect(migrateSettingsUi({ reducedMotion: false }).motion).toBe('system')
    expect(migrateSettingsUi({}).motion).toBe('system')
    expect(migrateSettingsUi(null)).toEqual(defaultPrefs())
  })

  it('uses the stored preferences when there are some, whatever the old switch says', () => {
    expect(migrateSettingsUi({ reducedMotion: true, ui: { motion: 'full' } }).motion).toBe('full')
  })

  it('never lets a broken ui value break the settings', () => {
    expect(migrateSettingsUi({ ui: 'garbage' }).scale).toBe(1)
  })
})

describe('loading an old settings blob', () => {
  const old = JSON.parse('{"reducedMotion":true,"fxSpeed":2,"battleScenes":"mine","seenHelp":true,"monthlyReport":false,"showGuide":true,"pauseOnBattles":false,"liveReport":"note","liveSpeed":1}')

  it('keeps the old reduce motion choice and gives every new preference its default', () => {
    expect(migrateSettingsUi(old)).toEqual({ ...defaultPrefs(), motion: 'reduce' })
  })

  it('round-trips through JSON once migrated', () => {
    const ui = migrateSettingsUi(old)
    expect(migrateSettingsUi({ ui: JSON.parse(JSON.stringify(ui)) })).toEqual(ui)
  })
})

describe('recents and pins', () => {
  it('puts the newest recent first, once', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(pushRecent(['a'], 'z')).toEqual(['z', 'a'])
  })

  it('drops the oldest past the limit', () => {
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })

  it('toggles a pin and refuses one more than the limit', () => {
    expect(togglePinned([], 'desk:tech')).toEqual(['desk:tech'])
    expect(togglePinned(['desk:tech'], 'desk:tech')).toEqual([])
    const full = Array.from({ length: MAX_PINNED }, (_, i) => `desk:d${i}`)
    expect(togglePinned(full, 'desk:new')).toEqual(full)
    expect(togglePinned(full, 'desk:d0')).toHaveLength(MAX_PINNED - 1)
  })
})

describe('motion and page attributes', () => {
  it('follows the system only when asked to', () => {
    expect(motionReduced('system', true)).toBe(true)
    expect(motionReduced('system', false)).toBe(false)
    expect(motionReduced('reduce', false)).toBe(true)
    expect(motionReduced('full', true)).toBe(false)
  })

  it('describes the page root for the stylesheet', () => {
    const a = rootAttributes({ ...defaultPrefs(), contrast: 'high', palette: 'colorblind', scale: 1.25 }, true)
    expect(a).toEqual({ 'data-scale': '1.25', 'data-contrast': 'high', 'data-density': 'comfortable', 'data-palette': 'colorblind', 'data-motion': 'reduced' })
  })

  it('clamps desk widths', () => {
    expect(clampWidth(10)).toBe(PANEL_WIDTH.min)
    expect(clampWidth(99999)).toBe(PANEL_WIDTH.max)
    expect(clampWidth(612.4)).toBe(612)
  })
})
