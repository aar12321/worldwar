import { useMemo } from 'react'
import { SECTORS_ORDER, SECTOR_SPECS, SERVICE } from '../../../data/civics'
import { LEVEL_NAMES, SOCIAL, CAMPAIGNS } from '../../../data/society'
import { SPENDING } from '../../../data/people'
import { employmentOf, professionCoverage } from '../../../engine/civics'
import { jobsParts } from '../../../engine/people'
import type { SocialId } from '../../../engine/types'
import { useGame } from '../../../store'
import { signed, usePlayerView } from '../../hooks'
import { Spark } from '../../Charts'
import { pct } from '../../format'
import { LevelPicker, StackedBar, StatTile, Tiles } from '../../kit'
import { Card, Line } from '../parts'
import { millions } from './words'

const JOB_PROGRAMS: SocialId[] = ['jobsGuarantee', 'apprenticeships', 'smallLoans', 'minimumWage']

/** The jobs picture: the labour force, who works where, why people are out of work, the civil service and job programs, and history. */
export function JobsSection() {
  const { player, econ } = usePlayerView()!
  const job = employmentOf(player, econ)
  const parts = jobsParts(player, econ.basis)
  const target = parts.reduce((a, p) => a + p.value, 0)
  return (
    <>
      <Tiles compact>
        <StatTile label="Labour force" value={millions(job.force)} sub={`of ${millions(econ.population)} people`} />
        <StatTile label="Employed" value={millions(job.employed)} sub={pct(1 - job.rate, 1)} />
        <StatTile label="Unemployed" value={pct(job.rate, 1)} tone={job.rate > 0.1 ? 'bad' : job.rate > 0.07 ? 'warn' : 'good'} sub={`${millions(job.unemployed)} · heading for ${pct(Math.max(0.01, target), 1)}`} />
        <StatTile label="Public sector" value={millions(job.sectors.public)} sub={`civil service: ${SERVICE.levels[player.civics?.service ?? SERVICE.standard]}`} />
      </Tiles>
      <Card title="Who works where" hint="Employed people by sector. Farming falls as the land develops, factories add industrial jobs, the civil service sets the public sector.">
        <StackedBar label="Jobs by sector" parts={SECTORS_ORDER.map((k) => ({ key: k, value: job.employed > 0 ? job.sectors[k] / job.employed : 0, color: SECTOR_SPECS[k].color, name: SECTOR_SPECS[k].name }))} />
        <div className="text-[14px] space-y-1">
          {SECTORS_ORDER.map((k) => (
            <Line key={k} k={SECTOR_SPECS[k].name} v={millions(job.sectors[k])} />
          ))}
        </div>
      </Card>
      <Card title="Why people are out of work" hint="Unemployment moves a quarter of the way to where these causes lead each month. Only people with jobs pay tax; over 6% out of work costs stability and migrants leave.">
        <div className="text-[14px] space-y-1">
          {parts.filter((p) => Math.abs(p.value) >= 0.0005).map((p) => (
            <Line key={p.label} k={p.label} v={`${p.value >= 0 ? '+' : ''}${(p.value * 100).toFixed(1)} pts`} warn={p.value > 0 && p.label !== 'Normal turnover'} />
          ))}
          <Line k="Heading for" v={pct(Math.max(0.01, target), 1)} strong />
        </div>
      </Card>
      <ServiceCard />
      <ProgramsCard />
      <JobsHistory />
    </>
  )
}

function ServiceCard() {
  const { player, econ } = usePlayerView()!
  const lvl = player.civics?.service ?? SERVICE.standard
  const issueOrder = useGame((s) => s.issueOrder)
  const adminCov = Math.min(1, professionCoverage(player).administrators)
  return (
    <Card title="Civil service" hint="Public-sector jobs. A bigger state hires the jobless, runs more countries and serves people better, but costs money and crowds out private business. Its services need administrators (see Talent).">
      <LevelPicker label="Civil service size" levels={SERVICE.levels} value={lvl} onChange={(v) => issueOrder({ type: 'civics', nationId: player.id, action: { kind: 'service', level: v } })} />
      <div className="text-[14px] space-y-1">
        <Line k="Public-sector jobs" v={`${Math.round(SERVICE.share[lvl] * 100)}% of the labour force`} />
        <Line k="Money a month, against standard" v={signed(-SERVICE.cost[lvl] * econ.workforce, 2)} warn={SERVICE.cost[lvl] > 0} />
        <Line k="Unemployment" v={`${SERVICE.jobs[lvl] >= 0 ? '+' : ''}${(SERVICE.jobs[lvl] * 100).toFixed(1)} pts`} warn={SERVICE.jobs[lvl] > 0} />
        <Line k="Output" v={`${SERVICE.output[lvl] >= 0 ? '+' : ''}${(SERVICE.output[lvl] * 100).toFixed(1)}%`} warn={SERVICE.output[lvl] < 0} />
        <Line k="Officials can run" v={`${SERVICE.admin[lvl] >= 0 ? '+' : ''}${(SERVICE.admin[lvl] * (SERVICE.admin[lvl] > 0 ? adminCov : 1)).toFixed(1)} countries`} warn={SERVICE.admin[lvl] < 0} />
        <Line k="Stability from services" v={`${SERVICE.stability[lvl] >= 0 ? '+' : ''}${(SERVICE.stability[lvl] * (SERVICE.stability[lvl] > 0 ? adminCov : 1)).toFixed(1)}`} warn={SERVICE.stability[lvl] < 0} />
      </div>
      {adminCov < 1 && <p className="text-[13px] text-[#ffb340]">Administrators are short: the services deliver {Math.round(adminCov * 100)}%.</p>}
    </Card>
  )
}

function ProgramsCard() {
  const { player } = usePlayerView()!
  const openTab = useGame((s) => s.openTab)
  const setPeopleSection = useGame((s) => s.setPeopleSection)
  const jobless = player.spending?.jobless ?? 1
  const fair = player.campaigns?.jobFair
  return (
    <Card
      title="Job programs"
      hint="Public jobs, apprenticeships, small-business loans and the minimum wage are programs for the people; they phase in over months. Generous jobless support also retrains."
      right={
        <button
          className="btn btn-quiet shrink-0"
          onClick={() => {
            setPeopleSection('work')
            openTab('economy', 'people')
          }}
        >
          Open Work programs
        </button>
      }
    >
      <div className="text-[14px] space-y-1">
        {JOB_PROGRAMS.map((id) => {
          const st = player.social?.[id]
          const jobs = SOCIAL[id].effects.jobs ?? 0
          return <Line key={id} k={`${SOCIAL[id].name} (${LEVEL_NAMES[st?.level ?? 0]})`} v={`${jobs >= 0 ? '+' : ''}${(jobs * 100).toFixed(1)} pts per level${st && st.strength > 0 ? ' · in force' : ''}`} warn={jobs > 0} />
        })}
        <Line k={`Jobless support (${SPENDING.jobless.levels[jobless]})`} v={jobless >= 2 ? 'retraining: -1.2 pts' : 'no retraining'} />
        <Line k={CAMPAIGNS.jobFair.name} v={fair && fair.left > 0 ? `running, ${fair.left} months left` : 'not running'} />
      </div>
    </Card>
  )
}

/** The jobs picture month by month: unemployment, the labour force and the public sector, and a stacked chart of the sectors. */
function JobsHistory() {
  const { player } = usePlayerView()!
  const saved = player.civics?.history
  const hist = useMemo(() => saved ?? [], [saved])
  const sectorsChart = useMemo(() => stackPaths(hist.map((h) => h.sectors)), [hist])
  return (
    <section className="span-all space-y-2.5">
      <h3 className="text-[16px] font-semibold">Jobs over time</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <Spark label="Unemployment" values={hist.map((h) => h.unemployment * 100)} color="#ff453a" format={(v) => `${v.toFixed(1)}%`} invert />
        <Spark label="Labour force" values={hist.map((h) => h.force)} color="#0a84ff" format={(v) => millions(v)} />
        <Spark label="Public sector" values={hist.map((h) => h.sectors[3])} color="#64d2ff" format={(v) => millions(v)} />
      </div>
      <figure className="inset-card p-3 space-y-2" aria-label="Employed people by sector over time">
        <figcaption className="text-[13px] text-white/75">Employed by sector, month by month</figcaption>
        {hist.length > 1 ? (
          <svg viewBox="0 0 240 80" className="w-full h-28" preserveAspectRatio="none" role="img" aria-label={`Jobs by sector over ${hist.length} months`}>
            {sectorsChart.map((d, i) => (
              <path key={SECTORS_ORDER[i]} d={d} fill={SECTOR_SPECS[SECTORS_ORDER[i]].color} opacity={0.75} />
            ))}
          </svg>
        ) : (
          <div className="h-20 grid place-items-center text-[12px] text-white/50">The chart starts after the first month.</div>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-white/75">
          {SECTORS_ORDER.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: SECTOR_SPECS[k].color }} />
              {SECTOR_SPECS[k].name}
            </span>
          ))}
        </div>
      </figure>
    </section>
  )
}

/** Stacked area paths, bottom sector first, scaled to the largest total. */
function stackPaths(rows: number[][]): string[] {
  if (rows.length < 2) return []
  const w = 240
  const h = 80
  const max = Math.max(...rows.map((r) => r.reduce((a, b) => a + b, 0))) || 1
  const k = rows[0].length
  const base = rows.map(() => 0)
  const out: string[] = []
  for (let j = 0; j < k; j++) {
    const lower = [...base]
    for (let i = 0; i < rows.length; i++) base[i] += rows[i][j]
    const x = (i: number) => ((i / (rows.length - 1)) * w).toFixed(1)
    const y = (v: number) => (h - (v / max) * (h - 2)).toFixed(1)
    const top = rows.map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(base[i])}`).join(' ')
    const bottom = rows.map((_, i) => `L${x(rows.length - 1 - i)},${y(lower[rows.length - 1 - i])}`).join(' ')
    out.push(`${top} ${bottom} Z`)
  }
  return out
}
