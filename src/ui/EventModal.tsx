import { AnimatePresence, motion } from 'framer-motion'
import { EVENT_BY_ID } from '../data/events'
import { computeEconomy } from '../engine/economy'
import { describeEffect, fillEventText } from '../engine/events'
import { turnDate } from '../engine/helpers'
import { getWorld } from '../map/world'
import { useGame } from '../store'

const TONE = {
  crisis: { color: '#f43f5e', label: 'CRISIS' },
  opportunity: { color: '#22d3ee', label: 'OPPORTUNITY' },
  war: { color: '#fbbf24', label: 'SECURITY ALERT' },
}

export function EventModal() {
  const game = useGame((s) => s.game)
  const fxBusy = useGame((s) => s.fxQueue.length > 0)
  const choose = useGame((s) => s.chooseEventOption)
  const ev = game?.pendingEvent
  const show = !!(game && ev && !fxBusy)
  const { map } = getWorld()
  const def = ev ? EVENT_BY_ID[ev.eventId] : null
  const tone = def ? TONE[def.tone] : TONE.crisis
  const workforce = game ? computeEconomy(game, map, game.playerId).workforce : 0

  return (
    <AnimatePresence>
      {show && def && ev && (
        <motion.div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <motion.div
            initial={{ scale: 0.85, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="glass relative w-[640px] max-w-[92vw] rounded-2xl overflow-hidden"
            style={{ borderColor: `${tone.color}88`, boxShadow: `0 0 60px ${tone.color}33` }}
          >
            <div className="h-1.5" style={{ background: `linear-gradient(90deg, transparent, ${tone.color}, transparent)` }} />
            <div className="p-7">
              <div className="flex items-center justify-between">
                <span className="font-display text-[11px] tracking-[0.35em]" style={{ color: tone.color }}>
                  CRITICAL DECISION · {tone.label}
                </span>
                <span className="text-xs text-slate-400">{turnDate(game!.turn)}</span>
              </div>
              <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="font-display text-3xl font-black mt-3 tracking-[0.12em]">
                {def.title.toUpperCase()}
              </motion.h2>
              <p className="mt-4 text-lg text-slate-300 leading-relaxed">{fillEventText(def.text, game!, map, ev)}</p>
              <div className="grid grid-cols-2 gap-4 mt-6">
                {def.options.map((opt, i) => (
                  <motion.button
                    key={opt.label}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => choose(i)}
                    className="text-left rounded-xl border p-4 bg-slate-950/60 hover:bg-slate-900/80 transition-colors"
                    style={{ borderColor: i === 0 ? '#e879f988' : '#22d3ee88' }}
                  >
                    <div className="font-display text-[10px] tracking-[0.3em] text-slate-400">OPTION {String.fromCharCode(65 + i)}</div>
                    <div className={`font-display text-lg font-bold mt-1 ${i === 0 ? 'text-fuchsia-200' : 'text-cyan-200'}`}>{opt.label}</div>
                    <p className="text-sm text-slate-400 mt-1">{fillEventText(opt.description, game!, map, ev)}</p>
                    <ul className="mt-3 space-y-1">
                      {opt.effects.map((e, j) => {
                        const text = describeEffect(e, workforce, game!, map, ev)
                        const bad = text.startsWith('-') || /casus belli|Rebels|Lose/.test(text)
                        return (
                          <li key={j} className={`text-sm font-semibold ${bad ? 'text-rose-300' : 'text-emerald-300'}`}>
                            {text}
                          </li>
                        )
                      })}
                    </ul>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
