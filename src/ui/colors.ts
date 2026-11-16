import type { Terrain } from '../engine/types'

/**
 * Small color helpers for the map and the battle window. They give the same results as three.js's Color, which works in linear
 * light (mixing, shifting hue and lightness, and the channels it reports), without loading three.js before the globe needs it.
 */

type RGB = [number, number, number]

const cache = new Map<string, string>()

const TERRAIN_WASH: Record<Terrain, string> = {
  plains: '#e4d2a0',
  forest: '#1d6a3c',
  mountain: '#a3988c',
  desert: '#e6c27a',
  urban: '#d0cbc2',
}

const toLinear = (c: number) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4))
const toSrgb = (c: number) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055)

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 1) + 1) % 1
  s = Math.min(1, Math.max(0, s))
  l = Math.min(1, Math.max(0, l))
  if (s === 0) return [l, l, l]
  const p = l <= 0.5 ? l * (1 + s) : l + s - l * s
  const q = 2 * l - p
  const hue = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return q + (p - q) * 6 * t
    if (t < 1 / 2) return p
    if (t < 2 / 3) return q + (p - q) * 6 * (2 / 3 - t)
    return q
  }
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)]
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (min + max) / 2
  if (min === max) return [0, 0, l]
  const d = max - min
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6
  return [h, s, l]
}

/** A CSS color (#rgb, #rrggbb, rgb(), hsl()) as sRGB components from 0 to 1. Anything else reads as white. */
export function parseColor(css: string): RGB {
  const c = css.trim().toLowerCase()
  if (c.startsWith('#')) {
    const hex = c.slice(1)
    const full = hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex
    const n = parseInt(full.slice(0, 6), 16)
    if (Number.isFinite(n)) return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }
  const m = c.match(/^(rgb|hsl)a?\(([^)]*)\)$/)
  if (m) {
    const parts = m[2].split(/[\s,/]+/).filter(Boolean)
    const num = (x: string) => parseFloat(x)
    if (m[1] === 'rgb') return [0, 1, 2].map((i) => Math.min(255, Math.max(0, parts[i]?.endsWith('%') ? num(parts[i]) * 2.55 : num(parts[i] ?? '0'))) / 255) as RGB
    return hslToRgb(num(parts[0] ?? '0') / 360, num(parts[1] ?? '0') / 100, num(parts[2] ?? '0') / 100)
  }
  return [1, 1, 1]
}

const hexOf = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`

/** Keep the political color, with a little of the land's character so a large country is not one flat sticker. */
export function wash(base: string, terrain: Terrain): string {
  const amount = terrain === 'plains' ? 0.1 : terrain === 'urban' ? 0.08 : 0.16
  return mix(base, TERRAIN_WASH[terrain], amount)
}

/** `a` moved a share `t` of the way toward `b`, mixed in linear light. */
export function mix(a: string, b: string, t: number): string {
  const key = `mix|${a}|${b}|${t}`
  let out = cache.get(key)
  if (!out) {
    const x = parseColor(a).map(toLinear)
    const y = parseColor(b).map(toLinear)
    out = hexOf([0, 1, 2].map((i) => toSrgb(x[i] + (y[i] - x[i]) * t)) as RGB)
    cache.set(key, out)
  }
  return out
}

/** Shift a CSS color's lightness (and optionally saturation). */
export function tint(css: string, lightness: number, saturation = 0): string {
  const key = `${css}|${lightness}|${saturation}`
  let out = cache.get(key)
  if (!out) {
    const [h, s, l] = rgbToHsl(parseColor(css).map(toLinear) as RGB)
    out = hexOf(hslToRgb(h, s + saturation, l + lightness).map(toSrgb) as RGB)
    cache.set(key, out)
  }
  return out
}

/** The color with transparency. Its channels are in linear light, as three.js reported them, so the map looks as it always has. */
export function withAlpha(css: string, alpha: number): string {
  const [r, g, b] = parseColor(css).map(toLinear)
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

export const NEON = {
  cyan: '#22d3ee',
  magenta: '#e879f9',
  amber: '#fbbf24',
  red: '#f43f5e',
  green: '#34d399',
}

/** Colors for the Relations map mode. The globe and its legend read the same table. */
export const RELATION_COLORS = { yours: '#0a84ff', ally: '#30d158', pact: '#64d2ff', war: '#ff453a', other: '#5b6270' }
/** Fronts mode: a full Defense Line is the strong color, a broken one fades toward the pale color. */
export const FRONT_COLORS = { yours: '#0a84ff', enemy: '#ff453a', weak: '#f1e3c8', other: '#3d434e' }

/** The same two tables for people who cannot tell red from green: blue and yellow for friends, vermillion for enemies. */
export const RELATION_COLORS_CB = { yours: '#0a84ff', ally: '#f0e442', pact: '#cc79a7', war: '#d55e00', other: '#5b6270' }
export const FRONT_COLORS_CB = { yours: '#0a84ff', enemy: '#d55e00', weak: '#f1e3c8', other: '#3d434e' }

/** The map tables for the chosen palette. The globe and its legend both read through these. */
export const relationColors = (palette: 'standard' | 'colorblind') => (palette === 'colorblind' ? RELATION_COLORS_CB : RELATION_COLORS)
export const frontColors = (palette: 'standard' | 'colorblind') => (palette === 'colorblind' ? FRONT_COLORS_CB : FRONT_COLORS)
