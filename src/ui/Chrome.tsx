import { dayDate, isLive } from '../engine/calendar'
import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { turnDate } from '../engine/helpers'
import { describeOrder } from '../engine/resolveTurn'
import { controlled, countriesTaken, populationShare } from '../engine/victory'
import { getWorld } from '../map/world'
import { useGame, type Panel, type ReportDelta } from '../store'
import { AdviceList } from './Briefing'
import { fmt, signed, useAdvice, usePlayerView } from './hooks'
import { BriefingIcon, DiplomacyIcon, EconomyIcon, MilitaryIcon, ResearchIcon } from './icons'
import { Modal } from './Modal'

const NAV: { panel: Panel; label: string; key: string; icon: ReactNode }[] = [
  { panel: 'briefing', label: 'Briefing', key: 'B', icon: <BriefingIcon /> },
  { panel: 'economy', label: 'Economy', key: 'E', icon: <EconomyIcon /> },
  { panel: 'military', label: 'Military', key: 'M', icon: <MilitaryIcon /> },
  { panel: 'diplomacy', label: 'Diplomacy', key: 'D', icon: <DiplomacyIcon /> },
  { panel: 'tech', label: 'Research', key: 'R', icon: <ResearchIcon /> },
]

export function NavRail() {
  const panel = useGame((s) => s.panel)
  const setPanel = useGame((s) => s.setPanel)
  const offers = useGame((s) => {
    if (!s.game) return 0
    const unanswered = s.game.proposals.filter((p) => p.to === s.game!.playerId && !s.orders.some((o) => o.type === 'respond' && o.proposalId === p.id))
    return unanswered.length
  })
  const urgent = useAdvice().filter((a) => a.urgency === 'now').length
  const badge = (p: Panel) => (p === 'diplomacy' ? offers : p === 'briefing' ? urgent : 0)
  return (
    <nav className="nav-dock" aria-label="Desks">
      <div className="surface max-h-full overflow-y-auto scroll-thin rounded-[22px] p-1.5 flex flex-col gap-0.5">
        {NAV.map((n) => (
          <button
            key={n.panel}
            onClick={() => setPanel(n.panel)}
            aria-pressed={panel === n.panel}
            className={`nav-btn relative w-[72px] h-[56px] rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-colors ${panel === n.panel ? 'bg-white/16 text-white' : 'text-white/75 hover:text-white hover:bg-white/8'}`}
            title={n.key ? `${n.label} (${n.key})` : n.label}
          >
            {n.icon}
            <span className="text-[12px] font-medium tracking-tight">{n.label}</span>
            {badge(n.panel) > 0 && (
              <span className="absolute top-1 right-2 min-w-4 h-4 px-1 rounded-full bg-[#ff453a] text-[11px] font-semibold text-white flex items-center justify-center" aria-label={`${badge(n.panel)} need you`}>
                {badge(n.panel)}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  )
}

export function OrdersTray() {
  const view = usePlayerView()
  const removeOrder = useGame((s) => s.removeOrder)
  if (!view || view.orders.length === 0) return null
  const { game, orders } = view
  const { map } = getWorld()
  return (
    <div className="orders-tray absolute bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[min(70vw,820px)]">
      <div className="surface rounded-full px-3 py-1.5 flex items-center gap-2 overflow-x-auto scroll-thin">
        <span className="label whitespace-nowrap px-1">{isLive(game) ? `On ${dayDate(game.turn + 1, 0)}` : 'Next turn'}</span>
        <AnimatePresence initial={false}>
          {orders.map((o, i) => (
            <motion.button
              key={`${i}-${describeOrder(game, map, o)}`}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => removeOrder(i)}
              className="whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium hover:line-through bg-white/10 text-white/90"
              title="Click to cancel"
            >
              {describeOrder(game, map, o)}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const dismiss = useGame((s) => s.dismissToast)
  return (
    <div className="toast-region" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            onClick={() => dismiss(t.id)}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto surface rounded-2xl px-4 py-3 text-[14px] cursor-pointer max-w-sm ${t.tone === 'error' ? 'text-[#ff8a84]' : t.tone === 'success' ? 'text-[#6eeb8a]' : ''}`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function DeltaCell({ d }: { d: ReportDelta }) {
  const digits = d.digits ?? 0
  const change = d.after - d.before
  const flat = Math.abs(change) < (digits ? 0.05 : 0.5)
  return (
    <div className="inset-card py-2 px-2 text-center">
      <div className="label">{d.label}</div>
      <div className="text-[17px] font-semibold tabular-nums">
        {fmt(d.after, digits)}
        {d.suffix}
      </div>
      <div className={`text-[12px] font-semibold tabular-nums ${flat ? 'text-white/60' : change > 0 ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}`}>{flat ? 'no change' : `${signed(change, digits)}${d.suffix ?? ''}`}</div>
    </div>
  )
}

/** The monthly report: what the month did to you, and what the advisor would do next. */
export function TurnSummary() {
  const summary = useGame((s) => s.summary)
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const eventPending = useGame((s) => !!s.game?.pendingEvent)
  const outcome = useGame((s) => s.game?.outcome)
  const dismiss = useGame((s) => s.dismissSummary)
  const advice = useAdvice(3)
  if (!summary || fxBusy || outcome !== 'playing') return null
  return (
    <Modal
      title={`${turnDate(summary.turn)} is over`}
      kicker="Monthly report"
      onClose={dismiss}
      wide
      footer={
        <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={dismiss}>
          {eventPending ? 'Continue' : `Start ${turnDate(summary.turn + 1)}`}
        </button>
      }
    >
      <div className="report-grid">
        <div className="space-y-5">
          <section>
            <h3 className="text-[15px] font-semibold mb-2">Your country</h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {summary.deltas.map((d) => (
                <DeltaCell key={d.label} d={d} />
              ))}
            </div>
          </section>
          {summary.battles.length > 0 && (
            <section>
              <h3 className="text-[15px] font-semibold mb-2">Battles</h3>
              <ul className="space-y-1.5">
                {summary.battles.map((b, i) => (
                  <li key={i} className={`text-[15px] border-l-2 pl-3 ${b.good ? 'border-[#30d158] text-white/90' : 'border-[#ff453a] text-white/90'}`}>
                    {b.text}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {summary.lines.length > 0 && (
            <section>
              <h3 className="text-[15px] font-semibold mb-2">News at home</h3>
              <ul className="space-y-1.5">
                {summary.lines.map((line, i) => (
                  <li key={i} className="text-[15px] text-white/85 border-l-2 border-white/20 pl-3">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {summary.world.length > 0 && (
            <section>
              <h3 className="text-[15px] font-semibold mb-2">The world</h3>
              <ul className="space-y-1.5">
                {summary.world.map((line, i) => (
                  <li key={i} className="text-[14px] text-white/75 border-l-2 border-white/15 pl-3">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {!eventPending && (
          <section>
            <h3 className="text-[15px] font-semibold mb-2">This month</h3>
            <AdviceList items={advice} compact />
          </section>
        )}
      </div>
    </Modal>
  )
}

export function GameOver() {
  const game = useGame((s) => s.game)
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const quit = useGame((s) => s.quitToMenu)
  const abandon = useGame((s) => s.abandonGame)
  const online = useGame((s) => !!s.online)
  if (!game || game.outcome === 'playing' || fxBusy) return null
  const win = game.outcome === 'victory'
  // Who won. Single-player saves from before this was recorded have no winner, so the player is it.
  const champion = game.nations[game.winner ?? game.playerId]
  const youWon = win && champion.id === game.playerId
  const p = youWon || !win ? game.nations[game.playerId] : champion
  const taken = countriesTaken(game, p.id)
  const reason = win
    ? `${p.name} holds the whole world: ${controlled(game, p.id)} countries, as of ${turnDate(game.turn)}.`
    : game.humans.length > 1 || online
      ? `Every player's nation has fallen, as of ${turnDate(game.turn)}.`
      : `${p.name} fell in ${turnDate(game.turn)}. The nation is gone, so the game is lost.`
  return (
    <Modal
      title={youWon ? 'You won' : win ? `${champion.name} won` : game.humans.length > 1 || online ? 'Every nation has fallen' : 'Your nation has fallen'}
      kicker={youWon ? 'Victory' : win ? 'Game over' : 'Defeat'}
      tone={youWon ? '#30d158' : '#ff453a'}
      footer={
        <>
          <button className="btn px-5 py-2.5 text-[15px]" onClick={quit}>
            {online ? 'Leave the room' : 'Back to the menu'}
          </button>
          {!online && (
            <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={abandon}>
              New game
            </button>
          )}
        </>
      }
    >
      <p className="text-[16px] text-white/85">{reason}</p>
      <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
        <div className="inset-card py-3">
          <dt className="label">Countries taken</dt>
          <dd className="text-[26px] font-semibold">{taken}</dd>
        </div>
        <div className="inset-card py-3">
          <dt className="label">World population</dt>
          <dd className="text-[26px] font-semibold">{(populationShare(game, p.id) * 100).toFixed(1)}%</dd>
        </div>
        <div className="inset-card py-3">
          <dt className="label">Nations left</dt>
          <dd className="text-[26px] font-semibold">{Object.values(game.nations).filter((n) => n.alive).length}</dd>
        </div>
      </dl>
    </Modal>
  )
}
