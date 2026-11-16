import { frameRect, getArt, type ArtClip } from '../art/MANIFEST'

/**
 * Drawing sprites from the art pack onto a 2D canvas, with the procedural look as a fallback when an atlas has not loaded (or is missing).
 * `Painter` wraps the context: it remembers the alpha and blend mode it set, so thousands of sprites do not mean thousands of state changes.
 */

export interface ArtImage {
  width: number
  height: number
}
type ArtLookup = (id: string) => { clip: ArtClip; image: ArtImage } | null

let lookup: ArtLookup = (id) => getArt(id)
/** Tests and the headless harness plug in fake atlases here. */
export function setArtProvider(fn: ArtLookup | null) {
  lookup = fn ?? ((id) => getArt(id))
}

// ---- names to small ids, so particles can store a sprite as one byte ----

export const SPRITE_IDS: string[] = []
const spriteIndex = new Map<string, number>()
export function spriteId(name: string): number {
  let i = spriteIndex.get(name)
  if (i === undefined) {
    i = SPRITE_IDS.length
    SPRITE_IDS.push(name)
    spriteIndex.set(name, i)
  }
  return i
}

export const COLORS: string[] = []
const colorIndex = new Map<string, number>()
export function colorId(css: string): number {
  let i = colorIndex.get(css)
  if (i === undefined) {
    if (COLORS.length >= 250) return 0
    i = COLORS.length
    COLORS.push(css)
    colorIndex.set(css, i)
  }
  return i
}
colorId('#ffffff')

// ---- tinted atlas copies (white sprites made any colour, once per colour) ----

const TINT_MAX = 14
const tintCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>()

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : null
}

function tinted(file: string, color: string, img: ArtImage): CanvasImageSource | null {
  const key = `${file}|${color}`
  const hit = tintCache.get(key)
  if (hit) return hit
  const c = makeCanvas(img.width, img.height)
  const g = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined
  if (!c || !g) return null
  g.drawImage(img as CanvasImageSource, 0, 0)
  g.globalCompositeOperation = 'multiply'
  g.fillStyle = color
  g.fillRect(0, 0, c.width, c.height)
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(img as CanvasImageSource, 0, 0)
  if (tintCache.size >= TINT_MAX) tintCache.delete(tintCache.keys().next().value as string)
  tintCache.set(key, c)
  return c as CanvasImageSource
}

// ---- procedural fallbacks: cached soft sprites for each family ----

const fallbackCache = new Map<string, HTMLCanvasElement | OffscreenCanvas | null>()

function fallbackFor(id: string, color: string): CanvasImageSource | null {
  const family = id.startsWith('smoke') || id.includes('smoke') || id.includes('dust') || id.includes('plume') ? 'smoke' : /ring|ping|shockwave/.test(id) ? 'ring' : /ember|debris|sparks|muzzle/.test(id) ? 'dot' : /sparkle|burst/.test(id) ? 'star' : /blast|fireball|flash|glow|mushroom/.test(id) ? 'glow' : ''
  if (!family) return null
  const key = `${family}|${color}`
  let c = fallbackCache.get(key)
  if (c === undefined) {
    c = makeCanvas(64, 64)
    const g = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined
    if (c && g) {
      if (family === 'ring') {
        g.strokeStyle = color
        g.lineWidth = 3
        g.beginPath()
        g.arc(32, 32, 28, 0, Math.PI * 2)
        g.stroke()
      } else if (family === 'star') {
        g.strokeStyle = color
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(32, 4)
        g.lineTo(32, 60)
        g.moveTo(4, 32)
        g.lineTo(60, 32)
        g.stroke()
        const r = g.createRadialGradient(32, 32, 0, 32, 32, 14)
        r.addColorStop(0, '#fff')
        r.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = r
        g.fillRect(0, 0, 64, 64)
      } else {
        const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
        if (family === 'smoke') {
          r.addColorStop(0, 'rgba(190,190,196,0.7)')
          r.addColorStop(1, 'rgba(190,190,196,0)')
        } else if (family === 'dot') {
          r.addColorStop(0, '#ffffff')
          r.addColorStop(0.35, color)
          r.addColorStop(1, 'rgba(0,0,0,0)')
        } else {
          r.addColorStop(0, '#ffffff')
          r.addColorStop(0.25, color)
          r.addColorStop(1, 'rgba(0,0,0,0)')
        }
        g.fillStyle = r
        g.fillRect(0, 0, 64, 64)
      }
    } else c = null
    fallbackCache.set(key, c)
  }
  return c as CanvasImageSource | null
}

export class Painter {
  ctx: CanvasRenderingContext2D
  dpr = 1
  private alpha = -1
  private mode = ''
  /** Sprites drawn from atlases and from fallbacks this frame, for the harness. */
  blits = 0

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx
  }

  begin(dpr: number) {
    this.dpr = dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.alpha = -1
    this.mode = ''
    this.blits = 0
  }

  setAlpha(a: number) {
    const v = a < 0 ? 0 : a > 1 ? 1 : a
    if (v !== this.alpha) {
      this.alpha = v
      this.ctx.globalAlpha = v
    }
  }

  setMode(additive: boolean) {
    const m = additive ? 'lighter' : 'source-over'
    if (m !== this.mode) {
      this.mode = m
      this.ctx.globalCompositeOperation = m
    }
  }

  /**
   * One frame of a clip, `size` px wide, centred on its anchor at (x, y), turned by `rot` radians. `flip` squashes it along its own y
   * (used to lay a mark on the ground). Returns false when there is neither art nor a fallback.
   */
  sprite(id: string, frame: number, x: number, y: number, size: number, rot: number, alpha: number, tint: string | null, additive: boolean, squash = 1): boolean {
    if (size < 0.5 || alpha <= 0.004) return true
    const art = lookup(id)
    const ctx = this.ctx
    let src: CanvasImageSource | null
    let sx = 0
    let sy = 0
    let sw = 64
    let sh = 64
    let ax = 0.5
    let ay = 0.5
    if (art) {
      const clip = art.clip
      const r = frameRect(clip, frame, art.image.width, art.image.height)
      sx = r.sx
      sy = r.sy
      sw = r.sw
      sh = r.sh
      ax = clip.anchor[0]
      ay = clip.anchor[1]
      src = tint && clip.tintable ? tinted(clip.file, tint, art.image) : (art.image as unknown as CanvasImageSource)
      if (!src) src = art.image as unknown as CanvasImageSource
    } else {
      src = fallbackFor(id, tint ?? '#ffb347')
      if (!src) return false
    }
    this.setAlpha(alpha)
    this.setMode(additive)
    const d = this.dpr
    if (rot !== 0 || squash !== 1) {
      const c = Math.cos(rot)
      const s = Math.sin(rot)
      ctx.setTransform(d * c, d * s, -d * s * squash, d * c * squash, d * x, d * y)
      ctx.drawImage(src, sx, sy, sw, sh, -size * ax, -size * ay, size, size)
      ctx.setTransform(d, 0, 0, d, 0, 0)
    } else ctx.drawImage(src, sx, sy, sw, sh, x - size * ax, y - size * ay, size, size)
    this.blits++
    return true
  }

  /**
   * A strip of a trail texture laid along a line from (x0, y0) to (x1, y1), `thick` px wide. The strip tiles along its length and can
   * scroll, so dashes and braids move.
   */
  strip(id: string, x0: number, y0: number, x1: number, y1: number, thick: number, alpha: number, scroll: number, tint: string | null, additive: boolean): boolean {
    const art = lookup(id)
    if (!art) return false
    const len = Math.hypot(x1 - x0, y1 - y0)
    if (len < 3 || alpha <= 0.004) return true
    const clip = art.clip
    const r = frameRect(clip, 0, art.image.width, art.image.height)
    const src = tint && clip.tintable ? (tinted(clip.file, tint, art.image) ?? (art.image as unknown as CanvasImageSource)) : (art.image as unknown as CanvasImageSource)
    // Show as much of the strip as fits the length at its natural aspect, wrapping with the scroll.
    const natural = (r.sw / r.sh) * thick
    const cover = Math.min(r.sw, (len / natural) * r.sw)
    const off = (((scroll % 1) + 1) % 1) * Math.max(0, r.sw - cover)
    this.setAlpha(alpha)
    this.setMode(additive)
    const d = this.dpr
    const ang = Math.atan2(y1 - y0, x1 - x0)
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    this.ctx.setTransform(d * c, d * s, -d * s, d * c, d * x0, d * y0)
    this.ctx.drawImage(src, r.sx + off, r.sy, cover, r.sh, 0, -thick / 2, len, thick)
    this.ctx.setTransform(d, 0, 0, d, 0, 0)
    this.blits++
    return true
  }

  /** A soft round glow of any colour: the atlas glow where loaded, a radial gradient otherwise. */
  glow(x: number, y: number, size: number, alpha: number, color: string, additive = true) {
    this.sprite('glow.fire', 0, x, y, size, 0, alpha, color, additive)
  }
}
