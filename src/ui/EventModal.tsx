import { AnimatePresence, motion } from 'framer-motion'
import { EVENT_BY_ID } from '../data/events'
import { computeEconomy } from '../engine/economy'
import { describeEffect, fillEventText } from '../engine/events'
import { turnDate } from '../engine/helpers'
import { getWorld } from '../map/world'
import { useGame } from '../store'

const TONE = {
  crisis: { color: '#ff453a', label: 'Crisis' },
  opportunity: { color: '#0a84ff', label: 'Opportunity' },
  war: { color: '#ff9f0a', label: 'Security' },
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
            className="glass relative w-[640px] max-w-[92vw] rounded-[28px] overflow-hidden"
          >
            <div className="h-1" style={{ background: tone.color }} />
            <div className="p-7">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold" style={{ color: tone.color }}>
                  Decision · {tone.label}
                </span>
                <span className="text-[12px] text-white/45">{turnDate(game!.turn)}</span>
              </div>
              <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="text-[32px] font-semibold tracking-tight mt-2">
                {def.title}
              </motion.h2>
              <p className="mt-3 text-[16px] text-white/75 leading-relaxed">{fillEventText(def.text, game!, map, ev)}</p>
              <div className="grid grid-cols-2 gap-4 mt-6">
                {def.options.map((opt, i) => (
                  <motion.button
                    key={opt.label}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => choose(i)}
                    className="text-left rounded-2xl p-4 bg-white/6 hover:bg-white/10 transition-colors"
                  >
                    <div className="text-[12px] font-medium text-white/40">Choice {i + 1}</div>
                    <div className="text-[17px] font-semibold tracking-tight mt-1">{opt.label}</div>
                    <p className="text-[13px] text-white/55 mt-1">{fillEventText(opt.description, game!, map, ev)}</p>
                    <ul className="mt-3 space-y-1">
                      {opt.effects.map((e, j) => {
                        const text = describeEffect(e, workforce, game!, map, ev)
                        const bad = text.startsWith('-') || /grievance|Rebels|Lose|loses/.test(text)
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
