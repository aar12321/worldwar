import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { UNIT_SPECS } from '../data/unitTypes'
import { COMMITS, STANCES } from '../data/war'
import { formatDivisions, totalUnits } from '../engine/helpers'
import type { BattleReport, GameState, NationId, UnitCounts } from '../engine/types'
import { UNIT_TYPES } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { NEON } from './colors'
import { globeBridge, useFx } from './globeBridge'
import { Modal } from './Modal'
import { LineBar } from './WarRoom'

const INTRO_MS = 700
const ROUND_MS = 1400

function sideInfo(game: GameState, id: NationId) {
  if (id === 'rebels') return { name: 'Rebels', color: NEON.red }
  const n = game.nations[id]
  return { name: n?.name ?? id, color: n?.color ?? '#94a3b8' }
}

function verdict(b: BattleReport, playerId: NationId, place: string): { title: string; text: string; good: boolean } {
  const playerAttacking = b.attacker.nationId === playerId
  const attackerWon = b.winner === 'attacker'
  if (playerAttacking) {
    if (b.defender.nationId === 'rebels') return attackerWon ? { title: 'Rebellion crushed', text: 'The rebels are beaten.', good: true } : { title: 'Rebels hold out', text: 'They are still fighting.', good: false }
    if (attackerWon && b.captured) return { title: `${place} captured`, text: 'The Defense Line broke. The whole country is now yours, though it will take months to settle.', good: true }
    if (attackerWon) return { title: 'The line gives way', text: `${place}'s Defense Line is down to ${(b.lineAfter ?? 0).toFixed(1)}. Press on next turn before it heals.`, good: true }
    return { title: 'Attack repulsed', text: `${place} held. Your losses were heavy. Try a different stance, or send more.`, good: false }
  }
  if (attackerWon && b.captured) return { title: b.attacker.nationId === 'rebels' ? `${place} breaks away` : `${place} lost`, text: 'The country has fallen.', good: false }
  if (attackerWon) return { title: 'The line is pushed back', text: `${place} is losing ground. Rebuild your military and hold on.`, good: false }
  return { title: 'The line holds', text: `${place} was not taken.`, good: true }
}

function LossChips({ losses }: { losses: UnitCounts }) {
  const hit = UNIT_TYPES.filter((k) => losses[k] >= 0.05)
  if (!hit.length) return <span className="text-[13px] text-white/55">no losses</span>
  return (
    <span className="flex flex-wrap gap-1">
      {hit.map((k) => (
        <motion.span key={k} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="chip chip-red">
          −{formatDivisions(losses[k])} {UNIT_SPECS[k].name}
        </motion.span>
      ))}
    </span>
  )
}

function Bar({ left, start, color }: { left: number; start: number; color: string }) {
  const frac = start > 0 ? Math.max(0, Math.min(1, left / start)) : 0
  return (
    <div className="h-3 rounded-full bg-white/12 overflow-hidden" role="img" aria-label={`${formatDivisions(left)} of ${formatDivisions(start)} divisions left`}>
      <motion.div className="h-full" style={{ background: color }} initial={false} animate={{ width: `${frac * 100}%` }} transition={{ duration: 0.5 }} />
    </div>
  )
}

/** One battle, round by round: who dealt what, what was lost, and how it ended. */
export function BattleFX() {
  const battle = useGame((s) => s.fxQueue[0])
  const total = useGame((s) => s.fxTotal)
  const left = useGame((s) => s.fxQueue.length)
  const game = useGame((s) => s.game)
  const settings = useGame((s) => s.settings)
  const updateSettings = useGame((s) => s.updateSettings)
  const shiftFx = useGame((s) => s.shiftFx)
  const clearFx = useGame((s) => s.clearFx)
  const [shown, setShown] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: reducedMotionRef.current ? 'auto' : 'smooth' })
  }, [shown])
  const speedRef = useRef(settings.fxSpeed)
  useEffect(() => {
    speedRef.current = settings.fxSpeed
  }, [settings.fxSpeed])
  const reduced = settings.reducedMotion
  const reducedMotionRef = useRef(reduced)
  useEffect(() => {
    reducedMotionRef.current = reduced
  }, [reduced])
  const savedView = useRef<{ lat: number; lng: number; altitude: number } | null>(null)
  const { map } = getWorld()
  const active = !!battle

  // Fly to the battle, then back when the last one is closed.
  useEffect(() => {
    const api = globeBridge.api
    if (!api) return
    if (active) {
      savedView.current ??= api.pointOfView()
      return
    }
    if (savedView.current) {
      api.pointOfView(savedView.current, reduced ? 0 : 900)
      savedView.current = null
    }
  }, [active, reduced])

  const battleId = battle?.id
  const rounds = battle?.rounds.length ?? 0
  useEffect(() => {
    if (!battleId || !battle) return
    setShown(0)
    const region = map.regions[battle.regionId]
    if (region) globeBridge.api?.pointOfView({ lat: region.lat - 6, lng: region.lng, altitude: 0.9 }, reduced ? 0 : 600)
    const timers: number[] = []
    const step = (i: number) => {
      if (i > rounds) return
      timers.push(
        window.setTimeout(
          () => {
            setShown(i + 1)
            if (i < rounds && region) {
              const r = battle.rounds[i]
              useFx.getState().addRing({ lat: region.lat, lng: region.lng, color: i === 2 ? NEON.magenta : NEON.amber, maxRadius: 2.5 + Math.min(5, r.attackerDamage + r.defenderDamage) }, 1100)
              if (!reduced) useFx.getState().shake(Math.min(0.8, 0.25 + (r.attackerDamage + r.defenderDamage) * 0.08))
            }
            if (i === rounds - 1) useFx.getState().reveal(battle.id)
            step(i + 1)
          },
          (i === 0 ? INTRO_MS : ROUND_MS) / speedRef.current,
        ),
      )
    }
    step(0)
    return () => timers.forEach(clearTimeout)
    // The battle id is the only thing that restarts the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId])

  if (!battle || !game) return null
  const region = map.regions[battle.regionId]
  const player = game.playerId
  const att = sideInfo(game, battle.attacker.nationId)
  const def = sideInfo(game, battle.defender.nationId)
  const playerAttacking = battle.attacker.nationId === player
  const done = shown > rounds
  const visibleRounds = Math.min(shown, rounds)
  let attLost = 0
  let defLost = 0
  for (let i = 0; i < visibleRounds; i++) {
    attLost += totalUnits(battle.rounds[i].attackerLosses)
    defLost += totalUnits(battle.rounds[i].defenderLosses)
  }
  const attStart = totalUnits(battle.attacker.units)
  const defStart = totalUnits(battle.defender.units)
  const result = verdict(battle, player, region?.name ?? 'the country')
  const finish = () => {
    useFx.getState().reveal(battle.id)
    shiftFx()
  }

  return (
    <Modal
      title={`${att.name} attacks ${def.name}`}
      kicker={total > 1 ? `Battle ${total - left + 1} of ${total} · ${region?.name}` : `Battle · ${region?.name}`}
      tone={playerAttacking ? '#ff9f0a' : '#ff453a'}
      wide
      footer={
        <>
          {left > 1 && (
            <button className="btn btn-quiet mr-auto" onClick={clearFx}>
              Skip all
            </button>
          )}
          <button className={`btn ${settings.fxSpeed === 2 ? 'bg-white/25' : ''}`} onClick={() => updateSettings({ fxSpeed: settings.fxSpeed === 2 ? 1 : 2 })}>
            2× speed
          </button>
          {!done && (
            <button className="btn" onClick={() => setShown(rounds + 1)}>
              Skip to result
            </button>
          )}
          <button className="btn btn-primary px-5" data-autofocus disabled={!done} onClick={finish}>
            Continue
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-6">
        {[
          { side: att, units: battle.attacker.units, lost: attLost, start: attStart, label: 'Attacker' },
          { side: def, units: battle.defender.units, lost: defLost, start: defStart, label: 'Defender' },
        ].map((col) => (
          <div key={col.label} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: col.side.color }} />
              <span className="text-[17px] font-semibold">{col.side.name}</span>
              <span className="label">{col.label}</span>
            </div>
            <Bar left={col.start - col.lost} start={col.start} color={col.side.color} />
            <div className="text-[14px] tabular-nums text-white/80">
              {formatDivisions(Math.max(0, col.start - col.lost))} of {formatDivisions(col.start)} divisions
            </div>
            <div className="flex flex-wrap gap-1.5 text-[13px] text-white/75">
              {UNIT_TYPES.filter((k) => col.units[k] >= 0.05).map((k) => (
                <span key={k} className="chip">
                  {UNIT_SPECS[k].name} {formatDivisions(col.units[k])}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {battle.lineMax !== undefined && battle.lineBefore !== undefined && (
        <div className="mt-5 space-y-1.5">
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="font-semibold">Defense Line · {region?.name}</span>
            <span className="tabular-nums text-white/80">
              {done ? `${battle.lineBefore.toFixed(1)} → ${(battle.lineAfter ?? battle.lineBefore).toFixed(1)}` : battle.lineBefore.toFixed(1)} of {battle.lineMax.toFixed(1)}
            </span>
          </div>
          <LineBar now={done ? (battle.lineAfter ?? battle.lineBefore) : battle.lineBefore} max={battle.lineMax} />
          {battle.stance && battle.commit && (
            <p className="text-[13px] text-white/70">
              {STANCES[battle.stance].name} · {COMMITS[battle.commit].name.toLowerCase()}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {battle.rounds.slice(0, visibleRounds).map((r, i) => {
          const dealt = playerAttacking ? r.attackerDamage : r.defenderDamage
          const took = playerAttacking ? r.defenderDamage : r.attackerDamage
          return (
            <motion.div key={i} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="inset-card p-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-semibold">
                  Round {i + 1} · {r.name}
                </span>
                <span className="text-[15px] tabular-nums">
                  <span className="text-[#6eeb8a]">You dealt {dealt.toFixed(1)}</span>
                  <span className="text-white/50"> · </span>
                  <span className="text-[#ff8a84]">took {took.toFixed(1)}</span>
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-4 text-[13px]">
                <div>
                  <div className="label mb-1">{att.name} lost</div>
                  <LossChips losses={r.attackerLosses} />
                </div>
                <div>
                  <div className="label mb-1">{def.name} lost</div>
                  <LossChips losses={r.defenderLosses} />
                </div>
              </div>
            </motion.div>
          )
        })}
        {!done && <p className="text-[14px] text-white/65">{visibleRounds === 0 ? 'The armies close in…' : 'Fighting…'}</p>}
      </div>

      {done && (
        <motion.div initial={reduced ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={`mt-5 rounded-2xl p-4 ${result.good ? 'bg-[#30d158]/15' : 'bg-[#ff453a]/15'}`}>
          <div className={`text-[22px] font-semibold ${result.good ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}`}>{result.title}</div>
          <p className="text-[15px] text-white/85 mt-1">{result.text}</p>
          {battle.modifiers.length > 0 && (
            <ul className="mt-3 space-y-0.5 text-[13px] text-white/70">
              {battle.modifiers.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </motion.div>
      )}
      <div ref={endRef} />
    </Modal>
  )
}
