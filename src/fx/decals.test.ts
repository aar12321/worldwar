import { describe, expect, it } from 'vitest'
import { absDay } from '../engine/calendar'
import type { SalvoReport } from '../engine/types'
import { DECAL_DAYS, decalSpecs } from './decals'

const report = (over: Partial<SalvoReport> = {}): SalvoReport => ({ id: 'r1', turn: 3, day: 5, from: 'a', to: 'b', region: 'x', weapon: 'missile', kind: 'ballistic', aim: 'country', fired: 6, hit: 5, shield: 0, batteries: 0, patrol: 0, fighters: 0, interceptorsUsed: 0, coverage: 1, dead: 1, line: 1, factories: true, buildings: 0, army: 0, stock: 0, site: false, aircraftLost: 0, place: 'X', news: '', ...over })
const at = { x: { lat: 10, lng: 20 } }

describe('decals', () => {
  it('fade with the days since the strike, embers first and scorch last', () => {
    const day = absDay(3, 5)
    const kinds = (age: number) => decalSpecs([report()], day + age, at).map((d) => d.kind)
    expect(kinds(0)).toEqual(expect.arrayContaining(['scorch', 'ember', 'smoke', 'fire', 'crater']))
    expect(kinds(DECAL_DAYS.ember + 1)).not.toContain('ember')
    expect(kinds(DECAL_DAYS.ember + 1)).toContain('smoke')
    expect(kinds(DECAL_DAYS.smoke + 1)).not.toContain('smoke')
    expect(kinds(DECAL_DAYS.fire + 1)).not.toContain('fire')
    expect(kinds(DECAL_DAYS.scorch - 1)).toContain('scorch')
    expect(kinds(DECAL_DAYS.scorch + 1)).toEqual([])
  })

  it('skips reports that hit nothing or have no place, and keeps only the newest cap', () => {
    expect(decalSpecs([report({ hit: 0 })], absDay(3, 5), at)).toEqual([])
    expect(decalSpecs([report({ region: 'nowhere' })], absDay(3, 5), at)).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => report({ id: `r${i}` }))
    expect(decalSpecs(many, absDay(3, 5), at, 24).length).toBe(24)
  })
})
