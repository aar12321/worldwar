import type { GlobeMethods } from 'react-globe.gl'
import { create } from 'zustand'

/** Lets non-globe components (battle FX) drive the camera and read screen positions. */
export const globeBridge: { api: GlobeMethods | null } = { api: null }

export interface FxRing {
  id: number
  lat: number
  lng: number
  color: string
  maxRadius: number
}

interface FxState {
  rings: FxRing[]
  shakeKey: number
  shakeStrength: number
  addRing(ring: Omit<FxRing, 'id'>, ttlMs: number): void
  shake(strength: number): void
}

let ringId = 1

export const useFx = create<FxState>((set) => ({
  rings: [],
  shakeKey: 0,
  shakeStrength: 1,
  addRing(ring, ttlMs) {
    const id = ringId++
    set((s) => ({ rings: [...s.rings, { ...ring, id }] }))
    setTimeout(() => set((s) => ({ rings: s.rings.filter((r) => r.id !== id) })), ttlMs)
  },
  shake(strength) {
    set((s) => ({ shakeKey: s.shakeKey + 1, shakeStrength: strength }))
  },
}))
