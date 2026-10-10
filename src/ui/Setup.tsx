import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { DIFFICULTY } from '../data/difficulty'
import { TERRAIN } from '../data/terrain'
import type { Difficulty } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'

const VICTORY_OPTIONS = [
  { share: 0.25, label: 'Short', sub: 'Lead 25% of all people' },
  { share: 0.4, label: 'Full', sub: 'Lead 40%. Recommended.' },
  { share: 0.6, label: 'Long', sub: 'Lead 60% of all people' },
]

export function Setup() {
  const { map } = getWorld()
  const selected = useGame((s) => s.selectedRegion)
  const selectRegion = useGame((s) => s.selectRegion)
  const newGame = useGame((s) => s.newGame)
  const loadGame = useGame((s) => s.loadGame)
  const hasSave = useGame((s) => s.hasSave)
  const [query, setQuery] = useState('')
  const [share, setShare] = useState(0.4)
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6))

  const nations = useMemo(
    () =>
      Object.values(map.regions)
        .map((r) => ({ r, score: Math.pow(r.basePopulation, 0.6) * (0.3 + 0.7 * r.development) }))
        .sort((a, b) => b.score - a.score),
    [map],
  )
  const filtered = nations.filter(({ r }) => r.name.toLowerCase().includes(query.toLowerCase()))
  const pick = selected ? map.regions[selected] : null
  const tier = (score: number) => (score > 25 ? 'Great Power' : score > 10 ? 'Major Power' : score > 4 ? 'Regional Power' : 'Minor Nation')

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="absolute top-8 left-1/2 -translate-x-1/2 text-center w-[min(640px,90vw)]">
        <p className="text-[13px] font-medium text-white/50">January 1936</p>
        <h1 className="text-[40px] font-semibold tracking-tight text-white mt-1">Worlds of Others</h1>
        <p className="mt-2 text-[15px] text-white/65">Pick a nation. Each turn is one month. Win by leading enough of the world’s people.</p>
      </motion.div>

      <motion.div initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.32, delay: 0.05, ease: [0.22, 1, 0.36, 1] }} className="glass pointer-events-auto absolute left-6 top-36 bottom-6 w-[380px] rounded-[22px] flex flex-col overflow-hidden">
        <div className="p-5 border-b border-white/10">
          <div className="text-[17px] font-semibold tracking-tight">Choose a nation</div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search, or click the globe"
            className="field mt-3 w-full px-3 py-2 text-[14px]"
          />
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin p-2">
          {filtered.map(({ r, score }) => (
            <button
              key={r.id}
              onClick={() => selectRegion(r.id)}
              className={`w-full text-left rounded-xl px-3 py-2 flex items-center justify-between transition-colors ${selected === r.id ? 'bg-white/12' : 'hover:bg-white/6'}`}
            >
              <span className="font-semibold">{r.name}</span>
              <span className="text-xs text-slate-400">{tier(score)}</span>
            </button>
          ))}
        </div>
      </motion.div>

      <motion.div initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.32, delay: 0.1, ease: [0.22, 1, 0.36, 1] }} className="glass pointer-events-auto absolute right-6 bottom-6 w-[400px] rounded-[22px] p-5 space-y-4">
        {pick ? (
          <div>
            <div className="label">{tier(Math.pow(pick.basePopulation, 0.6) * (0.3 + 0.7 * pick.development))}</div>
            <h2 className="text-[28px] font-semibold tracking-tight mt-1">{pick.name}</h2>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <div className="inset-card py-2">
                <div className="label">People</div>
                <div className="font-semibold">{pick.basePopulation.toFixed(1)}m</div>
              </div>
              <div className="inset-card py-2">
                <div className="label">Industry</div>
                <div className="font-semibold">{Math.round(pick.development * 100)}</div>
              </div>
              <div className="inset-card py-2">
                <div className="label">Land</div>
                <div className="font-semibold">{TERRAIN[pick.terrain].name}</div>
              </div>
            </div>
            <div className="text-xs text-slate-400 mt-2">
              {pick.neighbors.length} land borders · {pick.seaLanes.length} sea lanes · {pick.coastal ? 'coastal' : 'landlocked'}
            </div>
          </div>
        ) : (
          <p className="text-white/55 text-[14px]">Pick a nation from the list, or click any country on the globe.</p>
        )}
        <div>
          <div className="label mb-2">How you win</div>
          <div className="grid grid-cols-3 gap-2">
            {VICTORY_OPTIONS.map((v) => (
              <button key={v.share} onClick={() => setShare(v.share)} className={`rounded-xl p-2 text-left ${share === v.share ? 'bg-[#0a84ff] text-white' : 'bg-white/8 hover:bg-white/12'}`}>
                <div className="text-xs font-semibold">{v.label}</div>
                <div className={`text-[11px] leading-tight mt-0.5 ${share === v.share ? 'text-white/80' : 'text-white/50'}`}>{v.sub}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-2">Rivals</div>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
              <button key={d} onClick={() => setDifficulty(d)} title={DIFFICULTY[d].description} className={`rounded-xl p-2 text-left ${difficulty === d ? 'bg-white/16' : 'bg-white/8 hover:bg-white/12'}`}>
                <div className="text-[13px] font-semibold">{DIFFICULTY[d].name}</div>
                <div className="text-[11px] text-white/50 leading-tight">{DIFFICULTY[d].description}</div>
              </button>
            ))}
          </div>
        </div>
        <details className="text-[13px] text-white/55">
          <summary className="cursor-pointer">Advanced</summary>
          <div className="mt-2 flex items-center gap-2">
            <span>World seed</span>
            <input type="number" value={seed} onChange={(e) => setSeed(Math.floor(+e.target.value) || 0)} className="field w-28 px-2 py-1" />
            <button className="text-[12px] text-[#64a8ff]" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>
              New seed
            </button>
          </div>
        </details>
        <div className="flex gap-2">
          {hasSave && (
            <button className="btn flex-1 py-3" onClick={loadGame}>
            Continue
          </button>
          )}
          <button className="btn btn-primary flex-[2] py-3 text-[15px]" disabled={!pick} onClick={() => pick && newGame({ playerRegionId: pick.id, seed, victoryShare: share, difficulty })}>
            Start game
          </button>
        </div>
        <p className="text-[12px] text-white/40">Every other nation is a rival. You all act at the same time.</p>
      </motion.div>
    </div>
  )
}
