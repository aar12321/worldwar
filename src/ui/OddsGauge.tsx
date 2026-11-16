import { useState } from 'react'
import type { Factor, Forecast, RoughOdds, Tone } from '../engine/forecast'
import { totalUnits } from '../engine/helpers'

const TONE_TEXT: Record<string, string> = { Likely: 'text-[#6eeb8a]', Even: 'text-[#ffd60a]', Unlikely: 'text-[#ff8a84]' }
const TONE_BG: Record<string, string> = { Likely: '#30d158', Even: '#ffd60a', Unlikely: '#ff453a' }
const FACTOR_MARK: Record<Tone, { mark: string; text: string; word: string }> = {
  good: { mark: '▲', text: 'text-[#6eeb8a]', word: 'helps you' },
  bad: { mark: '▼', text: 'text-[#ff8a84]', word: 'hurts you' },
  neutral: { mark: '●', text: 'text-white/55', word: 'neutral' },
}

const lossWord = (share: number) => (share < 0.15 ? 'light' : share < 0.3 ? 'moderate' : 'heavy')

/** The bar under the number: a 0 to 100 track with the range the estimate could be in, and a marker for the number when it is exact. */
function Track({ low, high, at, color }: { low: number; high: number; at?: number; color: string }) {
  const w = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`
  return (
    <div className="relative h-3.5 rounded-full bg-white/12 overflow-hidden" aria-hidden>
      <div className="absolute inset-y-0 left-0 w-[40%] bg-[#ff453a]/20" />
      <div className="absolute inset-y-0 left-[40%] w-[30%] bg-[#ffd60a]/15" />
      <div className="absolute inset-y-0 left-[70%] right-0 bg-[#30d158]/20" />
      <div className="absolute inset-y-0 rounded-full" style={{ left: w(low), width: `${Math.max(1.5, (high - low) * 100)}%`, background: color, opacity: at === undefined ? 0.75 : 0.45 }} />
      {at !== undefined && <div className="absolute inset-y-0 w-1 -ml-0.5 rounded-full bg-white shadow" style={{ left: w(at) }} />}
    </div>
  )
}

/**
 * The chance to win, as big as the thing it answers. With AI Battle Command it is one exact number with its range; without, a rough
 * band that always holds the real chance but never pins it down, and says how well you can see the other side.
 */
export function OddsGauge({ forecast, rough, exact, busy }: { forecast: Forecast | null; rough: RoughOdds | null; exact: boolean; busy?: boolean }) {
  if (!forecast) {
    return (
      <section className="inset-card p-4" aria-label="Chance to win">
        <div className="label">Chance to win</div>
        <div className="text-[15px] text-white/75 mt-1">Choose units to send to see the odds.</div>
      </section>
    )
  }
  const label = exact ? forecast.label : (rough?.label ?? forecast.label)
  const low = exact ? forecast.low : (rough?.low ?? forecast.low)
  const high = exact ? forecast.high : (rough?.high ?? forecast.high)
  const pct = Math.round(forecast.winChance * 100)
  const text = exact ? `${pct}%` : (rough?.text.replace('about ', '~') ?? `${pct}%`)
  return (
    <section className={`inset-card p-4 space-y-2.5 ${busy ? 'opacity-70' : ''}`} aria-label="Chance to win" data-odds={exact ? 'exact' : 'rough'}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="label">Chance to win{exact ? '' : ' (rough)'}</div>
          <div className="flex items-baseline gap-2">
            <span className={`text-[44px] leading-none font-semibold tabular-nums tracking-tight ${TONE_TEXT[label]}`} aria-live="polite" aria-atomic="true">
              {text}
            </span>
            <span className={`text-[16px] font-semibold ${TONE_TEXT[label]}`}>{label}</span>
          </div>
        </div>
        <div className="text-right text-[13px] text-white/75 tabular-nums leading-snug">
          <div>
            {exact ? 'likely between ' : 'could be anywhere from '}
            <b className="text-white">
              {Math.round(low * 100)}% to {Math.round(high * 100)}%
            </b>
          </div>
          <div>
            {exact ? 'country falls this attack ' : 'expect losses that are '}
            <b className="text-white">{exact ? `${Math.round(forecast.captureChance * 100)}%` : lossWord(forecast.yourLosses / Math.max(1, totalUnits(forecast.sent)))}</b>
          </div>
        </div>
      </div>
      <Track low={low} high={high} at={exact ? forecast.winChance : undefined} color={TONE_BG[label]} />
      <p className="text-[12px] text-white/65">
        {exact ? `Exact: AI Battle Command ran this fight ${forecast.runs} times. The range is how far the estimate itself could be off.` : `${rough?.note ?? ''} AI Battle Command gives the exact number.`}
      </p>
    </section>
  )
}

/** Each part of the fight, what it does to the odds, and (open it) how it works. */
export function Breakdown({ factors, exact, fuzzDefence }: { factors: Factor[]; exact: boolean; fuzzDefence?: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="space-y-1.5" aria-label="What decides the fight">
      <h3 className="text-[15px] font-semibold">What decides it</h3>
      <ul className="inset-card divide-y divide-white/8">
        {factors.map((f) => {
          const m = FACTOR_MARK[f.tone]
          const isOpen = open === f.id
          // Without AI Battle Command you only know the other army's strength roughly.
          const summary = !exact && fuzzDefence && f.id === 'force' ? f.summary.replace(/against (\d+)/, (_m, d) => `against about ${Math.round(Number(d) / 10) * 10}`) : f.summary
          return (
            <li key={f.id}>
              <button type="button" className="w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-white/5" aria-expanded={isOpen} aria-label={`${f.label}: ${summary}. ${m.word}. Press for how it works.`} onClick={() => setOpen(isOpen ? null : f.id)}>
                <span className={`mt-0.5 text-[12px] w-4 shrink-0 ${m.text}`} aria-hidden>
                  {m.mark}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">{f.label}</span>
                  <span className="block text-[13px] text-white/75">{summary}</span>
                </span>
                <span className="text-[12px] text-white/50 shrink-0 mt-0.5" aria-hidden>
                  {isOpen ? 'Hide' : 'Why?'}
                </span>
              </button>
              {isOpen && <p className="px-3 pb-2.5 pl-[38px] text-[13px] text-white/75">{f.tip}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
