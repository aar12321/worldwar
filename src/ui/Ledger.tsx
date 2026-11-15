import { useMemo, useState } from 'react'
import { nationNeighbors, opinionLabel, opinionOf } from '../ai/opinion'
import { tierSpec } from '../data/empire'
import { computeEconomy } from '../engine/economy'
import { atWar, hasPact, isAllied } from '../engine/helpers'
import { powerView, showPower, type PowerView } from '../engine/intel'
import type { GameState, NationId } from '../engine/types'
import { getWorld } from '../map/world'

type Key = 'name' | 'countries' | 'power' | 'income' | 'opinion' | 'relation'
type Relation = 'war' | 'ally' | 'pact' | 'puppet' | 'peace'
const RELATION_ORDER: Record<Relation, number> = { war: 0, ally: 1, pact: 2, puppet: 3, peace: 4 }
const RELATION_NAME: Record<Relation, string> = { war: 'At war', ally: 'Ally', pact: 'Pact', puppet: 'Puppet', peace: 'Peace' }
const RELATION_COLOR: Record<Relation, string> = { war: 'text-[#ff8a84]', ally: 'text-[#64d2ff]', pact: 'text-[#6eeb8a]', puppet: 'text-[#ffd60a]', peace: 'text-white/60' }

interface Row {
  id: NationId
  name: string
  color: string
  countries: number
  power: PowerView
  income: number
  opinion: number
  relation: Relation
  neighbor: boolean
  tier: number
}

function rowsFor(game: GameState): Row[] {
  const { map } = getWorld()
  const me = game.playerId
  const near = nationNeighbors(game, map, me)
  const counts = new Map<NationId, number>()
  for (const r of Object.values(game.regions)) counts.set(r.owner, (counts.get(r.owner) ?? 0) + 1)
  const out: Row[] = []
  for (const n of Object.values(game.nations)) {
    if (!n.alive || n.id === me) continue
    out.push({
      id: n.id,
      name: n.name,
      color: n.color,
      countries: counts.get(n.id) ?? 0,
      power: powerView(game, me, n.id),
      income: computeEconomy(game, map, n.id).gross,
      opinion: opinionOf(game, map, n.id, me, { borders: near.has(n.id), coalition: false }),
      relation: n.overlord === me ? 'puppet' : atWar(game, me, n.id) ? 'war' : isAllied(game, me, n.id) ? 'ally' : hasPact(game, me, n.id) ? 'pact' : 'peace',
      neighbor: near.has(n.id),
      tier: n.tier ?? 1,
    })
  }
  return out
}

const FILTERS = [
  ['all', 'Everyone'],
  ['neighbors', 'Neighbors'],
  ['war', 'At war'],
  ['ally', 'Allies'],
  ['big', 'Great powers'],
] as const

/** Every nation in one table: sort by what matters, filter, and open any row in the nation list above. */
export function Ledger({ game, onOpen }: { game: GameState; onOpen: (id: NationId) => void }) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'countries', dir: -1 })
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all')
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const rows = useMemo(() => rowsFor(game), [game])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rows.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (filter === 'all' || (filter === 'neighbors' && r.neighbor) || (filter === 'war' && r.relation === 'war') || (filter === 'ally' && r.relation === 'ally') || (filter === 'big' && r.tier >= 3)))
    list.sort((a, b) => {
      const v = sort.key === 'name' ? a.name.localeCompare(b.name) : sort.key === 'relation' ? RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] : sort.key === 'power' ? a.power.value - b.power.value : a[sort.key] - b[sort.key]
      return (v || a.name.localeCompare(b.name)) * sort.dir
    })
    return list
  }, [rows, sort, filter, query])
  const head = (key: Key, label: string, right = false) => (
    <th scope="col" className={`px-2 py-1.5 font-medium ${right ? 'text-right' : 'text-left'}`} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="hover:text-white inline-flex items-center gap-1" onClick={() => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' || key === 'relation' ? 1 : -1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </button>
    </th>
  )
  const visible = all ? shown : shown.slice(0, 40)
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="field px-3 py-2 text-[14px] flex-1 min-w-40" placeholder="Search nations" aria-label="Search nations" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filter nations">
          {FILTERS.map(([k, name]) => (
            <button key={k} role="radio" aria-checked={filter === k} className={`btn px-2.5 py-1.5 text-[13px] ${filter === k ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setFilter(k)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto scroll-thin rounded-xl bg-white/5">
        <table className="w-full text-[13px] tabular-nums">
          <thead className="text-white/60 border-b border-white/10">
            <tr>
              {head('name', 'Nation')}
              {head('countries', 'Countries', true)}
              {head('power', 'Strength', true)}
              {head('income', 'Income', true)}
              {head('opinion', 'Opinion', true)}
              {head('relation', 'Relation')}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => onOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}>
                <td className="px-2 py-1.5">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                    <span className="truncate max-w-40">{r.name}</span>
                    {r.tier >= 2 && <span className="chip text-[11px]">{tierSpec(r.tier).name}</span>}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">{r.countries}</td>
                <td className="px-2 py-1.5 text-right">{showPower(r.power)}</td>
                <td className="px-2 py-1.5 text-right">{r.income.toFixed(0)}</td>
                <td className="px-2 py-1.5 text-right" title={opinionLabel(r.opinion)}>
                  {r.opinion > 0 ? '+' : ''}
                  {r.opinion.toFixed(0)}
                </td>
                <td className={`px-2 py-1.5 ${RELATION_COLOR[r.relation]}`}>{RELATION_NAME[r.relation]}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-white/60">
                  No nation matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-[12px] text-white/60">
        <span>
          {visible.length} of {shown.length} nations. Opinion is how they see you. Click a row to open it.
        </span>
        {shown.length > 40 && (
          <button className="underline" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : 'Show all'}
          </button>
        )}
      </div>
    </section>
  )
}
