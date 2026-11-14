import * as THREE from 'three'
import type { Army } from '../../engine/types'
import { dominantUnit } from '../../engine/armies'

/** What the picture on an army's badge shows. */
export type Glyph = 'infantry' | 'armor' | 'ship' | 'plane' | 'drone'

/** Whose army it is, to the player: theirs, one marching on them, or someone else's. */
export type Variant = 'mine' | 'threat' | 'other'

/** The picture for an army: a plane for an air attack, a ship for one that crosses water, otherwise by the main kind of unit. */
export function glyphOf(a: Pick<Army, 'via' | 'units'>): Glyph {
  if (a.via === 'air') return 'plane'
  if (a.via === 'fleet' || a.via === 'lane') return 'ship'
  const main = dominantUnit(a.units)
  if (main === 'armor' || main === 'artillery') return 'armor'
  if (main === 'drone' || main === 'robot') return 'drone'
  if (main === 'air' || main === 'fighter') return 'plane'
  if (main === 'naval') return 'ship'
  return 'infantry'
}

const OUTLINE: Record<Variant, { color: string; width: number }> = {
  mine: { color: '#ffffff', width: 7 },
  threat: { color: '#ff453a', width: 8 },
  other: { color: 'rgba(12,14,18,0.9)', width: 4 },
}

const SIZE = 128
const cache = new Map<string, THREE.CanvasTexture>()

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** The mark inside the badge, drawn in white. These are the usual map symbols for each kind of force. */
function drawGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph) {
  ctx.save()
  ctx.translate(SIZE / 2, SIZE / 2)
  ctx.strokeStyle = '#fff'
  ctx.fillStyle = '#fff'
  ctx.lineWidth = 7
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  switch (glyph) {
    case 'infantry':
      // Crossed lines, the symbol for infantry.
      ctx.beginPath()
      ctx.moveTo(-24, -16)
      ctx.lineTo(24, 16)
      ctx.moveTo(24, -16)
      ctx.lineTo(-24, 16)
      ctx.stroke()
      break
    case 'armor':
      // A track, the symbol for armor.
      ctx.beginPath()
      ctx.ellipse(0, 0, 25, 13, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    case 'ship':
      ctx.beginPath()
      ctx.moveTo(-26, 4)
      ctx.lineTo(26, 4)
      ctx.lineTo(16, 18)
      ctx.lineTo(-16, 18)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, -20)
      ctx.lineTo(14, 0)
      ctx.closePath()
      ctx.fill()
      break
    case 'plane':
      ctx.beginPath()
      ctx.moveTo(0, -22)
      ctx.lineTo(5, -6)
      ctx.lineTo(28, 6)
      ctx.lineTo(28, 12)
      ctx.lineTo(5, 7)
      ctx.lineTo(3, 18)
      ctx.lineTo(11, 23)
      ctx.lineTo(11, 27)
      ctx.lineTo(0, 24)
      ctx.lineTo(-11, 27)
      ctx.lineTo(-11, 23)
      ctx.lineTo(-3, 18)
      ctx.lineTo(-5, 7)
      ctx.lineTo(-28, 12)
      ctx.lineTo(-28, 6)
      ctx.lineTo(-5, -6)
      ctx.closePath()
      ctx.fill()
      break
    case 'drone':
      ctx.beginPath()
      for (const [x, y] of [[-18, -12], [18, -12], [-18, 12], [18, 12]] as const) {
        ctx.moveTo(x + 7, y)
        ctx.arc(x, y, 7, 0, Math.PI * 2)
      }
      ctx.moveTo(-18, -12)
      ctx.lineTo(18, 12)
      ctx.moveTo(18, -12)
      ctx.lineTo(-18, 12)
      ctx.stroke()
      break
  }
  ctx.restore()
}

/** The texture for an army's badge: a frame in the nation's color with its symbol, outlined by whose it is. Made once for each look. */
export function badge(color: string, glyph: Glyph, variant: Variant): THREE.CanvasTexture {
  const key = `${color}|${glyph}|${variant}`
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const o = OUTLINE[variant]
  const pad = 10
  const h = 84
  const y = (SIZE - h) / 2
  roundRect(ctx, pad, y, SIZE - pad * 2, h, 14)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = o.width
  ctx.strokeStyle = o.color
  ctx.stroke()
  drawGlyph(ctx, glyph)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cache.set(key, tex)
  return tex
}
