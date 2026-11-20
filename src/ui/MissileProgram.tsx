import { useState } from 'react'
import { MISSILES, MISSILE_PROGRAM } from '../data/missiles'
import { buildRoomFor, missileStock, programLevel, reachKm, buildMissilesCost } from '../engine/missiles'
import type { MissileType } from '../engine/types'
import { usePlayerView } from './hooks'
import { CountPicker } from './MissileSection'
import { MISSILE_SWATCH, PROGRAM_KINDS, buildCostText, clampCount, effectText } from './missileText'
import { OrderButton } from './panel'
import { openProgram } from './programSection'

/** One kind the program builds: what is in store, what one costs, and buttons to build one or a chosen number. */
export function BuildRow({ kind }: { kind: Exclude<MissileType, 'hypersonic'> }) {
  const view = usePlayerView()!
  const { game, player } = view
  const [count, setCount] = useState(3)
  const spec = MISSILES[kind]
  const level = programLevel(player)
  const open = level >= spec.level
  const room = buildRoomFor(player, game.turn, kind)
  const n = clampCount(count, room)
  const build = (c: number) => ({ type: 'buildMissiles' as const, nationId: player.id, kind, count: c })
  // The program's cheaper lines take a share off the money (buildMissilesCost), so the button says what is really charged.
  const total = (c: number) => `${buildMissilesCost(build(c), player).capital} money${spec.steel > 0 ? `, ${spec.steel * c} steel` : ''}${spec.oil > 0 ? `, ${spec.oil * c} oil` : ''}`
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
            Each costs {buildCostText(kind)} · reaches {reachKm(player, kind)} km · {spec.days === 1 ? 'a day' : `${spec.days} days`} in the air (live game)
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
 * The missile program, as a summary for the Systems tab. The program itself (charter, facilities, talent, development, tests, and
 * building missiles) lives in one place: the Missile Program tab. This card says where it stands and opens it.
 */
export function MissileProgramCard() {
  const view = usePlayerView()
  if (!view) return null
  const { player } = view
  const level = programLevel(player)
  const max = MISSILE_PROGRAM.maxLevel
  const stock = PROGRAM_KINDS.reduce((sum, k) => sum + missileStock(player, k), 0)
  return (
    <section className="inset-card p-3.5 flex flex-wrap items-center justify-between gap-3" aria-label="Missile program" data-program-level={level}>
      <div className="min-w-0">
        <div className="text-[16px] font-semibold tracking-tight">Missile program</div>
        <p className="text-[13px] text-white/70">
          Charter level {level} of {max} · {stock} missile{stock === 1 ? '' : 's'} in store. The charter, facilities, talent, development, test launches and building missiles are all in the Missile Program tab.
        </p>
      </div>
      <button className="btn btn-primary px-3 py-1.5 text-[13px] shrink-0" onClick={() => openProgram('arsenal')}>
        Open the Missile Program
      </button>
    </section>
  )
}
