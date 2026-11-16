import { describe, expect, it } from 'vitest'
import { DESKS, allDesks, buildRegistry, crumbs, currentTab, duplicateKeys, findDesk, findTab, groupedNav, navDesks, pinId, resolvePin, tabLabel, targetForKey, visibleTabs, type DeskDef, type RegCtx } from './registry'
import { NO_CTX, shortcutRows, shortcutsFor, stepIndex } from './shortcuts'

const turns: RegCtx = { ...NO_CTX }
const live: RegCtx = { ...NO_CTX, live: true, wars: 2, armies: 3, offers: 1, urgent: 2 }

/** Keys the game keeps for itself, so no desk or tab may claim them. */
const RESERVED = ['a', '?', '/', ' ', '1', '2', '3', '4', '5', '6', '[', ']', 'enter', 'escape']

describe('the desk registry', () => {
  it('lists every desk once, with a unique id', () => {
    const ids = allDesks().map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['briefing', 'economy', 'military', 'diplomacy', 'empire', 'tech', 'log', 'settings']))
  })

  it('gives no key to two desks or tabs, and none of the keys the game keeps', () => {
    expect(duplicateKeys()).toEqual([])
    for (const d of allDesks()) {
      for (const k of [d.key, ...(d.aliases ?? []), ...(d.tabs ?? []).map((t) => t.key ?? '')]) expect(RESERVED).not.toContain(k)
    }
  })

  it('keeps tab ids unique inside a desk and gives every tab a label', () => {
    for (const d of allDesks()) {
      const ids = (d.tabs ?? []).map((t) => t.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const t of d.tabs ?? []) expect(t.label.length).toBeGreaterThan(0)
    }
  })

  it('can draw every desk it lists: a loader, or tabs and bodies for the game to draw', () => {
    for (const d of allDesks()) {
      const custom = d.shell === 'custom' || (d.shell === undefined && !!d.load)
      if (custom) expect(d.load, d.id).toBeTypeOf('function')
      else expect(!!d.body || (d.tabs ?? []).every((t) => typeof t.load === 'function'), d.id).toBe(true)
    }
  })

  it('names every tab of the Economy desk that the player had before', () => {
    expect(findDesk('economy')?.tabs?.map((t) => t.id)).toEqual(['country', 'people', 'budget', 'bank', 'business', 'projects', 'space', 'market', 'stocks', 'government'])
  })

  it('shows the rail desks in order, grouped, and keeps News and Settings out of it', () => {
    const ids = navDesks(turns).map((d) => d.id)
    expect(ids).toEqual(['briefing', 'economy', 'empire', 'tech', 'military', 'diplomacy', 'relations', 'faction'])
    expect(groupedNav(turns).map((g) => [g.id, g.desks.length])).toEqual([
      ['home', 1],
      ['nation', 3],
      ['world', 4],
    ])
  })
})

describe('tabs by kind of game', () => {
  it('shows the Armies tab only in a live game', () => {
    expect(visibleTabs('military', turns).map((t) => t.id)).toEqual(['forces', 'deploy', 'theatres', 'wars', 'missiles', 'agencies', 'systems'])
    expect(visibleTabs('military', live).map((t) => t.id)).toEqual(['forces', 'deploy', 'theatres', 'armies', 'wars', 'missiles', 'agencies', 'systems'])
  })

  it('writes a count on a tab that has one', () => {
    const wars = findTab('military', 'wars')!
    expect(tabLabel(wars, live)).toBe('Wars (2)')
    expect(tabLabel(wars, turns)).toBe('Wars')
  })

  it('counts what needs you on the desks', () => {
    expect(findDesk('diplomacy')!.badge!(live)).toBe(1)
    expect(findDesk('briefing')!.badge!(live)).toBe(2)
    expect(findDesk('economy')!.badge).toBeUndefined()
    expect(findDesk('faction')!.badge!({ ...live, factionDue: 2 })).toBe(2)
  })
})

describe('keys', () => {
  it('opens desks by key and by alias', () => {
    expect(targetForKey('e', turns)).toEqual({ desk: 'economy' })
    expect(targetForKey('c', turns)).toEqual({ desk: 'economy' })
    expect(targetForKey('R', turns)).toEqual({ desk: 'tech' })
    expect(targetForKey('t', turns)).toEqual({ desk: 'tech' })
    expect(targetForKey('n', turns)).toEqual({ desk: 'log' })
  })

  it('opens a tab by its key', () => {
    expect(targetForKey('w', turns)).toEqual({ desk: 'military', tab: 'wars' })
  })

  it('does not open a desk or tab that is hidden in this kind of game', () => {
    const hidden: DeskDef[] = [
      { id: 'a', label: 'A', icon: 'x', key: 'g', group: 'world', order: 1, visible: (c) => c.live },
      { id: 'b', label: 'B', icon: 'x', key: 'h', group: 'world', order: 2, tabs: [{ id: 't', label: 'T', key: 'j', visible: (c) => c.live }] },
    ]
    expect(targetForKey('g', turns, hidden)).toBeNull()
    expect(targetForKey('g', live, hidden)).toEqual({ desk: 'a' })
    expect(targetForKey('j', turns, hidden)).toBeNull()
    expect(targetForKey('j', live, hidden)).toEqual({ desk: 'b', tab: 't' })
  })

  it('ignores keys nothing uses', () => {
    for (const k of ['x', 'q', '9', '', 'Enter']) expect(targetForKey(k, turns)).toBeNull()
  })

  it('lists every desk and tab key on the shortcut sheet, and live-only keys only in a live game', () => {
    const turnRows = shortcutRows(turns)
    const keysOf = (rows: ReturnType<typeof shortcutRows>) => rows.flatMap((r) => r.keys)
    for (const k of ['B', 'E', 'M', 'D', 'R', 'I', 'N', 'W', 'Enter', '?', 'Ctrl+K']) expect(keysOf(turnRows)).toContain(k)
    expect(keysOf(turnRows)).not.toContain('Space')
    expect(keysOf(shortcutRows(live))).toContain('Space')
    expect(shortcutRows(live).map((r) => r.label)).not.toContain('Next turn')
    expect(turnRows.map((r) => r.label)).toContain('Next turn')
  })

  it('still writes the one-line key list', () => {
    expect(shortcutsFor(false)).toContain('E economy')
    expect(shortcutsFor(true)).toContain('Space: play or pause')
  })

  it('steps through tabs and wraps round', () => {
    expect(stepIndex(0, 4, -1)).toBe(3)
    expect(stepIndex(3, 4, 1)).toBe(0)
    expect(stepIndex(1, 4, 1)).toBe(2)
    expect(stepIndex(0, 0, 1)).toBe(0)
  })
})

describe('adding a desk or a tab in one place', () => {
  const faction: DeskDef = {
    id: 'bases',
    label: 'Bases',
    icon: 'flag',
    key: 'z',
    group: 'world',
    order: 55,
    tabs: [{ id: 'members', label: 'Members', load: async () => ({ default: () => null }) }],
  }

  it('adds a dropped-in desk in its place in the rail, with its key', () => {
    const reg = buildRegistry(DESKS, [{ desks: [faction] }])
    expect(reg.map((d) => d.id).indexOf('bases')).toBe(reg.map((d) => d.id).indexOf('military') + 1)
    expect(reg.find((d) => d.id === 'bases')!.tabs).toHaveLength(1)
  })

  it('adds a tab to a desk that exists, and ignores one for a desk that does not', () => {
    const reg = buildRegistry(DESKS, [{ tabs: [{ desk: 'military', id: 'space', label: 'Space', key: 'p' }, { desk: 'nowhere', id: 'x', label: 'X' }] }])
    expect(reg.find((d) => d.id === 'military')!.tabs!.map((t) => t.id)).toContain('space')
    expect(reg.some((d) => d.id === 'nowhere')).toBe(false)
    expect(duplicateKeys(reg)).toEqual([])
  })

  it('does not let a second registration replace the first, and spots a clash of keys', () => {
    const reg = buildRegistry(DESKS, [{ desks: [{ ...faction, id: 'economy', label: 'Fake' }, { ...faction, id: 'other', key: 'e' }] }])
    expect(reg.find((d) => d.id === 'economy')!.label).toBe('Economy')
    expect(reg.filter((d) => d.id === 'economy')).toHaveLength(1)
    expect(duplicateKeys(reg)).toEqual(['e'])
  })

  it('leaves the built-in list as it was', () => {
    const before = DESKS.length
    buildRegistry(DESKS, [{ desks: [faction] }])
    expect(DESKS).toHaveLength(before)
    expect(findDesk('military')!.tabs!.some((t) => t.id === 'space')).toBe(false)
  })
})

describe('pins, breadcrumbs and the tab a desk is on', () => {
  it('writes and reads back a pin', () => {
    expect(pinId('economy', 'bank')).toBe('tab:economy:bank')
    expect(pinId('tech')).toBe('desk:tech')
    expect(resolvePin('tab:economy:bank', turns)).toMatchObject({ label: 'Bank' })
    expect(resolvePin('desk:tech', turns)).toMatchObject({ label: 'Research' })
  })

  it('drops pins that no longer lead anywhere', () => {
    expect(resolvePin('tab:economy:gone', turns)).toBeNull()
    expect(resolvePin('desk:gone', turns)).toBeNull()
    expect(resolvePin('tab:military:armies', turns)).toBeNull()
    expect(resolvePin('tab:military:armies', live)).not.toBeNull()
    expect(resolvePin('nonsense', turns)).toBeNull()
  })

  it('names where you are', () => {
    expect(crumbs('economy', 'bank')).toEqual(['Economy', 'Bank'])
    expect(crumbs('tech', undefined)).toEqual(['Research'])
    expect(crumbs('nope', 'x')).toEqual([])
  })

  it('reads the tab from wherever the store keeps it', () => {
    const mem = { economyTab: 'bank', militaryTab: 'wars', empireTab: 'world', deskTabs: { faction: 'members' } }
    expect(currentTab(mem, 'economy')).toBe('bank')
    expect(currentTab(mem, 'military')).toBe('wars')
    expect(currentTab(mem, 'empire')).toBe('world')
    expect(currentTab(mem, 'faction')).toBe('members')
    expect(currentTab(mem, 'unknown-desk')).toBeUndefined()
    expect(currentTab({ ...mem, deskTabs: {} }, 'settings')).toBe('look')
  })
})
