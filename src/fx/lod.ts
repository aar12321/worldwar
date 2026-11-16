/**
 * Level of detail: how much to draw for how big things are on screen. Zoomed out, a missile is a few pixels: its smoke, sparks and
 * debris cannot be seen, so they are not spawned at all, and a crowd of impacts becomes one bigger one.
 */
export type Lod = 'far' | 'mid' | 'near'

/** Pixels per world unit (globe radius 100) where the globe is ~220px across (far) or ~700px across (near). */
export const LOD_FAR = 1.1
export const LOD_NEAR = 3.4

export const lodOf = (pxPerUnit: number): Lod => (pxPerUnit < LOD_FAR ? 'far' : pxPerUnit < LOD_NEAR ? 'mid' : 'near')

/** A sprite smaller than this on screen is not worth a draw call. */
export const MIN_SPRITE_PX = 2.5

export const worthDrawing = (sizeUnits: number, pxPerUnit: number) => sizeUnits * pxPerUnit >= MIN_SPRITE_PX

/** Particles to spawn for an effect that would spawn `n` up close: none far away, fewer at mid range. */
export const particlesFor = (n: number, lod: Lod) => (lod === 'far' ? 0 : lod === 'mid' ? Math.ceil(n * 0.5) : n)

/**
 * Impacts to play for a salvo that landed `hits` missiles when `free` effect slots are available: they are clustered into fewer, bigger
 * blasts when slots or zoom are short. Returns how many blasts and how big each is, relative to one.
 */
export function clusterImpacts(hits: number, free: number, lod: Lod): { blasts: number; scale: number } {
  if (hits <= 0) return { blasts: 0, scale: 1 }
  const room = Math.max(1, free - 4)
  const wish = lod === 'far' ? 1 : lod === 'mid' ? Math.min(hits, 4) : hits
  const blasts = Math.max(1, Math.min(wish, room, 12))
  return { blasts, scale: blasts >= hits ? 1 : 1 + 0.35 * Math.log2(hits / blasts) }
}

/** Trail segments per flight given a frame budget of segments and the number of flights drawn in full. */
export const segmentsPerFlight = (budget: number, flights: number, max = 12, min = 3) => (flights <= 0 ? max : Math.max(min, Math.min(max, Math.floor(budget / flights))))
