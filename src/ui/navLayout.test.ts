import { describe, expect, it } from 'vitest'
import { phoneSlots, splitForPhone } from './navLayout'

const desks = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}` }))

describe('phoneSlots', () => {
  it('fits 6 desks on a normal phone and never fewer than 4', () => {
    expect(phoneSlots(390)).toBe(6)
    expect(phoneSlots(320)).toBe(5)
    expect(phoneSlots(200)).toBe(4)
  })
})

describe('splitForPhone', () => {
  it('shows every desk when they fit and nothing is pinned', () => {
    const s = splitForPhone(desks(6), 'd0', 6, false)
    expect(s.shown).toHaveLength(6)
    expect(s.hasMore).toBe(false)
  })

  it('gives the last slot to More when there are too many desks', () => {
    const s = splitForPhone(desks(9), 'd0', 6, false)
    expect(s.shown.map((d) => d.id)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4'])
    expect(s.more.map((d) => d.id)).toEqual(['d5', 'd6', 'd7', 'd8'])
    expect(s.hasMore).toBe(true)
  })

  it('also shows More when something is pinned, so pins are reachable', () => {
    const s = splitForPhone(desks(6), null, 6, true)
    expect(s.hasMore).toBe(true)
    expect(s.shown).toHaveLength(5)
  })

  it('keeps the open desk in the bar even if it would have gone behind More', () => {
    const s = splitForPhone(desks(9), 'd7', 6, false)
    expect(s.shown.map((d) => d.id)).toContain('d7')
    expect(s.shown).toHaveLength(5)
    expect(s.more.map((d) => d.id)).not.toContain('d7')
    expect(s.shown.length + s.more.length).toBe(9)
  })
})

describe('the desktop layout beside the nav rail', async () => {
  // The stylesheet as written (a CSS import is empty under the test runner, and the app's types know no node:fs).
  const fsName = 'node:fs'
  const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: URL, enc: 'utf8') => string }
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  /** A px value from the first top-level rule for `selector` in index.css. */
  const px = (selector: string, prop: string) => {
    const block = css.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm'))?.[1] ?? ''
    return Number(block.match(new RegExp(`\\b${prop}: (\\d+)px`))?.[1])
  }

  it('the armies dock starts right of the rail, where the drawer does, so its cards are not cut in half', () => {
    const railEnd = px('.nav-dock', 'left') + px('.nav-dock', 'width')
    expect(railEnd).toBeGreaterThan(80)
    expect(px('.armies-dock', 'left')).toBeGreaterThan(railEnd)
    expect(px('.armies-dock', 'left')).toBe(px('.drawer', 'left'))
  })

  it('on a phone the live clock bar is as wide as the screen, so nothing in it hangs outside the box', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 900px)'))
    const rule = phone.match(/\n  \.hud-live \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/max-width: none !important/)
  })
})
