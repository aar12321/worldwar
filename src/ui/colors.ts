import { Color } from 'three'

const cache = new Map<string, string>()

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
