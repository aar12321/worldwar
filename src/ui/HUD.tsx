import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { turnDate } from '../engine/helpers'
import { populationShare } from '../engine/victory'
import { useGame } from '../store'
import { Guide } from './Guide'
import { fmt, signed, usePlayerView } from './hooks'

/** Eases a displayed number toward `value` instead of snapping. */
function useTweenedNumber(value: number, ms = 520): number {
  const reduced = useGame((s) => s.settings.reducedMotion)
  const [shown, setShown] = useState(value)
  const shownRef = useRef(value)
  useEffect(() => {
    if (reduced) {
      shownRef.current = value
      return
    }
    const from = shownRef.current
    if (from === value) return
    const start = performance.now()
    let raf = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / ms)
      const v = from + (value - from) * (1 - (1 - t) ** 3)
      shownRef.current = v
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(raf)
  }, [value, ms, reduced])
  return reduced ? value : shown
}

function Tweened({ value, format }: { value: number; format: (v: number) => string }) {
  return <>{format(useTweenedNumber(value))}</>
}

/** A short-lived "+12" that floats off a number whenever it changes. */
function DeltaFlash({ value, format }: { value: number; format: (v: number) => string }) {
  const [prev, setPrev] = useState(value)
  const [flash, setFlash] = useState<{ id: number; d: number } | null>(null)
  if (value !== prev) {
    setPrev(value)
    if (Math.abs(value - prev) >= 0.5) setFlash({ id: (flash?.id ?? 0) + 1, d: value - prev })
  }
  return (
    <AnimatePresence>
      {flash && (
        <motion.span
          key={flash.id}
          initial={{ opacity: 1, y: 0 }}
          animate={{ opacity: 0, y: -16 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          onAnimationComplete={() => setFlash((f) => (f?.id === flash.id ? null : f))}
          className={`absolute left-3 -top-1 text-[11px] font-semibold pointer-events-none ${flash.d > 0 ? 'text-[#30d158]' : 'text-[#ff6961]'}`}
        >
          {flash.d > 0 ? '+' : '-'}
          {format(Math.abs(flash.d))}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

const whole = (v: number) => fmt(v)

function Resource({
  label,
  value,
  amount,
  format = whole,
  suffix,
  delta,
  warn = false,
  children,
}: {
  label: string
  value?: string
  amount?: number
  format?: (v: number) => string
  suffix?: string
  delta?: string
  warn?: boolean
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const deltaNeg = delta?.startsWith('-')
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="relative flex flex-col items-start px-3 py-1.5 rounded-xl hover:bg-white/8 cursor-default min-w-[76px]">
        <span className="label">{label}</span>
        <span className={`text-[15px] font-semibold tabular-nums tracking-tight ${warn ? 'text-[#ff6961]' : 'text-white'}`}>
          {value}
          {amount !== undefined && <Tweened value={amount} format={format} />}
          {suffix}
        </span>
        {delta && <span className={`text-[11px] font-semibold tabular-nums ${deltaNeg || warn ? 'text-[#ff6961]' : 'text-[#30d158]'}`}>{delta}</span>}
        {amount !== undefined && <DeltaFlash value={amount} format={format} />}
      </div>
      {open && children && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="glass absolute top-full left-0 mt-2 w-64 rounded-2xl p-3 text-[13px] z-50 space-y-1">
          {children}
        </motion.div>
      )}
    </div>
  )
}

const Row = ({ k, v, warn }: { k: string; v: string; warn?: boolean }) => (
  <div className="flex justify-between gap-4">
    <span className="text-white/50">{k}</span>
    <span className={warn ? 'text-[#ff6961]' : 'text-white'}>{v}</span>
  </div>
)

function attention(view: NonNullable<ReturnType<typeof usePlayerView>>): string | null {
  const { player, econ } = view
  if (player.foodShortage) return 'Food shortage. Armies fight weaker until you grow or buy more food.'
  if (player.inDebt) return 'Out of money. The country grows less stable until income covers spending.'
  if (player.stability < 35) return 'Stability is low. Rebels can rise. Lower taxes, or crack down in a troubled country.'
  if (econ.netFood < 0) return 'You are eating more food than you grow. Build farms before stocks run out.'
  return null
}

export function HUD() {
  const view = usePlayerView()
  const endTurn = useGame((s) => s.endTurn)
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const timer = useGame((s) => s.settings.turnTimer)
  const reduced = useGame((s) => s.settings.reducedMotion)
  const [remaining, setRemaining] = useState(timer)
  const turn = view?.game.turn
  const blocked = !view || !!view.game.pendingEvent || fxBusy || view.game.outcome !== 'playing'
  useEffect(() => setRemaining(timer), [turn, timer])
  useEffect(() => {
    if (!timer || blocked) return
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => clearInterval(id)
  }, [timer, blocked, turn])
  useEffect(() => {
    if (timer && !blocked && remaining === 0) endTurn()
  }, [remaining, timer, blocked, endTurn])

  if (!view) return null
  const { game, player, econ, committed } = view
  const share = populationShare(game, player.id)
  const goal = game.settings.victoryShare
  const note = attention(view)
  const endLabel = game.pendingEvent ? 'Decide first' : fxBusy ? 'Battle playing' : 'End month'

  return (
    <div className="absolute top-0 inset-x-0 z-30 flex flex-col gap-2 p-3 pointer-events-none">
      <div className="flex items-start justify-between gap-3">
        <div className="glass rounded-2xl px-4 py-2.5 pointer-events-auto flex items-center gap-3 min-w-56">
          <div className="w-1.5 self-stretch rounded-full" style={{ background: player.color }} />
          <div>
            <div className="text-[15px] font-semibold tracking-tight">{player.name}</div>
            <div className="text-[12px] text-white/55 h-4 overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={game.turn}
                  initial={reduced ? false : { y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { y: -8, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                >
                  {turnDate(game.turn)}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="mt-1.5 flex items-center gap-2" title="Share of the world's people you control. Fill the bar to win.">
              <div className="h-1 w-24 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-[#0a84ff] transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, (share / goal) * 100)}%` }} />
              </div>
              <span className="text-[11px] text-white/50 tabular-nums">
                {(share * 100).toFixed(1)}% of {(goal * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl px-1.5 py-1 pointer-events-auto flex flex-wrap items-stretch">
          <Resource label="Soldiers" amount={player.militaryPool - committed.manpower} suffix="k" delta={`${signed(econ.militaryRegen, 0)}k`}>
            <Row k="Civilians" v={`${fmt(econ.civilianManpower, 1)} million`} />
            <Row k="Soldiers ready" v={`${fmt(player.militaryPool - committed.manpower)}k`} />
            <Row k="New soldiers / limit" v={`${fmt(econ.militaryRegen)}k / ${fmt(econ.militaryCap)}k`} />
            <Row k="Draft" v={`${Math.round(view.pendingPolicy.draftRate * 100)}%`} />
            <Row k="People at work" v={`${Math.round(econ.laborRatio * 100)}%`} warn={econ.laborRatio < 0.95} />
            <p className="text-[12px] text-white/45 pt-1">The draft turns civilians into soldiers. Fewer workers means less money, food, and factory output.</p>
          </Resource>
          <Resource label="Money" amount={player.resources.capital - committed.capital} delta={signed(econ.netCapital)} warn={player.inDebt}>
            <Row k="Taxes" v={signed(econ.taxIncome)} />
            <Row k="Factories" v={signed(econ.factoryIncome)} />
            <Row k="Trade" v={signed(econ.tradeIncome)} />
            <Row k="Upkeep" v={signed(-econ.upkeep)} warn />
            <Row k="Spent this month" v={fmt(-committed.capital)} />
            {player.inDebt && <p className="text-[12px] text-[#ff6961]">In debt. Stability is falling.</p>}
          </Resource>
          <Resource label="Food" amount={player.resources.food} delta={signed(econ.netFood)} warn={player.foodShortage || econ.netFood < 0}>
            <Row k="Grown" v={signed(econ.foodProduction)} />
            <Row k="Eaten" v={signed(-econ.foodConsumption)} warn />
            <Row k="Farms" v={`${econ.buildings.farm}`} />
            {player.foodShortage && <p className="text-[12px] text-[#ff6961]">Shortage: armies fight at reduced strength and slowly starve.</p>}
          </Resource>
          <Resource label="Influence" amount={player.resources.pp - committed.pp} delta={signed(econ.ppGain)}>
            <p className="text-[12px] text-white/55">Spend influence to declare war, pass laws, stop rebels, and sign treaties.</p>
          </Resource>
          <Resource label="Research" amount={player.resources.tp - committed.tp} delta={signed(econ.tpGain)}>
            <Row k="Universities" v={`${econ.buildings.university}`} />
            <p className="text-[12px] text-white/55">Open Research to buy technologies. They finish when the month ends.</p>
          </Resource>
          <Resource label="Stability" amount={player.stability} format={(v) => Math.round(v).toString()} suffix="%" warn={player.stability < 35}>
            <Row k="Heading toward" v={`${Math.round(econ.stabilityTarget)}%`} />
            <Row k="Tax rate" v={`${Math.round(view.pendingPolicy.taxRate * 100)}%`} warn={view.pendingPolicy.taxRate > 0.2} />
            <Row k="War weariness" v={player.warWeariness.toFixed(0)} warn={player.warWeariness > 15} />
            <p className="text-[12px] text-white/45 pt-1">Below 30%, rebels may rise. Low stability reduces everything you produce.</p>
          </Resource>
        </div>

        <div className="glass rounded-2xl p-2 pointer-events-auto flex items-center gap-3">
          {timer > 0 && (
            <div className="text-center px-1">
              <div className="label">Time left</div>
              <div className={`text-lg font-semibold tabular-nums ${remaining <= 10 ? 'text-[#ff6961]' : 'text-white'}`}>{blocked ? '—' : `${remaining}s`}</div>
            </div>
          )}
          <button className={`btn btn-primary px-5 py-3 text-[14px] ${blocked ? '' : 'pulse-cta'}`} disabled={blocked} onClick={endTurn} title="End the month (Enter)">
            {endLabel}
          </button>
        </div>
      </div>
      {note && <div className="self-center max-w-xl rounded-full bg-black/55 border border-white/10 px-4 py-1.5 text-[13px] text-[#ffd60a]">{note}</div>}
      <Guide />
    </div>
  )
}
