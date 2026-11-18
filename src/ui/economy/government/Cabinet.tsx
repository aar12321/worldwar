import { useState } from 'react'
import { CABINET, IDEOLOGY_SPECS, MINISTRIES, MINISTRY_SPECS, PROFESSION_SPECS, type Minister, type MinistryId } from '../../../data/civics'
import { candidatesFor, dismissCost, ministerPower, monthsToNewCandidates, professionCoverage, salaryOf } from '../../../engine/civics'
import { usePlayerView } from '../../hooks'
import { Bar } from '../../kit'
import { OrderButton } from '../../panel'
import { Card } from '../parts'
import { effectWords, groupWords } from './words'

const TRAITS: { key: 'competence' | 'loyalty' | 'corruption' | 'popularity'; name: string; good: boolean; color: string }[] = [
  { key: 'competence', name: 'Competence', good: true, color: '#0a84ff' },
  { key: 'loyalty', name: 'Loyalty', good: true, color: '#30d158' },
  { key: 'popularity', name: 'Popularity', good: true, color: '#ffd60a' },
  { key: 'corruption', name: 'Corruption', good: false, color: '#ff453a' },
]

function Traits({ m }: { m: Minister }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {TRAITS.map((t) => (
        <div key={t.key} className="min-w-0">
          <div className="flex justify-between text-[12px] text-white/70">
            <span>{t.name}</span>
            <span className={`tabular-nums ${!t.good && m[t.key] >= 40 ? 'text-[#ff8a84]' : ''}`}>{Math.round(m[t.key])}</span>
          </div>
          <Bar value={m[t.key] / 100} color={t.color} label={`${t.name} ${Math.round(m[t.key])}`} />
        </div>
      ))}
    </div>
  )
}

function IdeologyChip({ m }: { m: Minister }) {
  const spec = IDEOLOGY_SPECS[m.ideology]
  const reactions = groupWords(spec.groups)
  return (
    <span className="chip" title={`${spec.blurb} ${reactions.map((r) => r.text).join(', ')}`}>
      {spec.name}
    </span>
  )
}

/** The nine ministries: who holds each, what they deliver and cost, and who could replace them. */
export function CabinetSection() {
  const { game, player } = usePlayerView()!
  const filled = MINISTRIES.filter((id) => player.civics?.cabinet[id]).length
  return (
    <>
      <Card
        title="The cabinet"
        hint={`Ministers deliver their ministry's effect by competence, as far as their profession is staffed (see Talent). Each draws a salary and wastes money by corruption; a corrupt one may cause a scandal, a disloyal one may resign. New candidates in ${monthsToNewCandidates(game.turn)} months.`}
        right={<span className="chip shrink-0">{filled} of {MINISTRIES.length} filled</span>}
      />
      {MINISTRIES.map((id) => (
        <MinistryCard key={id} ministry={id} />
      ))}
    </>
  )
}

function MinistryCard({ ministry }: { ministry: MinistryId }) {
  const { game, player, econ } = usePlayerView()!
  const [open, setOpen] = useState(false)
  const spec = MINISTRY_SPECS[ministry]
  const m = player.civics?.cabinet[ministry]
  const cov = professionCoverage(player)
  const staffed = Math.min(1, cov[spec.profession])
  const vacant = (player.civics?.vacantUntil[ministry] ?? -1) > game.turn
  const showCandidates = !m || open
  return (
    <section className="inset-card p-3.5 space-y-2.5" aria-label={spec.title}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label">{spec.name}</div>
          <h3 className="text-[16px] font-semibold tracking-tight truncate">{m ? m.name : 'Vacant'}</h3>
          <p className="text-[13px] text-white/70">{spec.blurb}</p>
        </div>
        {m && <IdeologyChip m={m} />}
      </div>
      {m ? (
        <>
          <Traits m={m} />
          <div className="text-[13px] text-white/80">
            Delivers {Math.round(ministerPower(player, m) * 100)}%: {effectWords(spec.effects, ministerPower(player, m)).join(', ') || 'little yet'}.
            {m.corruption >= 1 && <span className="text-white/60"> Corruption wastes {((m.corruption / 100) * CABINET.wastePerCorruption * 100).toFixed(1)}% of income.</span>}
            {staffed < 1 && <span className="text-[#ffb340]"> {PROFESSION_SPECS[spec.profession].name} are short ({Math.round(staffed * 100)}%).</span>}
          </div>
          <div className="text-[12px] text-white/60 tabular-nums">
            Salary {salaryOf(m, econ.population).toFixed(2)} a month · in office {Math.max(0, game.turn - m.since)} months
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide candidates' : 'Replace'}
            </button>
            <OrderButton order={{ type: 'civics', nationId: player.id, action: { kind: 'dismiss', ministry } }} label="Dismiss" effect={`Stability -${dismissCost(m).toFixed(1)}; the ministry stays empty a month`} />
          </div>
        </>
      ) : (
        <p className="text-[13px] text-white/60">{vacant ? 'Being reorganized: a new minister can be appointed next month.' : 'Nobody runs it: no effect, no salary.'}</p>
      )}
      {showCandidates && !vacant && (
        <div className="grid gap-2 sm:grid-cols-3">
          {candidatesFor(game, player, ministry).map((c) => (
            <Candidate key={c.id} c={c} current={m} />
          ))}
        </div>
      )}
    </section>
  )
}

function Candidate({ c, current }: { c: Minister; current?: Minister }) {
  const { player, econ } = usePlayerView()!
  const spec = MINISTRY_SPECS[c.ministry]
  const power = ministerPower(player, c)
  const salary = salaryOf(c, econ.population)
  const fee = Math.round(salary * CABINET.signing * 10) / 10
  const serving = current?.id === c.id
  return (
    <div className="rounded-xl bg-white/5 p-3 space-y-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[14px] font-semibold truncate">{c.name}</div>
        <IdeologyChip m={c} />
      </div>
      <Traits m={c} />
      <div className="text-[12px] text-white/75">{effectWords(spec.effects, power).join(', ')}</div>
      <div className="text-[12px] text-white/60 tabular-nums">Salary {salary.toFixed(2)} a month</div>
      {serving ? (
        <span className="chip">Serving</span>
      ) : (
        <OrderButton
          order={{ type: 'civics', nationId: player.id, action: { kind: 'appoint', ministry: c.ministry, candidate: c.id } }}
          label={current ? 'Appoint instead' : 'Appoint'}
          cost={`${fee} money`}
          effect={current ? `Replaces ${current.name}: stability -${dismissCost(current).toFixed(1)}` : `${CABINET.signing} months' salary up front`}
          tone="btn-primary"
          className="w-full"
        />
      )}
    </div>
  )
}
