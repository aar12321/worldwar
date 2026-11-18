import { useState } from 'react'
import { PROFESSION_SPECS, TALENT } from '../../../data/civics'
import { talentMult, talentReport, type TalentRow } from '../../../engine/civics'
import { usePlayerView } from '../../hooks'
import { Bar, CoverageChip, StatTile, Tiles } from '../../kit'
import { Card } from '../parts'
import { people } from './words'

/** The nation's talent by profession, who is using it, and where it is short. */
export function TalentSection() {
  const { player, econ } = usePlayerView()!
  const rows = talentReport(player, econ)
  const short = rows.filter((r) => r.coverage < 1)
  const mult = talentMult(player)
  const drain = player.civics?.drain ?? 0
  return (
    <>
      <Tiles compact>
        <StatTile label="Professionals" value={people(rows.reduce((a, r) => a + r.pool, 0))} sub={`of ${people(econ.population * TALENT.participation * 1000)} workers`} />
        <StatTile label="Short of staff" value={short.length ? `${short.length} ${short.length === 1 ? 'kind' : 'kinds'}` : 'None'} tone={short.length ? (short.some((r) => r.coverage < 0.8) ? 'bad' : 'warn') : 'good'} sub={short.map((r) => PROFESSION_SPECS[r.profession].name).join(', ') || 'every kind of work staffed'} />
        <StatTile label="Talent" value={`${Math.round(mult * 100)}%`} tone={mult < 0.95 ? 'warn' : mult > 1.02 ? 'good' : undefined} sub={drain > 0 ? `brain drain -${Math.round(drain * 100)}%` : mult > 1 ? 'talent visas' : 'no drain'} />
      </Tiles>
      <Card
        title="Talent pool and demand"
        hint="Professionals come from schooling, universities and a focus (People tab), and leave when life is better abroad. Space, missiles, industry, agencies, the civil service and ministries all compete for them. Tap a row to see who uses it."
      >
        <div className="space-y-1">
          {rows.map((r) => (
            <TalentLine key={r.profession} r={r} />
          ))}
        </div>
      </Card>
    </>
  )
}

function TalentLine({ r }: { r: TalentRow }) {
  const [open, setOpen] = useState(false)
  const spec = PROFESSION_SPECS[r.profession]
  const use = r.demand > 0 ? Math.min(1, r.demand / Math.max(1e-9, r.pool)) : 0
  return (
    <div className="rounded-xl bg-white/5">
      <button className="w-full text-left p-2.5 space-y-1.5 min-h-[44px]" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[15px] font-semibold inline-flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: spec.color }} />
            <span className="truncate">{spec.name}</span>
          </span>
          <CoverageChip label="Staffed" value={r.coverage} />
        </div>
        <div className="flex justify-between text-[12px] text-white/70 tabular-nums">
          <span>{people(r.pool)} available</span>
          <span>{people(r.demand)} wanted</span>
        </div>
        <Bar value={use} color={r.coverage >= 1 ? spec.color : '#ff453a'} label={`${spec.name}: ${Math.round(use * 100)}% in use`} />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-1 text-[13px]">
          <p className="text-white/70">{spec.blurb}</p>
          {r.users.length ? (
            r.users.map((u) => (
              <div key={u.label} className="flex justify-between gap-3">
                <span className="text-white/75">{u.label}</span>
                <span className="tabular-nums">
                  {people(u.amount)} <span className="text-white/50">({Math.round((u.amount / Math.max(1e-9, r.demand)) * 100)}%)</span>
                </span>
              </div>
            ))
          ) : (
            <p className="text-white/60">Nobody needs them yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
