import type { Material, Mesh, MeshBasicMaterial, Object3D } from 'three'

/** What three-globe leaves on each piece of a country it draws: a group holding the cap-and-side mesh and the outline. */
type Part = Object3D & { __globeObjType?: string; __data?: { data?: object } }

export interface RegionParts {
  /** The country's own feature, so the globe's color accessors can be asked about it. */
  feature: object
  parts: Object3D[]
}

/** Finds every drawn piece of every country, grouped by country. Done once: the pieces live as long as the country list does. */
export function findRegionParts(scene: Object3D, regionOf: (feature: object) => string): Map<string, RegionParts> {
  const out = new Map<string, RegionParts>()
  scene.traverse((o) => {
    const part = o as Part
    const feature = part.__globeObjType === 'polygon' ? part.__data?.data : undefined
    if (!feature) return
    const id = regionOf(feature)
    const found = out.get(id)
    if (found) found.parts.push(o)
    else out.set(id, { feature, parts: [o] })
  })
  return out
}

/**
 * Sets the colors of one country's pieces in place, exactly as the globe's polygon layer would (it writes `color.set` on the same two
 * materials: sides first, then the cap). Returns false when the pieces are gone or not shaped as expected, so the caller can fall back
 * to repainting through the globe.
 */
export function paintParts(parts: Object3D[], cap: string, side: string): boolean {
  if (!parts.length) return false
  for (const part of parts) {
    const materials = (part.children[0] as Mesh | undefined)?.material as Material[] | undefined
    if (!part.parent || !Array.isArray(materials) || materials.length !== 2) return false
  }
  for (const part of parts) {
    const materials = (part.children[0] as Mesh).material as MeshBasicMaterial[]
    materials[0].color.set(side)
    materials[1].color.set(cap)
  }
  return true
}
