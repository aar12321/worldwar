import { dayDate, isLive } from '../engine/calendar'
import { AnimatePresence, motion } from 'framer-motion'
import { turnDate } from '../engine/helpers'
import { describeOrder } from '../engine/resolveTurn'
import { controlled, countriesTaken, goalSentence, populationShare } from '../engine/victory'
import { getWorld } from '../map/world'
import { useGame, type ReportDelta } from '../store'
import { AdviceList } from './Briefing'
import { fmt, signed, useAdvice, usePlayerView } from './hooks'
import { Modal } from './Modal'
import { Spark } from './Charts'

/** The desk rail (and the phone's bottom bar). It lives in Nav.tsx and is built from the registry in registry.ts. */
export { NavRail } from './Nav'

export function OrdersTray() {
  const view = usePlayerView()
  const removeOrder = useGame((s) => s.removeOrder)
  // A live day hands the store a fresh empty undo list, so read what the tray shows, not the list.
  const undoCount = useGame((s) => s.undoStack.length)
  const undoLabel = useGame((s) => s.undoStack[s.undoStack.length - 1]?.label)
  const undo = useGame((s) => s.undo)
  if (!view || (view.orders.length === 0 && undoCount === 0)) return null
  const { game, orders } = view
  const { map } = getWorld()
  return (
    <motion.div className="orders-tray absolute bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[min(70vw,820px)]" role="region" aria-label="Orders" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}>
      <div className="surface rounded-full px-3 py-1.5 flex items-center gap-2 overflow-x-auto scroll-thin">
        {undoCount > 0 && (
          <button className="tray-chip whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-semibold bg-[#0a84ff]/25 text-[#9fd0ff] hover:bg-[#0a84ff]/40" onClick={undo} title={`Undo: ${undoLabel} (Ctrl+Z)`} aria-label={`Undo ${undoLabel}`}>
            ↶ Undo
          </button>
        )}
        {orders.length > 0 && <span className="label whitespace-nowrap px-1">{isLive(game) ? `On ${dayDate(game.turn + 1, 0)}` : 'Next turn'}</span>}
        <AnimatePresence initial={false}>
          {orders.map((o, i) => (
            <motion.button
              key={`${i}-${describeOrder(game, map, o)}`}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.14 }}
              onClick={() => removeOrder(i)}
              className="tray-chip whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium hover:line-through bg-white/10 text-white/90"
              title="Click to cancel"
              aria-label={`Cancel order: ${describeOrder(game, map, o)}`}
            >
              {describeOrder(game, map, o)}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const dismiss = useGame((s) => s.dismissToast)
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout="position"
            initial={{ x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`toast pointer-events-auto surface rounded-2xl pl-4 pr-1.5 py-2.5 text-[14px] max-w-sm flex items-start gap-2 ${t.tone === 'error' ? 'text-[#ff8a84]' : t.tone === 'success' ? 'text-[#6eeb8a]' : ''}`}
          >
            <span className="toast-mark" aria-hidden>
              {t.tone === 'error' ? '!' : t.tone === 'success' ? '\u2713' : 'i'}
            </span>
            <span className="flex-1 min-w-0 py-0.5">{t.text}</span>
            {t.action && (
              <button
                className="shrink-0 btn btn-quiet toast-action"
                onClick={() => {
                  t.action?.run()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="shrink-0 w-8 h-8 rounded-full text-white/60 hover:text-white hover:bg-white/10 text-[18px] leading-none" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
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
  // Only a finished game is read, so a running game does not re-render this every day.
  const game = useGame((s) => (s.game && s.game.outcome !== 'playing' ? s.game : null))
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const quit = useGame((s) => s.quitToMenu)
  const abandon = useGame((s) => s.abandonGame)
  const rematch = useGame((s) => s.rematchOnline)
  const room = useGame((s) => s.online)
  const online = !!room
  if (!game || game.outcome === 'playing' || fxBusy) return null
  const win = game.outcome === 'victory'
  // Who won. Single-player saves from before this was recorded have no winner, so the player is it.
  const champion = game.nations[game.winner ?? game.playerId]
  const youWon = win && champion.id === game.playerId
  const p = youWon || !win ? game.nations[game.playerId] : champion
  const taken = countriesTaken(game, p.id)
  const when = isLive(game) ? dayDate(game.turn, game.day ?? 0) : turnDate(game.turn)
  // In a room, the winner is a person: say who.
  const players = (room?.lobby?.players ?? []).filter((x) => x.nationId)
  const winnerName = win ? players.find((x) => x.nationId === champion.id)?.name : undefined
  const classic = game.settings.goal === 'classic'
  const reason = win
    ? classic
      ? `${winnerName ? `${winnerName} (${p.name})` : p.name} was first to ${goalSentence(game)}, as of ${when}.`
      : `${winnerName ? `${winnerName} (${p.name})` : p.name} holds the whole world: ${controlled(game, p.id)} countries, as of ${when}.`
    : game.humans.length > 1 || online
      ? `Every player's nation has fallen, as of ${when}.`
      : p.alive && game.scenario
        ? `Time ran out, as of ${when}: you did not manage to ${goalSentence(game)} in time.`
        : `${p.name} fell ${isLive(game) ? 'on' : 'in'} ${when}. The nation is gone, so the game is lost.`
  const standings = players
    .map((x) => {
      const n = game.nations[x.nationId as string]
      const last = (game.history ?? []).filter((h) => h.nation === x.nationId).at(-1)
      return { name: x.name, nation: n, countries: controlled(game, x.nationId as string), people: populationShare(game, x.nationId as string), power: last?.power ?? 0, out: !n?.alive || game.eliminated.includes(x.nationId as string), won: game.winner === x.nationId }
    })
    .sort((a, b) => Number(b.won) - Number(a.won) || Number(a.out) - Number(b.out) || b.countries - a.countries)
  return (
    <Modal
      title={youWon ? 'You won' : win ? `${winnerName ?? champion.name} won` : game.humans.length > 1 || online ? 'Every nation has fallen' : p.alive && game.scenario ? 'Out of time' : 'Your nation has fallen'}
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
          {online && room?.host && (
            <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={rematch} title="Everyone goes back to the lobby, with a new world">
              Rematch
            </button>
          )}
        </>
      }
    >
      <p className="text-[16px] text-white/85">{reason}</p>
      {standings.length > 1 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[14px] border-separate border-spacing-y-1" aria-label="Final standings">
            <thead>
              <tr className="text-left text-[12px] text-white/60">
                <th className="font-medium pb-1">Player</th>
                <th className="font-medium pb-1 px-3 text-right whitespace-nowrap">Countries</th>
                <th className="font-medium pb-1 px-3 text-right whitespace-nowrap">World's people</th>
                <th className="font-medium pb-1 px-3 text-right whitespace-nowrap">Strength</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((r) => (
                <tr key={r.name + r.nation?.id} className="bg-white/6">
                  <td className="rounded-l-lg px-3 py-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: r.nation?.color }} />
                    <span className="font-semibold">{r.name}</span> <span className="text-white/65">· {r.nation?.name}</span>
                    {r.won && <span className="ml-2 text-[12px] font-semibold text-[#6eeb8a]">Winner</span>}
                    {r.out && <span className="ml-2 text-[12px] text-[#ff8a84]">Out</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.countries}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(r.people * 100).toFixed(1)}%</td>
                  <td className="rounded-r-lg px-3 py-2 text-right tabular-nums">{fmt(r.power, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
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
      )}
      {(game.history ?? []).filter((h) => h.nation === game.playerId).length >= 2 && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Spark label="Your countries over the game" values={(game.history ?? []).filter((h) => h.nation === game.playerId).map((h) => h.countries)} color="#0a84ff" />
          <Spark label="Your military strength" values={(game.history ?? []).filter((h) => h.nation === game.playerId).map((h) => h.power)} color="#ff9f0a" />
        </div>
      )}
    </Modal>
  )
}
