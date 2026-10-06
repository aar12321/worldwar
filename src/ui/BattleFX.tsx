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
const ROUND_MS = 1350
const INTRO_MS = 1000
const RESULT_MS = 1900

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
    globeBridge.api?.pointOfView({ lat: region.lat - 8, lng: region.lng, altitude: 1.05 }, t(850))
    setStage('intro')
    setRoundIdx(-1)
    setEffects([])

    const spawnRound = (i: number) => {
      const r = battle.rounds[i]
      setStage('round')
      setRoundIdx(i)
      const p = globeBridge.api?.getScreenCoords(region.lat, region.lng, 0.02) ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      const total = r.attackerDamage + r.defenderDamage
      useFx.getState().addRing({ lat: region.lat, lng: region.lng, color: i === 2 ? NEON.magenta : NEON.amber, maxRadius: 3 + Math.min(8, total * 1.5) }, t(1400))
      const list: Effect[] = []
      list.push({ id: effectId++, kind: 'pop', x: p.x - 90, y: p.y - 30, text: `-${r.defenderDamage.toFixed(1)}`, color: att.color, delay: 250 })
      list.push({ id: effectId++, kind: 'pop', x: p.x + 90, y: p.y - 30, text: `-${r.attackerDamage.toFixed(1)}`, color: def.color, delay: 380 })
      if (!reduced) {
        const slashes = 2 + Math.min(3, Math.round(total))
        for (let k = 0; k < slashes; k++) {
          list.push({ id: effectId++, kind: 'slash', x: p.x + (Math.random() - 0.5) * 120, y: p.y + (Math.random() - 0.5) * 80, angle: -35 + Math.random() * 70 + (k % 2 ? 180 : 0), color: k % 2 ? def.color : k === 0 ? '#ffffff' : att.color, delay: k * 70, length: 0.45 + Math.random() * 0.35 })
        }
        const bursts = 3 + Math.min(5, Math.round(total * 1.5))
        for (let k = 0; k < bursts; k++) {
          list.push({ id: effectId++, kind: 'burst', x: p.x + (Math.random() - 0.5) * 160, y: p.y + (Math.random() - 0.5) * 110, size: 50 + Math.random() * 120, color: k % 3 === 0 ? '#fff7ed' : k % 3 === 1 ? '#fb923c' : '#f43f5e', delay: 120 + k * 90 })
        }
        list.push({ id: effectId++, kind: 'flash', color: i === 2 ? 'rgba(232,121,249,0.35)' : 'rgba(255,240,220,0.4)' })
        useFx.getState().shake(Math.min(1.6, 0.5 + total * 0.25))
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
      <motion.div className="absolute top-0 inset-x-0 bg-black" initial={{ height: 0 }} animate={{ height: '9vh' }} transition={{ duration: 0.4 / speed }} />
      <motion.div className="absolute bottom-0 inset-x-0 bg-black" initial={{ height: 0 }} animate={{ height: '9vh' }} transition={{ duration: 0.4 / speed }} />

      <div className="absolute top-[11vh] inset-x-0 flex flex-col items-center">
        <motion.div key={battle.id} initial={{ x: -300, opacity: 0, skewX: -20 }} animate={{ x: 0, opacity: 1, skewX: -8 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }} className="bg-gradient-to-r from-rose-600/0 via-rose-600/80 to-rose-600/0 px-16 py-1">
          <span className="font-display text-sm tracking-[0.5em] text-white">ENGAGEMENT</span>
        </motion.div>
        <motion.h2 key={`${battle.id}-t`} initial={{ letterSpacing: '1em', opacity: 0 }} animate={{ letterSpacing: '0.18em', opacity: 1 }} transition={{ duration: 0.6 / speed }} className="font-display text-4xl font-black mt-2 text-white" style={{ textShadow: '0 0 20px rgba(244,63,94,0.8), 0 0 40px rgba(244,63,94,0.4)' }}>
          BATTLE OF {region.name.toUpperCase()}
        </motion.h2>
        <AnimatePresence mode="wait">
          {round && stage === 'round' && (
            <motion.div key={roundIdx} initial={{ y: 12, opacity: 0, scale: 1.3 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ duration: 0.25 / speed }} className="mt-2 font-display text-sm tracking-[0.35em] text-amber-200">
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
              <div className="slash-streak w-full" style={{ color: e.color, background: `linear-gradient(90deg, transparent, ${e.color} 40%, #fff 50%, ${e.color} 60%, transparent)`, animationDelay: `${e.delay / speed}ms`, ['--dur' as string]: `${420 / speed}ms`, opacity: 0 }} />
            </div>
          )
        if (e.kind === 'burst')
          return <div key={e.id} className="burst" style={{ left: e.x, top: e.y, width: e.size, height: e.size, background: `radial-gradient(circle, #fff 0%, ${e.color} 35%, transparent 70%)`, animationDelay: `${e.delay / speed}ms`, ['--dur' as string]: `${700 / speed}ms`, opacity: 0 }} />
        return (
          <div key={e.id} className="damage-pop text-3xl" style={{ left: e.x, top: e.y, color: e.color, textShadow: `0 0 12px ${e.color}, 0 2px 0 #000`, animationDelay: `${e.delay / speed}ms`, opacity: 0 }}>
            {e.text}
          </div>
        )
      })}

      <div className="absolute bottom-[11vh] inset-x-0 flex justify-center">
        <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 22 }} className="glass rounded-xl px-6 py-4 w-[720px] max-w-[92vw]">
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
                  <div className={`h-2.5 rounded-full bg-slate-800 mt-2 overflow-hidden flex ${i === 2 ? 'justify-end' : ''}`}>
                    <motion.div className="h-full rounded-full" style={{ background: x.info.color, boxShadow: `0 0 10px ${x.info.color}` }} animate={{ width: `${x.frac * 100}%` }} transition={{ duration: 0.5 / speed }} />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {(x.start * x.frac).toFixed(1)} / {x.start.toFixed(1)} divisions
                  </div>
                  <div className={`text-[11px] text-slate-500 mt-0.5 flex gap-2 ${i === 2 ? 'justify-end' : ''}`}>
                    {UNIT_TYPES.filter((k) => x.side.units[k] >= 0.05).map((k) => (
                      <span key={k}>
                        {UNIT_SPECS[k].name} {x.side.units[k].toFixed(1)}
                      </span>
                    ))}
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
          <motion.div initial={{ scale: 2.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }} className="absolute inset-0 flex items-center justify-center">
            <div className={`font-display text-6xl font-black tracking-[0.2em] -skew-x-6 px-10 py-3 ${banner.good ? 'text-cyan-100' : 'text-rose-100'}`} style={{ textShadow: banner.good ? '0 0 24px #22d3ee, 0 0 60px #22d3ee' : '0 0 24px #f43f5e, 0 0 60px #f43f5e', background: banner.good ? 'linear-gradient(90deg, transparent, rgba(34,211,238,0.25), transparent)' : 'linear-gradient(90deg, transparent, rgba(244,63,94,0.25), transparent)' }}>
              {banner.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute right-4 bottom-[11vh] translate-y-[-120%] flex gap-2 pointer-events-auto">
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
