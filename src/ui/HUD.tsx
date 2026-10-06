import { motion } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'
import { turnDate } from '../engine/helpers'
import { populationShare } from '../engine/victory'
import { useGame } from '../store'
import { fmt, signed, usePlayerView } from './hooks'

function Resource({ label, value, delta, tone = 'cyan', children }: { label: string; value: string; delta?: string; tone?: 'cyan' | 'red' | 'amber' | 'magenta' | 'green'; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const toneClass = { cyan: 'text-cyan-200', red: 'text-rose-300', amber: 'text-amber-200', magenta: 'text-fuchsia-200', green: 'text-emerald-200' }[tone]
  const deltaNeg = delta?.startsWith('-')
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="flex flex-col items-start px-3 py-1 rounded-md hover:bg-white/5 cursor-default">
        <span className="label">{label}</span>
        <span className={`font-display text-sm font-bold ${toneClass}`}>
          {value}
          {delta && <span className={`ml-1.5 text-[10px] font-semibold ${deltaNeg ? 'text-rose-400' : 'text-emerald-400'}`}>{delta}</span>}
        </span>
      </div>
      {open && children && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="glass absolute top-full left-0 mt-2 w-64 rounded-lg p-3 text-sm z-50 space-y-1">
          {children}
        </motion.div>
      )}
    </div>
  )
}

const Row = ({ k, v, warn }: { k: string; v: string; warn?: boolean }) => (
  <div className="flex justify-between">
    <span className="text-slate-400">{k}</span>
    <span className={warn ? 'text-rose-300' : 'text-slate-100'}>{v}</span>
  </div>
)

export function HUD() {
  const view = usePlayerView()
  const endTurn = useGame((s) => s.endTurn)
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const timer = useGame((s) => s.settings.turnTimer)
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

  return (
    <div className="absolute top-0 inset-x-0 z-30 flex items-start justify-between gap-3 p-3 pointer-events-none">
      <div className="glass rounded-xl px-4 py-2 pointer-events-auto flex items-center gap-3 min-w-56">
        <div className="w-3 h-10 rounded-sm" style={{ background: player.color, boxShadow: `0 0 14px ${player.color}` }} />
        <div>
          <div className="font-display text-sm font-bold tracking-widest neon-text">{player.name.toUpperCase()}</div>
          <div className="text-xs text-slate-400">
            {turnDate(game.turn)} · Turn {game.turn}
          </div>
          <div className="mt-1 flex items-center gap-2" title="Share of world population you control">
            <div className="h-1.5 w-28 rounded-full bg-slate-800 overflow-hidden relative">
              <div className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-400" style={{ width: `${Math.min(100, (share / goal) * 100)}%` }} />
            </div>
            <span className="text-[10px] text-slate-400">
              {(share * 100).toFixed(1)}% / {(goal * 100).toFixed(0)}% world
            </span>
          </div>
        </div>
      </div>

      <div className="glass rounded-xl px-2 py-1 pointer-events-auto flex flex-wrap items-center">
        <Resource label="Manpower" value={`${fmt(econ.civilianManpower, 1)}M / ${fmt(player.militaryPool - committed.manpower)}k`} delta={signed(econ.militaryRegen, 0) + 'k'}>
          <Row k="Civilian population" v={`${fmt(econ.civilianManpower, 1)}M`} />
          <Row k="Military pool (available)" v={`${fmt(player.militaryPool - committed.manpower)}k`} />
          <Row k="Pool regen / cap" v={`${fmt(econ.militaryRegen)}k / ${fmt(econ.militaryCap)}k`} />
          <Row k="Draft rate" v={`${Math.round(view.pendingPolicy.draftRate * 100)}%`} />
          <Row k="Labor efficiency" v={`${Math.round(econ.laborRatio * 100)}%`} warn={econ.laborRatio < 0.95} />
          <p className="text-xs text-slate-500 pt-1">Drafting more civilians grows your army pool but shrinks taxes, food, and factory labor.</p>
        </Resource>
        <Resource label="Capital" value={fmt(player.resources.capital - committed.capital)} delta={signed(econ.netCapital)} tone={player.inDebt ? 'red' : 'amber'}>
          <Row k="Taxes" v={signed(econ.taxIncome)} />
          <Row k="Factories" v={signed(econ.factoryIncome)} />
          <Row k="Trade (ports)" v={signed(econ.tradeIncome)} />
          <Row k="Upkeep (armies, buildings)" v={signed(-econ.upkeep)} warn />
          <Row k="Committed this turn" v={fmt(-committed.capital)} />
          {player.inDebt && <p className="text-xs text-rose-300">In debt: stability is falling.</p>}
        </Resource>
        <Resource label="Food" value={fmt(player.resources.food)} delta={signed(econ.netFood)} tone={player.foodShortage || econ.netFood < 0 ? 'red' : 'green'}>
          <Row k="Production" v={signed(econ.foodProduction)} />
          <Row k="Consumption" v={signed(-econ.foodConsumption)} warn />
          <Row k="Farms" v={`${econ.buildings.farm}`} />
          {player.foodShortage && <p className="text-xs text-rose-300">Shortage: armies fight at -30% and slowly starve; riots loom.</p>}
        </Resource>
        <Resource label="Political" value={fmt(player.resources.pp - committed.pp)} delta={signed(econ.ppGain)} tone="magenta">
          <p className="text-xs text-slate-400">Spend Political Points to declare war, pass laws, suppress rebels, and sign treaties.</p>
        </Resource>
        <Resource label="Tech" value={fmt(player.resources.tp - committed.tp)} delta={signed(econ.tpGain)}>
          <Row k="Universities" v={`${econ.buildings.university}`} />
          <p className="text-xs text-slate-400">Open the Tech Tree to unlock new technologies.</p>
        </Resource>
        <Resource label="Stability" value={`${Math.round(player.stability)}%`} delta={`${econ.stabilityTarget >= player.stability ? '+' : ''}${(econ.stabilityTarget - player.stability).toFixed(0)}`} tone={player.stability < 35 ? 'red' : 'cyan'}>
          <Row k="Trending toward" v={`${Math.round(econ.stabilityTarget)}%`} />
          <Row k="Tax rate" v={`${Math.round(view.pendingPolicy.taxRate * 100)}%`} warn={view.pendingPolicy.taxRate > 0.2} />
          <Row k="War weariness" v={player.warWeariness.toFixed(0)} warn={player.warWeariness > 15} />
          <p className="text-xs text-slate-500 pt-1">Below 30% rebels may rise. Low stability reduces all output.</p>
        </Resource>
      </div>

      <div className="glass rounded-xl p-2 pointer-events-auto flex items-center gap-3">
        {timer > 0 && (
          <div className="text-center px-1">
            <div className="label">Clock</div>
            <div className={`font-display text-lg font-bold ${remaining <= 10 ? 'text-rose-300' : 'text-cyan-200'}`}>{blocked ? '--' : `${remaining}s`}</div>
          </div>
        )}
        <button className={`btn btn-primary px-5 py-3 text-xs ${blocked ? '' : 'pulse-cta'}`} disabled={blocked} onClick={endTurn} title="End turn (Enter)">
          {game.pendingEvent ? 'Decision Pending' : fxBusy ? 'Battle Report' : 'Next Turn'}
        </button>
      </div>
    </div>
  )
}
