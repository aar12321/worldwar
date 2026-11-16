import { absDay } from '../engine/calendar'
import type { SalvoReport } from '../engine/types'
import type { DecalSpec } from './engine'

/**
 * Scorch marks, craters, embers, smoke and the glow of burning factories, worked out from the salvo reports and today's date alone, so
 * they are the same for every player, survive a save and need no state. Each fades over game days: embers in 3, smoke in 9, scorch in 28.
 */
export const DECAL_DAYS = { ember: 3, smoke: 9, scorch: 28, crater: 28, fire: 5 }

export function decalSpecs(salvos: readonly SalvoReport[] | undefined, now: number, at: Record<string, { lat: number; lng: number } | undefined>, cap = 24): DecalSpec[] {
  const out: DecalSpec[] = []
  for (const r of salvos ?? []) {
    if (r.hit <= 0) continue
    const p = at[r.region]
    if (!p) continue
    const age = Math.max(0, now - absDay(r.turn, r.day ?? 0))
    const size = 0.5 + Math.min(1.6, Math.sqrt(r.hit) * 0.16 + r.dead * 0.05 + r.line * 0.04)
    const add = (kind: DecalSpec['kind'], days: number, radius: number, max: number) => {
      const a = 1 - age / days
      if (a > 0.02) out.push({ id: `${r.id}${kind}`, lat: p.lat, lng: p.lng, radius, kind, alpha: Math.min(1, a) * max })
    }
    add('scorch', DECAL_DAYS.scorch, size, 0.85)
    if (r.hit >= 4) add('crater', DECAL_DAYS.crater, size * 0.7, 0.8)
    add('ember', DECAL_DAYS.ember, size * 0.55, 0.9)
    add('smoke', DECAL_DAYS.smoke, size * 1.5, 0.55)
    // Secondary fires where factories or a missile site were hit: a glow that lasts a few days.
    if (r.factories || r.site) add('fire', DECAL_DAYS.fire, size * 0.8, 0.95)
  }
  return out.sort((a, b) => b.alpha - a.alpha).slice(0, cap)
}
