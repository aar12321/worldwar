import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, Scene } from 'three'
import { describe, expect, it } from 'vitest'
import { NEON, tint } from '../colors'
import { findRegionParts, paintParts } from './polygonPaint'

/** A piece of a country as three-globe builds it: a group holding the sides-and-cap mesh (two materials) and an outline. */
function piece(feature: object, materials = 2) {
  const group = new Group() as Group & { __globeObjType?: string; __data?: object }
  group.__globeObjType = 'polygon'
  group.__data = { data: feature }
  const mats = Array.from({ length: materials }, () => new MeshBasicMaterial())
  group.add(new Mesh(new BoxGeometry(), materials === 1 ? mats[0] : mats))
  return group
}

const regionOf = (f: object) => (f as { id: string }).id
const hex = (m: unknown) => `#${(m as MeshBasicMaterial).color.getHexString()}`
const materialsOf = (g: Group) => (g.children[0] as Mesh).material as MeshBasicMaterial[]

describe('painting one country in place', () => {
  const france = { id: 'france' }
  const spain = { id: 'spain' }

  it('finds every piece of every country, however the scene is nested', () => {
    const scene = new Scene()
    const a = piece(france)
    const b = piece(france)
    const c = piece(spain)
    const inner = new Group()
    inner.add(b, c)
    scene.add(a, inner, new Group(), new Mesh())
    const found = findRegionParts(scene, regionOf)
    expect([...found.keys()].sort()).toEqual(['france', 'spain'])
    expect(found.get('france')?.parts).toEqual([a, b])
    expect(found.get('france')?.feature).toBe(france)
    expect(found.get('spain')?.parts).toEqual([c])
  })

  it('sets the sides and the cap on every piece, to the colors the globe would give them', () => {
    const scene = new Scene()
    const a = piece(france)
    const b = piece(france)
    scene.add(a, b)
    const parts = findRegionParts(scene, regionOf).get('france')!.parts
    const cap = tint('#3a6ea5', 0.1)
    const side = tint(cap, -0.2)
    expect(paintParts(parts, cap, side)).toBe(true)
    for (const g of [a, b]) {
      const [sides, top] = materialsOf(g)
      expect(hex(sides)).toBe(side)
      expect(hex(top)).toBe(cap)
      // The globe writes a hex number to the same materials. Both ways land on the same color.
      expect(top.color.getHex()).toBe(new Color().set(parseInt(cap.slice(1), 16)).getHex())
    }
  })

  it('reads colors the way the globe does for the neon target color too', () => {
    const scene = new Scene()
    scene.add(piece(france))
    const parts = findRegionParts(scene, regionOf).get('france')!.parts
    const cap = tint(NEON.magenta, 0.14)
    paintParts(parts, cap, tint(cap, -0.2))
    const top = materialsOf(parts[0] as Group)[1]
    const expected = new Color().set(parseInt(cap.slice(1), 16))
    expect([top.color.r, top.color.g, top.color.b]).toEqual([expected.r, expected.g, expected.b])
  })

  it('does not touch the other countries', () => {
    const scene = new Scene()
    const a = piece(france)
    const b = piece(spain)
    scene.add(a, b)
    const before = hex(materialsOf(b)[1])
    paintParts(findRegionParts(scene, regionOf).get('france')!.parts, '#ff0000', '#880000')
    expect(hex(materialsOf(b)[1])).toBe(before)
  })

  it('says no, and paints nothing, when the pieces are gone or are not what is expected', () => {
    const scene = new Scene()
    const good = piece(france)
    const odd = piece(france, 1)
    scene.add(good, odd)
    const parts = findRegionParts(scene, regionOf).get('france')!.parts
    const before = hex(materialsOf(good)[1])
    expect(paintParts(parts, '#ff0000', '#880000')).toBe(false)
    expect(hex(materialsOf(good)[1])).toBe(before)
    expect(paintParts([], '#ff0000', '#880000')).toBe(false)
    const lone = piece(france)
    expect(paintParts([lone], '#ff0000', '#880000')).toBe(false) // Not in a scene any more.
  })
})
