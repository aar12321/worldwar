import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { mix, tint, withAlpha } from './colors'

/** What the helpers gave when they were built on three.js's Color. */
const threeMix = (a: string, b: string, t: number) => `#${new Color(a).lerp(new Color(b), t).getHexString()}`
const threeTint = (css: string, l: number, s = 0) => {
  const c = new Color()
  c.setStyle(css)
  c.offsetHSL(0, s, l)
  return `#${c.getHexString()}`
}
const threeAlpha = (css: string, a: number) => {
  const c = new Color()
  c.setStyle(css)
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a})`
}
const near = (a: string, b: string) => {
  const ch = (x: string, i: number) => parseInt(x.slice(1 + i * 2, 3 + i * 2), 16)
  for (let i = 0; i < 3; i++) expect(Math.abs(ch(a, i) - ch(b, i))).toBeLessThanOrEqual(1)
}

describe('color helpers without three.js', () => {
  const colors = ['#0a84ff', '#ff453a', '#e4d2a0', '#1d6a3c', '#5b6270', '#f1e3c8', '#123', 'hsl(47, 70%, 55%)', 'hsl(300, 70%, 55%)']
  it('mix as three.js did', () => {
    for (const a of colors) for (const b of colors) for (const t of [0, 0.1, 0.16, 0.5, 0.9]) near(mix(a, b, t), threeMix(a, b, t))
  })
  it('tint as three.js did', () => {
    for (const c of colors) for (const [l, s] of [[0.1, 0], [-0.15, 0], [0.05, -0.2], [0.3, 0.1]]) near(tint(c, l, s), threeTint(c, l, s))
  })
  it('alpha as three.js did', () => {
    for (const c of colors) expect(withAlpha(c, 0.4)).toBe(threeAlpha(c, 0.4))
  })
})
