import { useEffect, useRef } from 'react'
import type { UnitCounts } from '../engine/types'
import { SQUAD_ICON, formationOf, totalOf, type Squad } from './formation'
import { Painter } from './sprites'
import { EASE, clamp01 } from './timing'

/**
 * A small marching formation for the War Room: it grows and shrinks, squad by squad, as the steppers change what is sent. Squads pop in
 * with a little overshoot and shrink away when taken out. With reduced motion it is one still frame per change. One small canvas, and it
 * only runs while the tab is visible.
 */
interface Shown {
  key: string
  squad: Squad
  /** 0 to 1 and the target it eases toward. */
  scale: number
  target: number
  born: number
}

export function FormationPreview({ units, color, reduced, label }: { units: Partial<UnitCounts>; color: string; reduced: boolean; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<{ shown: Shown[]; units: Partial<UnitCounts>; wake: () => void }>({ shown: [], units, wake: () => {} })
  state.current.units = units
  const total = totalOf(units)

  // A change of force: squads that appear start small, squads that go shrink toward nothing.
  useEffect(() => {
    const st = state.current
    const want = formationOf(units, 9)
    const keys = new Map<string, Squad>()
    const count: Record<string, number> = {}
    for (const q of want) {
      const n = (count[q.kind] = (count[q.kind] ?? 0) + 1)
      keys.set(`${q.kind}${n}`, q)
    }
    const now = performance.now()
    for (const s of st.shown) {
      const q = keys.get(s.key)
      if (q) {
        s.squad = q
        s.target = 1
        keys.delete(s.key)
      } else s.target = 0
    }
    for (const [key, squad] of keys) st.shown.push({ key, squad, scale: reduced ? 1 : 0, target: 1, born: now })
    if (reduced) for (const s of st.shown) s.scale = s.target
    st.shown = st.shown.filter((s) => s.target > 0 || s.scale > 0.01)
    st.wake()
  }, [units, reduced])

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const painter = new Painter(ctx)
    let raf = 0
    let last = 0
    let t = 0
    const draw = (now: number) => {
      raf = 0
      if (document.hidden) return
      const dt = last ? Math.min(60, now - last) : 16
      last = now
      t += dt
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const w = el.clientWidth || 300
      const h = 84
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
      }
      painter.begin(dpr)
      ctx.clearRect(0, 0, w, h)
      const sq = 24
      const cx = w / 2
      const cy = h / 2 + 2
      let settled = true
      const shown = state.current.shown
      for (let i = 0; i < shown.length; i++) {
        const s = shown[i]
        const diff = s.target - s.scale
        if (Math.abs(diff) > 0.004) {
          s.scale += diff * Math.min(1, dt / 120)
          settled = false
        } else s.scale = s.target
        const sc = s.target === 1 ? EASE.outBack(clamp01(s.scale)) : s.scale
        if (sc <= 0.02) continue
        const q = s.squad
        const bob = reduced ? 0 : Math.sin(t / 170 + i * 1.3)
        const x = cx + -q.y * sq * 1.05 + (reduced ? 0 : Math.sin(bob) * 0.8)
        const y = cy + q.x * sq * 0.95 - Math.abs(bob) * 1.2
        p(painter, 'glow.fire', x, y, sq * 1.5 * sc, 0.7, '#0a0c12', false)
        p(painter, 'glow.fire', x, y, sq * 1.05 * sc, 0.8, color, false)
        if (q.kind === 'infantry' || q.kind === 'drone') painter.sprite('army.march', reduced ? 0 : Math.floor(t / 125 + i * 3), x, y, sq * 1.05 * sc, Math.PI / 2, 1, null, false)
        else painter.sprite(SQUAD_ICON[q.kind], 0, x, y, sq * sc, 0, 1, '#ffffff', false)
      }
      if (!reduced && shown.length) {
        // Dust behind the column.
        for (let k = 0; k < 3; k++) {
          const ph = (t / 800 + k / 3) % 1
          painter.sprite('army.dust', Math.min(7, Math.floor(ph * 8)), cx - 38 - ph * 26, cy + (k - 1) * 12, sq * (1 + ph), 0, (1 - ph) * 0.6, '#c8b896', false)
        }
      }
      if (shown.length === 0) drawEmpty(ctx, w, h)
      state.current.shown = shown.filter((s) => s.target > 0 || s.scale > 0.01)
      // Idle forms of the march keep going; with reduced motion a settled frame is left alone.
      if (!reduced || !settled) raf = requestAnimationFrame(draw)
    }
    const wake = () => {
      if (!raf) {
        last = 0
        raf = requestAnimationFrame(draw)
      }
    }
    state.current.wake = wake
    const onVis = () => !document.hidden && wake()
    document.addEventListener('visibilitychange', onVis)
    wake()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      if (raf) cancelAnimationFrame(raf)
      state.current.wake = () => {}
    }
  }, [color, reduced])

  return <canvas ref={canvas} className="formation-preview" style={{ height: 84 }} role="img" aria-label={`${label}: ${total < 0.05 ? 'nothing sent' : `${Math.max(1, Math.round(total * 10) / 10)} divisions`}`} data-formation-preview />
}

function p(painter: Painter, id: string, x: number, y: number, size: number, alpha: number, tint: string, additive: boolean) {
  painter.sprite(id, 0, x, y, size, 0, alpha, tint, additive)
}

function drawEmpty(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.globalAlpha = 0.5
  ctx.fillStyle = '#ffffff'
  ctx.font = '12px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('No force chosen yet', w / 2, h / 2 + 4)
  ctx.globalAlpha = 1
}
