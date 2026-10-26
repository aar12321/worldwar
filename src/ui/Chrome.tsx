import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { turnDate } from '../engine/helpers'
import { describeOrder } from '../engine/resolveTurn'
import { conquestGoal, countriesTaken, populationShare } from '../engine/victory'
import { getWorld } from '../map/world'
import { useGame, type Panel } from '../store'
import { usePlayerView } from './hooks'
import { Modal } from './Modal'

const NAV: { panel: Panel; label: string; key: string; icon: ReactNode }[] = [
  { panel: 'country', label: 'Country', key: 'C', icon: <NationIcon /> },
  { panel: 'military', label: 'Military', key: 'M', icon: <MilitaryIcon /> },
  { panel: 'tech', label: 'Research', key: 'T', icon: <ResearchIcon /> },
  { panel: 'diplomacy', label: 'Diplomacy', key: 'D', icon: <PeopleIcon /> },
  { panel: 'log', label: 'News', key: 'L', icon: <NewsIcon /> },
  { panel: 'settings', label: 'Settings', key: '', icon: <SettingsIcon /> },
]

export function NavRail() {
  const panel = useGame((s) => s.panel)
  const setPanel = useGame((s) => s.setPanel)
  const offers = useGame((s) => {
    if (!s.game) return 0
    const unanswered = s.game.proposals.filter((p) => p.to === s.game!.playerId && !s.orders.some((o) => o.type === 'respond' && o.proposalId === p.id))
    return unanswered.length
  })
  return (
    <nav className="nav-dock" aria-label="Game sections">
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
            {n.panel === 'diplomacy' && offers > 0 && (
              <span className="absolute top-1 right-2 min-w-4 h-4 px-1 rounded-full bg-[#ff453a] text-[11px] font-semibold text-white flex items-center justify-center">{offers}</span>
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
        <span className="label whitespace-nowrap px-1">Next turn</span>
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

/** What happened this turn, once the battles have played. */
export function TurnSummary() {
  const summary = useGame((s) => s.summary)
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const eventPending = useGame((s) => !!s.game?.pendingEvent)
  const outcome = useGame((s) => s.game?.outcome)
  const dismiss = useGame((s) => s.dismissSummary)
  if (!summary || fxBusy || outcome !== 'playing') return null
  return (
    <Modal
      title={`${turnDate(summary.turn)} is over`}
      kicker={`Turn ${summary.turn}`}
      onClose={dismiss}
      footer={
        <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={dismiss}>
          {eventPending ? 'Continue' : 'Start the next turn'}
        </button>
      }
    >
      <ul className="space-y-2">
        {summary.lines.slice(-14).map((line, i) => (
          <li key={i} className="text-[15px] text-white/85 border-l-2 border-white/20 pl-3">
            {line}
          </li>
        ))}
      </ul>
    </Modal>
  )
}

export function GameOver() {
  const game = useGame((s) => s.game)
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const quit = useGame((s) => s.quitToMenu)
  const abandon = useGame((s) => s.abandonGame)
  if (!game || game.outcome === 'playing' || fxBusy) return null
  const win = game.outcome === 'victory'
  const p = game.nations[game.playerId]
  const taken = countriesTaken(game)
  const reason = win
    ? taken >= conquestGoal(game.settings.victoryShare)
      ? `${p.name} holds ${taken} countries beyond its first borders, as of ${turnDate(game.turn)}.`
      : `${p.name} leads ${(populationShare(game, p.id) * 100).toFixed(1)}% of the world's people, as of ${turnDate(game.turn)}.`
    : `${p.name} fell in ${turnDate(game.turn)}. The nation is gone, so the game is lost.`
  return (
    <Modal
      title={win ? 'You won' : 'Your nation has fallen'}
      kicker={win ? 'Victory' : 'Defeat'}
      tone={win ? '#30d158' : '#ff453a'}
      footer={
        <>
          <button className="btn px-5 py-2.5 text-[15px]" onClick={quit}>
            Back to the menu
          </button>
          <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={abandon}>
            New game
          </button>
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

function IconFrame({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

function MilitaryIcon() {
  return (
    <IconFrame>
      <path d="M12 3l7 3v6c0 4.2-2.8 6.8-7 8-4.2-1.2-7-3.8-7-8V6l7-3z" />
      <path d="M9 12h6" />
    </IconFrame>
  )
}

function NationIcon() {
  return (
    <IconFrame>
      <path d="M4 20h16" />
      <path d="M6 20V10l6-5 6 5v10" />
      <path d="M10 20v-5h4v5" />
    </IconFrame>
  )
}

function ResearchIcon() {
  return (
    <IconFrame>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5" />
    </IconFrame>
  )
}

function PeopleIcon() {
  return (
    <IconFrame>
      <circle cx="8" cy="8" r="2.2" />
      <circle cx="16" cy="8" r="2.2" />
      <path d="M3.5 19a4.5 4.5 0 0 1 9 0" />
      <path d="M13 19a4.5 4.5 0 0 1 7.5-3.3" />
    </IconFrame>
  )
}

function NewsIcon() {
  return (
    <IconFrame>
      <path d="M5 5h9a2 2 0 0 1 2 2v12H7a2 2 0 0 1-2-2V5z" />
      <path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5V19a2 2 0 0 1-2 2H8" />
      <path d="M8 9h5M8 13h5" />
    </IconFrame>
  )
}

function SettingsIcon() {
  return (
    <IconFrame>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="8" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10" cy="17" r="1.6" fill="currentColor" stroke="none" />
    </IconFrame>
  )
}
