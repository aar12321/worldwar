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

/** A live battle shown on the globe at its site: a Defense Line bar that drains, then who won. */
export interface BattleOverlay {
  id: string
  lat: number
  lng: number
  place: string
  before: number
  after: number
  max: number
  captured: boolean
  /** Whether the attacker won the fight. */
  attackerWon: boolean
  /** Whether it was the player's army or country. Only those show the bar. */
  mine: boolean
}

interface FxState {
  rings: FxRing[]
  battles: BattleOverlay[]
  shakeKey: number
  shakeStrength: number
  /** Battle whose outcome has been revealed by the cinematic (its result banner is showing). */
  revealedBattleId: string | null
  addRing(ring: Omit<FxRing, 'id'>, ttlMs: number): void
  addBattle(battle: BattleOverlay, ttlMs: number): void
  shake(strength: number): void
  reveal(battleId: string | null): void
}

let ringId = 1

export const useFx = create<FxState>((set) => ({
  rings: [],
  battles: [],
  shakeKey: 0,
  shakeStrength: 1,
  revealedBattleId: null,
  reveal(battleId) {
    set({ revealedBattleId: battleId })
  },
  addRing(ring, ttlMs) {
    const id = ringId++
    set((s) => ({ rings: [...s.rings, { ...ring, id }] }))
    setTimeout(() => set((s) => ({ rings: s.rings.filter((r) => r.id !== id) })), ttlMs)
  },
  addBattle(battle, ttlMs) {
    set((s) => ({ battles: [...s.battles.filter((b) => b.id !== battle.id), battle] }))
    setTimeout(() => set((s) => ({ battles: s.battles.filter((b) => b.id !== battle.id) })), ttlMs)
  },
  shake(strength) {
    set((s) => ({ shakeKey: s.shakeKey + 1, shakeStrength: strength }))
  },
}))

// A handle for browser tests, in development only.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __globeBridge: typeof globeBridge }).__globeBridge = globeBridge
