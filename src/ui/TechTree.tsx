import { useState } from 'react'
import { BRANCH_LABELS, TECHS, type Tech } from '../data/techTree'
import { PROGRAM_RULES, RESEARCH_PROGRAMS, programCost } from '../data/projects'
import type { ResearchTrack } from '../engine/types'
import { OrderButton } from './panel'
import { validateOrder } from '../engine/orders'
import type { TechBranch } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { fmt, signed, usePlayerView } from './hooks'
import { techBonuses } from '../engine/techBonuses'
import { speak } from './plain'
import './economy/nation.css'

const BRANCHES: TechBranch[] = ['land', 'air', 'naval', 'infra', 'economy', 'frontier', 'medicine']
const BRANCH_COLOR: Record<TechBranch, string> = { land: '#ff9f0a', air: '#64d2ff', naval: '#0a84ff', infra: '#bf5af2', economy: '#30d158', frontier: '#ff375f', medicine: '#66d4cf' }

function TechNode({ tech }: { tech: Tech }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const removeOrder = useGame((s) => s.removeOrder)
  const { game, player, orders } = view
  const owned = player.techs.includes(tech.id)
  const queuedIdx = orders.findIndex((o) => o.type === 'research' && o.techId === tech.id)
  const order = { type: 'research' as const, nationId: player.id, techId: tech.id }
  const err = owned || queuedIdx >= 0 ? null : validateOrder(game, getWorld().map, order, orders)
  const available = !owned && queuedIdx < 0 && !err
  const color = BRANCH_COLOR[tech.branch]
  const state = owned ? 'owned' : queuedIdx >= 0 ? 'queued' : available ? 'available' : 'locked'

  return (
    <button
      onClick={() => {
        if (queuedIdx >= 0) removeOrder(queuedIdx)
        else if (available) issueOrder(order)
        else if (err) useGame.getState().toast(speak(err), 'error')
      }}
      disabled={state === 'owned'}
      className={`relative w-full text-left rounded-2xl p-3 border transition-[colors,transform] disabled:cursor-default ${state === 'available' ? 'hover:-translate-y-0.5' : ''} ${state === 'locked' ? 'cursor-help border-white/10 bg-white/4' : 'border-white/10'}`}
      style={{
        background: owned ? `${color}22` : state === 'queued' ? 'rgba(255,255,255,0.08)' : state === 'available' ? 'rgba(255,255,255,0.06)' : undefined,
        opacity: state === 'locked' ? 0.85 : 1,
      }}
      title={err ? speak(err) : ''}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold" style={{ color }}>
          Step {tech.tier}
        </span>
        <span className="text-[12px] font-medium text-white/60">{owned ? 'Yours' : state === 'queued' ? 'Queued' : `${tech.cost} research`}</span>
      </div>
      <div className="text-[15px] font-semibold tracking-tight mt-1">{tech.name}</div>
      <div className="text-[12px] text-white/55 mt-1 leading-snug">{tech.description}</div>
      {tech.unlocks && <div className="text-[12px] text-[#ff8a9f] mt-1 font-medium">Unlocks: {tech.unlocks.join(', ')}</div>}
      {state === 'locked' && err && <div className="text-[12px] text-[#ff8a84] mt-1">{speak(err)}</div>}
    </button>
  )
}

/** What the technologies you own give you, grouped, with where each bonus comes from. */
/** What to do with research once the tree is done, or when there is more than the next technology needs. */
function Programs() {
  const view = usePlayerView()!
  const { player, orders } = view
  const queued = (t: ResearchTrack) => orders.some((o) => o.type === 'researchProgram' && o.track === t)
  return (
    <details className="inset-card p-4 mb-6">
      <summary className="cursor-pointer text-[16px] font-semibold tracking-tight">Future programs: spare research with a lasting payoff</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {(Object.keys(RESEARCH_PROGRAMS) as ResearchTrack[]).map((t) => {
          const level = player.research2[t] ?? 0
          const done = level >= PROGRAM_RULES.maxLevel
          return (
            <div key={t} className="rounded-xl bg-white/5 p-3 space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] font-semibold">{RESEARCH_PROGRAMS[t].name}</span>
                <span className="text-[13px] tabular-nums text-white/70">level {level} of {PROGRAM_RULES.maxLevel}</span>
              </div>
              <p className="text-[12px] text-white/65">{RESEARCH_PROGRAMS[t].blurb} {RESEARCH_PROGRAMS[t].perLevel}.</p>
              {done ? (
                <span className="chip">Complete</span>
              ) : (
                <OrderButton order={{ type: 'researchProgram', nationId: player.id, track: t }} label={queued(t) ? 'Queued' : 'Next level'} cost={`${programCost(level)} research`} />
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}

function Bonuses() {
  const view = usePlayerView()!
  const groups = techBonuses(view.player)
  return (
    <details className="inset-card p-4 mb-4">
      <summary className="cursor-pointer text-[16px] font-semibold tracking-tight">
        What your technology gives you <span className="text-[13px] font-normal text-white/60">({view.player.techs.length} researched)</span>
      </summary>
      {groups.length === 0 ? (
        <p className="text-[14px] text-white/70 mt-2">Nothing yet. Research a technology and its bonuses will be listed here.</p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <section key={g.title} className="space-y-1.5">
              <h3 className="label">{g.title}</h3>
              <ul className="space-y-1.5 text-[14px]">
                {g.lines.map((l) => (
                  <li key={`${g.title}-${l.label}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span>{l.label}</span>
                      {l.value && <span className="font-semibold tabular-nums text-[#6eeb8a] text-right">{l.value}</span>}
                    </div>
                    {l.from.length > 0 && <div className="text-[12px] text-white/55">{l.from.join(', ')}</div>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </details>
  )
}

export function TechTree() {
  const view = usePlayerView()
  const setPanel = useGame((s) => s.setPanel)
  // Seven branches stacked are nineteen screens on a phone: a filter shows one branch, or only the next step in each branch.
  const [show, setShow] = useState<'all' | 'ready' | TechBranch>('all')
  if (!view) return null
  const { player, committed, econ, orders } = view
  // The next step in each branch: not yours yet, and everything it needs is yours (or queued). Affordable or not, so the list is
  // never empty just because research is short this month; each card says what it costs and whether you can pay now.
  const queued = orders.flatMap((o) => (o.type === 'research' ? [o.techId] : []))
  const ready = (t: Tech) => !player.techs.includes(t.id) && t.requires.every((r) => player.techs.includes(r) || queued.includes(r))
  const branches = show === 'all' || show === 'ready' ? BRANCHES : BRANCHES.filter((b) => b === show)
  const filters: ['all' | 'ready' | TechBranch, string][] = [['all', 'All'], ['ready', `Next steps (${TECHS.filter(ready).length})`], ...BRANCHES.map((b) => [b, BRANCH_LABELS[b]] as [TechBranch, string])]
  return (
    <div data-section="tech" aria-label="Research" className="drawer drawer-wide surface">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-none">
        <div>
          <h2 className="text-[28px] font-semibold tracking-tight">Research</h2>
          <p className="text-[13px] text-white/55 mt-0.5">Click a technology to queue it. It finishes when the month ends.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="label">Available</div>
            <div className="text-[22px] font-semibold tabular-nums">{fmt(player.resources.tp - committed.tp)}</div>
            <div className="text-[12px] text-white/60 tabular-nums">{signed(econ.tpGain)} a month</div>
          </div>
          <button className="icon-close" aria-label="Close" onClick={() => setPanel('tech')}>
            ×
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin p-6">
        <Bonuses />
        <Programs />
        <div className="flex flex-wrap gap-1.5 mb-4" role="radiogroup" aria-label="Show technologies">
          {filters.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={show === id} className={`btn px-2.5 py-1 text-[13px] ${show === id ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setShow(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className={show === 'all' ? 'tech-grid' : 'tech-grid tech-grid-few'}>
          {branches.map((b) => (show === 'ready' && !TECHS.some((t) => t.branch === b && ready(t)) ? null : (
            <div key={b} className="space-y-3">
              <div className="text-[13px] font-semibold pb-2 border-b border-white/10" style={{ color: BRANCH_COLOR[b] }}>
                {BRANCH_LABELS[b]}
              </div>
              {TECHS.filter((t) => t.branch === b && (show !== 'ready' || ready(t)))
                .sort((x, y) => x.tier - y.tier)
                .map((t, i) => (
                  <div key={t.id} className="relative">
                    {i > 0 && <div className="absolute -top-3 left-1/2 w-px h-3" style={{ background: `${BRANCH_COLOR[b]}88` }} />}
                    <TechNode tech={t} />
                  </div>
                ))}
            </div>
          )))}
        </div>
        <p className="text-[12px] text-white/40 mt-6">Research comes from universities and the people working in your country.</p>
      </div>
    </div>
  )
}
