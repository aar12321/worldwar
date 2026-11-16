import { useState } from 'react'
import { MISSILES, MISSILE_PROGRAM } from '../data/missiles'
import { buildRoom, buildRoomFor, fundMissilesCost, missileStock, programLevel } from '../engine/missiles'
import type { MissileType } from '../engine/types'
import { Pips } from './bits'
import { usePlayerView } from './hooks'
import { CountPicker } from './MissileSection'
import { MISSILE_SWATCH, PROGRAM_KINDS, buildCostText, clampCount, effectText } from './missileText'
import { NextSteps } from './MissileWar'
import { OrderButton } from './panel'

/** One kind the program builds: what is in store, what one costs, and buttons to build one or a chosen number. */
function BuildRow({ kind }: { kind: Exclude<MissileType, 'hypersonic'> }) {
  const view = usePlayerView()!
  const { game, player } = view
  const [count, setCount] = useState(3)
  const spec = MISSILES[kind]
  const level = programLevel(player)
  const open = level >= spec.level
  const room = buildRoomFor(player, game.turn, kind)
  const n = clampCount(count, room)
  const build = (c: number) => ({ type: 'buildMissiles' as const, nationId: player.id, kind, count: c })
  const total = (c: number) => `${Math.ceil(spec.money * c)} money${spec.steel > 0 ? `, ${spec.steel * c} steel` : ''}${spec.oil > 0 ? `, ${spec.oil * c} oil` : ''}`
  return (
    <div className={`rounded-xl border border-white/10 bg-white/5 p-3 space-y-2 ${open ? '' : 'opacity-70'}`} data-build={kind}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="h-3 w-3 rounded-full shrink-0" style={{ background: MISSILE_SWATCH[kind] }} aria-hidden />
            <span className="text-[15px] font-semibold">{spec.name}</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">{spec.role}</span>
          </div>
          <p className="mt-1 text-[13px] text-white/75">{effectText(kind)}</p>
          <p className="mt-0.5 text-[12px] text-white/65">
            Each costs {buildCostText(kind)} · reaches {spec.km} km · {spec.days === 1 ? 'a day' : `${spec.days} days`} in the air (live game)
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[22px] font-semibold tabular-nums leading-none">{missileStock(player, kind)}</div>
          <div className="label">in stock</div>
        </div>
      </div>
      {open ? (
        <div className="grid gap-2 sm:grid-cols-2 items-start">
          <OrderButton order={build(1)} label="Build 1" cost={total(1)} effect="Joins your stock at once." tone="btn-primary" />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-white/75">Custom</span>
              <CountPicker value={n} max={room} onChange={setCount} label={`How many ${spec.name.toLowerCase()}s to build`} />
              <span className="text-[12px] text-white/60 tabular-nums">of {room} left</span>
            </div>
            <OrderButton order={build(n)} label={`Build ${n}`} cost={total(n)} effect="Joins your stock at once." tone="btn-primary" className="w-full" />
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-[#ffd60a]">Needs the program at level {spec.level}.</p>
      )}
    </div>
  )
}

/**
 * The missile program, in the Military desk. A level is a team of engineers and test ranges, so raising it costs money and
 * research, opens the next kind of missile and widens how many the program can turn out in a month.
 */
export function MissileProgramCard() {
  const view = usePlayerView()
  if (!view) return null
  const { game, player } = view
  const level = programLevel(player)
  const max = MISSILE_PROGRAM.maxLevel
  const room = buildRoom(player, game.turn)
  const capacity = MISSILE_PROGRAM.capacity[level]
  const cost = fundMissilesCost(player)
  const nextKind = level < max ? PROGRAM_KINDS.find((k) => MISSILES[k].level === level + 1) : undefined
  return (
    <section className="inset-card p-3.5 space-y-3" aria-label="Missile program" data-program-level={level}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold tracking-tight">Missile program</div>
          <p className="text-[13px] text-white/70">{MISSILE_PROGRAM.names[level]}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="label">Level</div>
          <div className="text-[22px] font-semibold tabular-nums">
            {level}
            <span className="text-white/50 text-[14px]"> / {max}</span>
          </div>
        </div>
      </div>
      <Pips value={level} max={max} />
      <NextSteps limit={4} />
      <p className="text-[13px] text-white/80">
        A level is a team of engineers and test ranges, and the talent for them is the expensive part. Raising the program costs money and research once. It opens the next kind of missile and lets the factories turn out more of them each month. Then every missile costs money and steel (a ballistic one also burns oil), paid when you build it. Hypersonic missiles are different: they come from technology and the training queue, not from here.
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        {MISSILE_PROGRAM.capacity.slice(1).map((c, i) => (
          <div key={i} className={`rounded-xl py-2 ${level === i + 1 ? 'bg-[#0a84ff]/25 border border-[#0a84ff]' : 'bg-white/6 border border-transparent'}`}>
            <div className="label">Level {i + 1}</div>
            <div className="text-[13px] font-semibold">{MISSILES[PROGRAM_KINDS[i]].name.replace(' missile', '')}</div>
            <div className="text-[12px] text-white/65 tabular-nums">{c} a month</div>
          </div>
        ))}
      </div>
      {level < max ? (
        <OrderButton
          order={{ type: 'fundMissiles', nationId: player.id }}
          label={`Raise to level ${level + 1}`}
          cost={`${cost.capital} money · ${cost.tp} research`}
          effect={nextKind ? `Unlocks ${MISSILES[nextKind].name.toLowerCase()}s and builds up to ${MISSILE_PROGRAM.capacity[level + 1]} a month.` : undefined}
          tone="btn-primary"
          className="w-full"
        />
      ) : (
        <p className="text-[13px] text-[#6eeb8a]">The program is at its best.</p>
      )}
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="text-white/75">Room to build this month</span>
        <span className="tabular-nums font-semibold" data-room={room}>
          {room} of {capacity}
        </span>
      </div>
      {level === 0 && <p className="text-[13px] text-[#ffd60a]">No program yet. Raise it to level 1 to build cruise missiles.</p>}
      <div className="space-y-2">
        {PROGRAM_KINDS.map((k) => (
          <BuildRow key={k} kind={k as Exclude<MissileType, 'hypersonic'>} />
        ))}
      </div>
      <p className="text-[12px] text-white/60">Missiles are fired from the War Room, at a country you are at war with. Strong shields stop a share of them, so the cheap ones are best used in numbers.</p>
    </section>
  )
}
