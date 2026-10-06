import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { UNIT_SPECS } from '../data/unitTypes'
import { totalUnits } from '../engine/helpers'
import type { BattleReport, GameState, NationId } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { NEON } from './colors'
import { globeBridge, useFx } from './globeBridge'

type Effect =
  | { id: number; kind: 'slash'; x: number; y: number; angle: number; color: string; delay: number; length: number }
  | { id: number; kind: 'burst'; x: number; y: number; size: number; color: string; delay: number }
  | { id: number; kind: 'pop'; x: number; y: number; text: string; color: string; delay: number }
  | { id: number; kind: 'flash'; color: string }

let effectId = 1
const ROUND_MS = 1080
const INTRO_MS = 720
const RESULT_MS = 1500
const EASE = [0.22, 1, 0.36, 1] as const

function sideInfo(game: GameState, id: NationId) {
  if (id === 'rebels') return { name: 'Rebels', color: NEON.red }
  const n = game.nations[id]
  return { name: n?.name ?? id, color: n?.color ?? '#94a3b8' }
}

function resultBanner(b: BattleReport, playerId: NationId): { text: string; good: boolean } {
  const playerAttacking = b.attacker.nationId === playerId
  const attackerWon = b.winner === 'attacker'
  if (playerAttacking) {
    if (b.defender.nationId === 'rebels') return attackerWon ? { text: 'REBELLION CRUSHED', good: true } : { text: 'REBELS HOLD OUT', good: false }
    return attackerWon && b.captured ? { text: 'TERRITORY CAPTURED', good: true } : { text: 'ASSAULT REPULSED', good: false }
  }
  if (attackerWon && b.captured) return { text: b.attacker.nationId === 'rebels' ? 'REGION SECEDES' : 'TERRITORY LOST', good: false }
  return { text: 'THE LINE HOLDS', good: true }
}

export function BattleFX() {
  const battle = useGame((s) => s.fxQueue[0])
  const remaining = useGame((s) => s.fxQueue.length)
  const game = useGame((s) => s.game)
  const settings = useGame((s) => s.settings)
  const updateSettings = useGame((s) => s.updateSettings)
  const shiftFx = useGame((s) => s.shiftFx)
  const clearFx = useGame((s) => s.clearFx)
  const [stage, setStage] = useState<'intro' | 'round' | 'result'>('intro')
  const [roundIdx, setRoundIdx] = useState(-1)
  const [effects, setEffects] = useState<Effect[]>([])
  const { map } = getWorld()
  const speed = settings.fxSpeed
  const reduced = settings.reducedMotion

  useEffect(() => {
    if (!battle || !game) return
    const t = (ms: number) => ms / speed
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, t(ms)))
    const region = map.regions[battle.regionId]
    const att = sideInfo(game, battle.attacker.nationId)
    const def = sideInfo(game, battle.defender.nationId)
    globeBridge.api?.pointOfView({ lat: region.lat - 6, lng: region.lng, altitude: 0.78 }, reduced ? 0 : t(640))
    setStage('intro')
    setRoundIdx(-1)
    setEffects([])

    const spawnRound = (i: number) => {
      const r = battle.rounds[i]
      setStage('round')
      setRoundIdx(i)
      const p = globeBridge.api?.getScreenCoords(region.lat, region.lng, 0.02) ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      const total = r.attackerDamage + r.defenderDamage
      useFx.getState().addRing({ lat: region.lat, lng: region.lng, color: i === 2 ? NEON.magenta : NEON.amber, maxRadius: 2.5 + Math.min(5, total) }, t(1200))
      const list: Effect[] = []
      list.push({ id: effectId++, kind: 'pop', x: p.x - 110, y: p.y - 24, text: `-${r.defenderDamage.toFixed(1)}`, color: att.color, delay: 160 })
      list.push({ id: effectId++, kind: 'pop', x: p.x + 110, y: p.y - 24, text: `-${r.attackerDamage.toFixed(1)}`, color: def.color, delay: 230 })
      if (!reduced) {
        const slashes = Math.min(4, 2 + Math.round(total / 2))
        for (let k = 0; k < slashes; k++) {
          list.push({ id: effectId++, kind: 'slash', x: p.x + (Math.random() - 0.5) * 90, y: p.y + (Math.random() - 0.5) * 56, angle: -28 + Math.random() * 56 + (k % 2 ? 180 : 0), color: k % 2 ? def.color : k === 0 ? '#ffffff' : att.color, delay: k * 55, length: 0.28 + Math.random() * 0.16 })
        }
        const bursts = Math.min(4, 2 + Math.round(total / 2))
        for (let k = 0; k < bursts; k++) {
          list.push({ id: effectId++, kind: 'burst', x: p.x + (Math.random() - 0.5) * 110, y: p.y + (Math.random() - 0.5) * 70, size: 70 + Math.random() * 70, color: k % 2 === 0 ? '#fff7ed' : '#fb923c', delay: 40 + k * 70 })
        }
        list.push({ id: effectId++, kind: 'flash', color: i === 2 ? 'rgba(232,121,249,0.28)' : 'rgba(255,244,230,0.32)' })
        useFx.getState().shake(Math.min(1, 0.35 + total * 0.1))
      }
      setEffects(list)
    }

    let cursor = INTRO_MS
    battle.rounds.forEach((_, i) => {
      at(cursor, () => spawnRound(i))
      cursor += ROUND_MS
    })
    at(cursor, () => {
      setStage('result')
      setEffects([])
      useFx.getState().reveal(battle.id)
    })
    cursor += RESULT_MS
    at(cursor, () => shiftFx())
    return () => timers.forEach(clearTimeout)
  }, [battle?.id, speed])

  const bars = useMemo(() => {
    if (!battle) return null
    const attStart = totalUnits(battle.attacker.units)
    const defStart = totalUnits(battle.defender.units)
    let attLoss = 0
    let defLoss = 0
    const upto = stage === 'result' ? battle.rounds.length - 1 : roundIdx
    for (let i = 0; i <= upto; i++) {
      attLoss += battle.rounds[i]?.defenderDamage ?? 0
      defLoss += battle.rounds[i]?.attackerDamage ?? 0
    }
    if (stage === 'result') {
      attLoss = totalUnits(battle.attacker.losses)
      defLoss = totalUnits(battle.defender.losses)
    }
    return {
      att: attStart > 0 ? Math.max(0, 1 - Math.min(attLoss, attStart) / attStart) : 0,
      def: defStart > 0 ? Math.max(0, 1 - Math.min(defLoss, defStart) / defStart) : 0,
      attStart,
      defStart,
    }
  }, [battle, roundIdx, stage])

  if (!battle || !game || !bars) return null
  const region = map.regions[battle.regionId]
  const att = sideInfo(game, battle.attacker.nationId)
  const def = sideInfo(game, battle.defender.nationId)
  const banner = resultBanner(battle, game.playerId)
  const round = roundIdx >= 0 ? battle.rounds[roundIdx] : null

  return (
    <div className="absolute inset-0 z-[45] pointer-events-none overflow-hidden">
      <motion.div className="absolute top-0 inset-x-0 h-[8vh] origin-top bg-black" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.28 / speed, ease: EASE }} />
      <motion.div className="absolute bottom-0 inset-x-0 h-[8vh] origin-bottom bg-black" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.28 / speed, ease: EASE }} />

      <div className="absolute top-[9vh] inset-x-0 flex flex-col items-center">
        <motion.div key={battle.id} initial={{ opacity: 0, scaleX: 0.7 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ duration: 0.28 / speed, ease: EASE }} className="bg-gradient-to-r from-rose-600/0 via-rose-600/80 to-rose-600/0 px-16 py-1">
          <span className="font-display text-sm tracking-[0.5em] text-white">ENGAGEMENT</span>
        </motion.div>
        <motion.h2 key={`${battle.id}-t`} initial={{ opacity: 0, y: 10, scale: 1.04 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.32 / speed, ease: EASE }} className="font-display text-4xl font-black mt-2 text-white tracking-[0.18em]" style={{ textShadow: '0 0 20px rgba(244,63,94,0.8)' }}>
          BATTLE OF {region.name.toUpperCase()}
        </motion.h2>
        <AnimatePresence mode="wait">
          {round && stage === 'round' && (
            <motion.div key={roundIdx} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.18 / speed, ease: EASE }} className="mt-2 font-display text-sm tracking-[0.35em] text-amber-200">
              ROUND {roundIdx + 1} · {round.name.toUpperCase()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {effects.map((e) => {
        if (e.kind === 'flash') return <div key={e.id} className="screen-flash" style={{ background: e.color }} />
        if (e.kind === 'slash')
          return (
            <div key={e.id} className="absolute" style={{ left: e.x, top: e.y, transform: `translate(-50%, -50%) rotate(${e.angle}deg)`, width: `${e.length * 100}vw` }}>
              <div className="slash-streak w-full" style={{ color: e.color, background: `linear-gradient(90deg, transparent, ${e.color} 42%, #fff 50%, ${e.color} 58%, transparent)`, animationDelay: `${e.delay / speed}ms`, ['--dur' as string]: `${260 / speed}ms`, opacity: 0 }} />
            </div>
          )
        if (e.kind === 'burst')
          return <div key={e.id} className="burst" style={{ left: e.x, top: e.y, width: e.size, height: e.size, background: `radial-gradient(circle, #fff 0%, ${e.color} 42%, transparent 72%)`, animationDelay: `${e.delay / speed}ms`, ['--dur' as string]: `${460 / speed}ms`, opacity: 0 }} />
        return (
          <div key={e.id} className="damage-pop text-3xl" style={{ left: e.x, top: e.y, color: e.color, textShadow: `0 0 12px ${e.color}, 0 2px 0 #000`, animationDelay: `${e.delay / speed}ms`, opacity: 0 }}>
            {e.text}
          </div>
        )
      })}

      <div className="absolute bottom-[9vh] inset-x-0 flex justify-center">
        <motion.div initial={{ y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.28 / speed, ease: EASE }} className="glass rounded-xl px-6 py-4 w-[720px] max-w-[92vw]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
            {[
              { side: battle.attacker, info: att, frac: bars.att, start: bars.attStart, label: 'ATTACKER' },
              null,
              { side: battle.defender, info: def, frac: bars.def, start: bars.defStart, label: 'DEFENDER' },
            ].map((x, i) =>
              x === null ? (
                <div key="vs" className="font-display text-3xl font-black italic text-white/80" style={{ textShadow: '0 0 18px rgba(232,121,249,0.7)' }}>
                  VS
                </div>
              ) : (
                <div key={i} className={i === 2 ? 'text-right' : ''}>
                  <div className="label">{x.label}</div>
                  <div className="font-display text-lg font-bold" style={{ color: x.info.color, textShadow: `0 0 12px ${x.info.color}` }}>
                    {x.info.name}
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
                    <motion.div className={`h-full w-full rounded-full ${i === 2 ? 'origin-right' : 'origin-left'}`} style={{ background: x.info.color, boxShadow: `0 0 10px ${x.info.color}` }} initial={false} animate={{ scaleX: Math.max(0.001, x.frac) }} transition={{ duration: 0.4 / speed, ease: EASE }} />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {(x.start * x.frac).toFixed(1)} / {x.start.toFixed(1)} divisions
                  </div>
                  <div className={`text-[11px] text-slate-500 mt-0.5 flex gap-2 ${i === 2 ? 'justify-end' : ''}`}>
                    {UNIT_TYPES.filter((k) => x.side.units[k] >= 0.05).map((k) => {
                      const left = stage === 'result' ? Math.max(0, x.side.units[k] - x.side.losses[k]) : x.side.units[k] * x.frac
                      return (
                        <span key={k}>
                          {UNIT_SPECS[k].name} {left.toFixed(1)}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ),
            )}
          </div>
          {stage === 'result' && battle.modifiers.length > 0 && <div className="mt-3 text-[11px] text-slate-400 text-center">{battle.modifiers.join(' · ')}</div>}
        </motion.div>
      </div>

      <AnimatePresence>
        {stage === 'result' && (
          <motion.div initial={{ scale: 1.35, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 / speed, ease: EASE }} className="absolute inset-0 flex items-center justify-center">
            <div className={`font-display text-5xl font-black tracking-[0.14em] -skew-x-6 px-8 py-3 max-w-[92vw] text-center leading-none ${banner.good ? 'text-cyan-100' : 'text-rose-100'}`} style={{ textShadow: banner.good ? '0 0 24px #22d3ee' : '0 0 24px #f43f5e', background: banner.good ? 'linear-gradient(90deg, transparent, rgba(34,211,238,0.25), transparent)' : 'linear-gradient(90deg, transparent, rgba(244,63,94,0.25), transparent)' }}>
              {banner.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute right-4 bottom-[10vh] flex gap-2 pointer-events-auto">
        <span className="glass rounded-md px-3 py-2 text-xs text-slate-300">{remaining} battle{remaining === 1 ? '' : 's'} in report</span>
        <button className={`btn ${speed === 2 ? 'bg-cyan-400/25' : ''}`} onClick={() => updateSettings({ fxSpeed: speed === 2 ? 1 : 2 })}>
          2x
        </button>
        <button className="btn" onClick={shiftFx}>
          Skip
        </button>
        <button className="btn btn-red" onClick={clearFx}>
          Skip All
        </button>
      </div>
    </div>
  )
}
