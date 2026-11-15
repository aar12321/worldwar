import { tierOf } from '../../engine/empire'
import { FOCUSES, IMMIGRATION, PEOPLE, SKILL_LABELS, SPENDING, STAGES } from '../../data/people'
import { enemiesOf } from '../../engine/helpers'
import { lifeExpectancy, schoolingTarget, spendingBill } from '../../engine/people'
import type { ImmigrationPolicy, SchoolFocus, SchoolStage, SkillKey, SpendingKey } from '../../engine/types'
import { SKILL_KEYS } from '../../engine/types'
import { useGame } from '../../store'
import { fmt, signed, usePlayerView } from '../hooks'
import { Bar, CoverageChip, LevelPicker, Pending, StackedBar, StatTile, Tiles } from '../kit'
import { pct } from '../format'
import { Card, Line } from './parts'

const SKILL_COLORS: Record<SkillKey, string> = { basic: '#8e8e93', skilled: '#0a84ff', engineers: '#ff9f0a', doctors: '#30d158', scientists: '#bf5af2' }

/** Months until schooling closes most of its gap, for the projection line. */
function projection(now: number, target: number): string {
  if (Math.abs(target - now) < 0.01) return `steady at ${pct(now)}`
  const months = Math.ceil(Math.log(0.25) / Math.log(1 - PEOPLE.schoolingRate))
  const after = now + (target - now) * 0.75
  return `${pct(now)} → ${pct(after)} in about ${Math.round(months / 12)} years (heading for ${pct(target)})`
}

/** Who the people are, what they know, how healthy they are, and how the state looks after them. */
export function PeopleTab() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const setPrograms = useGame((s) => s.setPrograms)
  const { player, econ } = view
  const p = player.people
  const sp = view.pendingPolicy.spending
  const prog = view.pendingPrograms
  const spec = tierOf(player)
  const bill = spendingBill({ ...player, spending: sp, programs: prog }, econ.workforce, econ.basis.buildings * 0.15)
  const pick = (k: SpendingKey) => (v: number) => setPolicy({ spending: { [k]: v } })
  const changed = (k: SpendingKey) => sp[k] !== player.spending[k]
  const target = schoolingTarget({ ...player, spending: sp, programs: prog }, econ.basis.development)
  const focusSkill = FOCUSES[prog.focus].skill
  const pop = econ.population

  return (
    <section className="econ-grid">
      <Tiles>
        <StatTile label="Population" value={fmt(pop, 1)} sub={p.migration !== 0 ? `${p.migration > 0 ? '+' : ''}${(p.migration * 100).toFixed(2)}% from migration` : 'no migration'} />
        <StatTile label="Life expectancy" value={`${Math.round(lifeExpectancy(p.health))} years`} sub={`health ${pct(p.health)}`} tone={p.health < 0.45 ? 'bad' : undefined} />
        <StatTile label="Schooling" value={pct(p.schooling)} sub={`heading for ${pct(target)}`} />
        <StatTile label="Out of work" value={pct(p.unemployment, 1)} tone={p.unemployment > 0.1 ? 'bad' : p.unemployment > 0.07 ? 'warn' : undefined} sub="only workers pay tax" />
        <StatTile label="Epidemic" value={p.epidemic > 0 ? pct(p.epidemic) : 'None'} tone={p.epidemic > 0 ? 'bad' : 'good'} sub={p.epidemic > 0 ? 'severity' : 'all clear'} />
        <StatTile label="Stability" value={`${Math.round(player.stability)}%`} sub={`heading for ${Math.round(econ.stabilityTarget)}%`} tone={player.stability < 35 ? 'bad' : undefined} />
      </Tiles>

      <Card title="Who works" hint="The schools decide the mix. Factories need engineers, universities need scientists, hospitals need doctors.">
        <StackedBar label="Workforce by skill" parts={SKILL_KEYS.map((k) => ({ key: k, value: p.skills[k], color: SKILL_COLORS[k], name: SKILL_LABELS[k] }))} />
        <div className="flex flex-wrap gap-1.5">
          <CoverageChip label="Engineers" value={econ.coverage.engineers} />
          <CoverageChip label="Scientists" value={econ.coverage.scientists} />
          <CoverageChip label="Doctors" value={econ.coverage.doctors} />
          <CoverageChip label="Skilled" value={econ.coverage.skilled} />
        </div>
        <div className="text-[14px] space-y-1">
          <Line k="Factories run at" v={pct(econ.factoryStaff)} warn={econ.factoryStaff < 1} />
          <Line k="Universities run at" v={pct(econ.researchStaff)} warn={econ.researchStaff < 1} />
        </div>
        {econ.coverage.engineers < 0.95 && <p className="text-[13px] text-[#ffb340]">Short of engineers: train more with an Engineering focus, or build fewer factories for now.</p>}
      </Card>

      <Card title="Schools" hint="Spending sets how fast people learn; the stage sets how far they can go." right={<Pending show={changed('schools') || prog.stage !== player.programs.stage || prog.focus !== player.programs.focus} />}>
        <div className="text-[13px] text-white/70">Spending · {signed(-bill.schools)} a month</div>
        <LevelPicker label="School spending" levels={SPENDING.schools.levels} value={sp.schools} onChange={pick('schools')} />
        <div className="text-[13px] text-white/70 mt-1">Stage</div>
        <LevelPicker
          label="School stage"
          levels={(Object.keys(STAGES) as SchoolStage[]).map((k) => STAGES[k].name)}
          value={(Object.keys(STAGES) as SchoolStage[]).indexOf(prog.stage)}
          onChange={(i) => setPrograms({ stage: (Object.keys(STAGES) as SchoolStage[])[i] })}
          disabled={(i) => (i === 2 && econ.buildings.university === 0 ? 'Build a university first' : null)}
        />
        <p className="text-[13px] text-white/70">{STAGES[prog.stage].blurb}</p>
        <div className="text-[13px] text-white/70 mt-1">Focus</div>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(FOCUSES) as SchoolFocus[]).map((f) => (
            <button key={f} className={`btn text-left px-2.5 py-2 text-[13px] ${prog.focus === f ? 'btn-primary' : 'btn-quiet'}`} aria-pressed={prog.focus === f} onClick={() => setPrograms({ focus: f })} title={FOCUSES[f].blurb}>
              {FOCUSES[f].name}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-white/70">{FOCUSES[prog.focus].blurb}</p>
        {focusSkill && (
          <div className="space-y-1">
            <div className="flex justify-between text-[13px]">
              <span>Specialization</span>
              <span className="tabular-nums">
                {pct(p.specialization)} of {pct(spec.specializationCap)} allowed
              </span>
            </div>
            <Bar value={p.specialization / Math.max(0.01, spec.specializationCap)} color={SKILL_COLORS[focusSkill]} label="Specialization" />
            <p className="text-[12px] text-white/60">Builds over two years (one with a Science Park). Changing the focus starts again. A bigger empire can specialize further.</p>
          </div>
        )}
        <p className="text-[13px]">Schooling: {projection(p.schooling, target)}</p>
      </Card>

      <Card title="Health" hint="Healthy people live longer, have more children, fight better and riot less." right={<Pending show={changed('health') || prog.quarantine !== player.programs.quarantine} />}>
        <div className="text-[13px] text-white/70">Spending · {signed(-bill.health)} a month</div>
        <LevelPicker label="Health spending" levels={SPENDING.health.levels} value={sp.health} onChange={pick('health')} />
        <div className="text-[14px] space-y-1">
          <Line k="Hospitals" v={`${econ.buildings.hospital} (${econ.coverage.doctors >= 1 ? 'fully staffed' : `${pct(Math.min(1, econ.coverage.doctors))} staffed`})`} warn={econ.buildings.hospital > 0 && econ.coverage.doctors < 1} />
          <Line k="Life expectancy" v={`${Math.round(lifeExpectancy(p.health))} years`} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-2.5">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold">Quarantine</div>
            <div className="text-[12px] text-white/65">Stops an epidemic spreading and ends it sooner. Costs {Math.round(econ.workforce * 0.02 * 10) / 10} money and 5% of output a month.</div>
          </div>
          <button className={`btn shrink-0 ${prog.quarantine ? 'btn-red' : ''}`} aria-pressed={prog.quarantine} onClick={() => setPrograms({ quarantine: !prog.quarantine })}>
            {prog.quarantine ? 'Lift' : 'Impose'}
          </button>
        </div>
        {p.epidemic > 0 && <p className="text-[13px] text-[#ff8a84]">An epidemic is costing lives, output and calm. Doctors, health spending and a quarantine end it sooner.</p>}
      </Card>

      <Card title="Welfare" hint="Care for the old, the jobless and families. Each costs money every month." right={<Pending show={changed('pensions') || changed('jobless') || changed('housing')} />}>
        {(['pensions', 'jobless', 'housing'] as const).map((k) => (
          <div key={k} className="space-y-1">
            <div className="flex justify-between text-[14px]">
              <span className="font-semibold">{SPENDING[k].name}</span>
              <span className="tabular-nums text-white/70">{signed(-bill[k])} a month</span>
            </div>
            <LevelPicker label={SPENDING[k].name} levels={SPENDING[k].levels} value={sp[k]} onChange={pick(k)} />
            <p className="text-[12px] text-white/65">{SPENDING[k].blurb}</p>
          </div>
        ))}
      </Card>

      <Card title="Immigration" hint="People move toward a better life. Your policy decides who may come." right={<Pending show={prog.immigration !== player.programs.immigration} />}>
        <LevelPicker
          label="Immigration policy"
          levels={(Object.keys(IMMIGRATION) as ImmigrationPolicy[]).map((k) => IMMIGRATION[k].name)}
          value={(Object.keys(IMMIGRATION) as ImmigrationPolicy[]).indexOf(prog.immigration)}
          onChange={(i) => setPrograms({ immigration: (Object.keys(IMMIGRATION) as ImmigrationPolicy[])[i] })}
          disabled={(i) => (i === 2 && !spec.selectiveImmigration ? 'Needs a Regional power (4 countries)' : null)}
        />
        <p className="text-[13px] text-white/70">{IMMIGRATION[prog.immigration].blurb}</p>
        <p className="text-[13px]">
          Last month {p.migration >= 0 ? `${(p.migration * 100).toFixed(2)}% of your population moved in` : `${(-p.migration * 100).toFixed(2)}% of your people left`}.
        </p>
      </Card>

      <Mood />
    </section>
  )
}

/** The people's needs, one compact gauge each. */
function Mood() {
  const view = usePlayerView()!
  const { game, player, econ } = view
  const gauges = [
    { label: 'Food', value: econ.foodConsumption > 0 ? (econ.foodProduction / econ.foodConsumption) * 80 : 100, status: player.foodShortage ? 'Starving' : econ.netFood < 0 ? 'Running down' : 'Fed' },
    { label: 'Goods', value: econ.goodsUse > 0 ? (econ.goodsProduction / econ.goodsUse) * 80 : 100, status: player.goodsShortage ? 'Sold out' : econ.netGoods < 0 ? 'Running down' : 'Well supplied' },
    { label: 'Work', value: econ.laborRatio * 100, status: `${Math.round(econ.laborRatio * 100)}% of jobs filled` },
    { label: 'Taxes', value: 100 - view.pendingPolicy.taxRate * 250, status: `${Math.round(view.pendingPolicy.taxRate * 100)}% tax` },
    { label: 'Peace', value: 100 - (player.warWeariness / 60) * 100, status: player.warWeariness > 25 ? 'War-weary' : player.warWeariness > 8 ? 'Tired of war' : enemiesOf(game, player.id).length ? 'At war' : 'Calm' },
    { label: 'Prices', value: 100 - Math.max(0, player.bank.inflation - 2) * 6, status: `${player.bank.inflation.toFixed(1)}% inflation` },
  ]
  return (
    <Card title="What the people feel" hint="When their needs go unmet, they work less and fight less, and in the end they rise up.">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {gauges.map((g) => (
          <div key={g.label} className="space-y-1">
            <div className="flex justify-between text-[13px]">
              <span className="font-semibold">{g.label}</span>
              <span className="text-white/70 truncate ml-2">{g.status}</span>
            </div>
            <Bar value={g.value / 100} color={g.value < 35 ? '#ff453a' : g.value < 60 ? '#ffd60a' : '#30d158'} label={g.label} />
          </div>
        ))}
      </div>
    </Card>
  )
}
