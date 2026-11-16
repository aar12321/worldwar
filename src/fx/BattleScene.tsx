import { useEffect, useMemo, useRef } from 'react'
import { totalUnits } from '../engine/helpers'
import type { BattleReport } from '../engine/types'
import { BattleStage } from './battleStage'
import { Painter } from './sprites'

/**
 * The battle scene canvas for the battle window. Sixty frames a second on one small canvas, only while the window is open and the tab
 * visible. `shown` is how many rounds have started (rounds + 1 is the verdict); `speed` is the battle speed setting. With reduced
 * motion nothing is drawn: the window's round cards and verdict are the static outcome.
 */
export function BattleScene({ battle, attColor, defColor, attName, defName, shown, speed, reduced }: { battle: BattleReport; attColor: string; defColor: string; attName: string; defName: string; shown: number; speed: number; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useMemo(
    () =>
      new BattleStage({
        att: { units: battle.attacker.units, color: attColor, name: attName },
        def: { units: battle.defender.units, color: defColor, name: defName },
        rounds: battle.rounds.map((r) => ({ attDamage: r.attackerDamage, defDamage: r.defenderDamage, attLoss: totalUnits(r.attackerLosses), defLoss: totalUnits(r.defenderLosses) })),
        attackerWon: battle.winner === 'attacker',
        captured: battle.captured,
      }),
    // A battle is one scene; its colours do not change while it plays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [battle.id],
  )
  useEffect(() => {
    stage.speed = speed
  }, [stage, speed])
  useEffect(() => {
    stage.setVisible(shown)
  }, [stage, shown])
  useEffect(() => {
    const el = canvas.current
    if (!el || reduced) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const painter = new Painter(ctx)
    let raf = 0
    let last = 0
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const w = el.clientWidth || 600
      const h = Math.round(Math.min(230, Math.max(170, w * 0.34)))
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
        el.style.height = `${h}px`
        stage.layout(w, h)
      }
      return dpr
    }
    const frame = (now: number) => {
      raf = 0
      if (document.hidden) return
      const dpr = fit()
      const dt = last ? now - last : 16
      last = now
      stage.update(dt)
      painter.begin(dpr)
      stage.draw(painter)
      raf = requestAnimationFrame(frame)
    }
    const onVis = () => {
      if (!document.hidden && !raf) {
        last = 0
        raf = requestAnimationFrame(frame)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(frame)
    if (typeof window !== 'undefined' && import.meta.env.DEV) (window as unknown as { __battleStage: BattleStage }).__battleStage = stage
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [stage, reduced])
  if (reduced) return null
  return <canvas ref={canvas} className="battle-scene" role="img" aria-label={`${attName} against ${defName}`} data-battle-scene />
}
