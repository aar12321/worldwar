import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { TERRAIN } from '../data/terrain'
import { getWorld } from '../map/world'
import { useGame } from '../store'

const VICTORY_OPTIONS = [
  { share: 0.25, label: 'Regional Power', sub: '25% of world population' },
  { share: 0.4, label: 'Superpower', sub: '40% of world population' },
  { share: 0.6, label: 'Total Hegemony', sub: '60% of world population' },
]

export function Setup() {
  const { map } = getWorld()
  const selected = useGame((s) => s.selectedRegion)
  const selectRegion = useGame((s) => s.selectRegion)
  const newGame = useGame((s) => s.newGame)
  const loadGame = useGame((s) => s.loadGame)
  const hasSave = useGame((s) => s.hasSave)
  const [query, setQuery] = useState('')
  const [share, setShare] = useState(0.6)
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
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="absolute top-10 left-1/2 -translate-x-1/2 text-center">
        <div className="label tracking-[0.6em]">A grand strategy of conquest</div>
        <h1 className="font-display text-6xl font-black tracking-[0.25em] mt-2 neon-text">WORLDS OF OTHERS</h1>
        <div className="mt-2 h-px w-full bg-gradient-to-r from-transparent via-fuchsia-400 to-transparent" />
      </motion.div>

      <motion.div initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.3, type: 'spring', stiffness: 160, damping: 22 }} className="glass pointer-events-auto absolute left-6 top-40 bottom-6 w-[380px] rounded-2xl flex flex-col overflow-hidden">
        <div className="p-5 border-b border-cyan-400/15">
          <div className="label">Choose your nation</div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 175 nations, or click the globe"
            className="mt-2 w-full rounded-md bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin p-2">
          {filtered.map(({ r, score }) => (
            <button
              key={r.id}
              onClick={() => selectRegion(r.id)}
              className={`w-full text-left rounded-md px-3 py-2 flex items-center justify-between transition-colors ${selected === r.id ? 'bg-cyan-400/20 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.6)]' : 'hover:bg-white/5'}`}
            >
              <span className="font-semibold">{r.name}</span>
              <span className="text-xs text-slate-400">{tier(score)}</span>
            </button>
          ))}
        </div>
      </motion.div>

      <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.45, type: 'spring', stiffness: 160, damping: 22 }} className="glass pointer-events-auto absolute right-6 bottom-6 w-[400px] rounded-2xl p-5 space-y-4">
        {pick ? (
          <div>
            <div className="label">{tier(Math.pow(pick.basePopulation, 0.6) * (0.3 + 0.7 * pick.development))}</div>
            <h2 className="font-display text-2xl font-bold tracking-wider mt-1">{pick.name}</h2>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <div className="rounded bg-slate-900/60 py-2">
                <div className="label">Population</div>
                <div className="font-semibold">{pick.basePopulation.toFixed(1)}M</div>
              </div>
              <div className="rounded bg-slate-900/60 py-2">
                <div className="label">Industry</div>
                <div className="font-semibold">{Math.round(pick.development * 100)}</div>
              </div>
              <div className="rounded bg-slate-900/60 py-2">
                <div className="label">Terrain</div>
                <div className="font-semibold">{TERRAIN[pick.terrain].name}</div>
              </div>
            </div>
            <div className="text-xs text-slate-400 mt-2">
              {pick.neighbors.length} land borders · {pick.seaLanes.length} sea lanes · {pick.coastal ? 'coastal' : 'landlocked'}
            </div>
          </div>
        ) : (
          <p className="text-slate-400 text-sm">Pick a nation from the list or click any country on the globe.</p>
        )}
        <div>
          <div className="label mb-2">Victory condition</div>
          <div className="grid grid-cols-3 gap-2">
            {VICTORY_OPTIONS.map((v) => (
              <button key={v.share} onClick={() => setShare(v.share)} className={`rounded-md border p-2 text-left ${share === v.share ? 'border-fuchsia-400/70 bg-fuchsia-400/10' : 'border-slate-700 hover:border-slate-500'}`}>
                <div className="text-xs font-semibold">{v.label}</div>
                <div className="text-[10px] text-slate-400">{v.sub}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="label">World seed</span>
          <input type="number" value={seed} onChange={(e) => setSeed(Math.floor(+e.target.value) || 0)} className="w-28 rounded bg-slate-950/70 border border-slate-700 px-2 py-1" />
          <button className="text-xs text-slate-400 hover:text-white" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>
            reroll
          </button>
        </div>
        <div className="flex gap-2">
          {hasSave && (
            <button className="btn flex-1 py-3" onClick={loadGame}>
              Continue
            </button>
          )}
          <button className="btn btn-primary flex-[2] py-3" disabled={!pick} onClick={() => pick && newGame({ playerRegionId: pick.id, seed, victoryShare: share })}>
            Begin Campaign
          </button>
        </div>
        <p className="text-[11px] text-slate-500">Every other nation is run by an AI rival. One turn is one month, starting January 1936.</p>
      </motion.div>
    </div>
  )
}
