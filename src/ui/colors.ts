import { Color } from 'three'
import type { Terrain } from '../engine/types'

const cache = new Map<string, string>()

const TERRAIN_WASH: Record<Terrain, string> = {
  plains: '#e4d2a0',
  forest: '#1d6a3c',
  mountain: '#a3988c',
  desert: '#e6c27a',
  urban: '#d0cbc2',
}

/** Keep the political color, with a little of the land's character so a large country is not one flat sticker. */
export function wash(base: string, terrain: Terrain): string {
  const amount = terrain === 'plains' ? 0.1 : terrain === 'urban' ? 0.08 : 0.16
  return mix(base, TERRAIN_WASH[terrain], amount)
}

export function mix(a: string, b: string, t: number): string {
  const key = `mix|${a}|${b}|${t}`
  let out = cache.get(key)
  if (!out) {
    const from = new Color(a)
    from.lerp(new Color(b), t)
    out = `#${from.getHexString()}`
    cache.set(key, out)
  }
  return out
}

/** Shift a CSS color's lightness (and optionally saturation), returning a CSS rgb() string. */
export function tint(css: string, lightness: number, saturation = 0): string {
  const key = `${css}|${lightness}|${saturation}`
  let out = cache.get(key)
  if (!out) {
    const c = new Color()
    c.setStyle(css)
    c.offsetHSL(0, saturation, lightness)
    out = `#${c.getHexString()}`
    cache.set(key, out)
  }
  return out
}

export function withAlpha(css: string, alpha: number): string {
  const c = new Color()
  c.setStyle(css)
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`
}

export const NEON = {
  cyan: '#22d3ee',
  magenta: '#e879f9',
  amber: '#fbbf24',
  red: '#f43f5e',
  green: '#34d399',
}
