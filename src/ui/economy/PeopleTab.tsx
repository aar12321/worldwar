import { FOCUSES, IMMIGRATION, PEOPLE, SKILL_LABELS, SPENDING, STAGES } from '../../data/people'
import { CAMPAIGN_IDS, SOCIAL, SOCIAL_BY_GROUP, SOCIAL_GROUPS, type SocialGroup } from '../../data/society'
import { tierOf } from '../../engine/empire'
import { enemiesOf } from '../../engine/helpers'
import { lifeExpectancy, schoolingTarget } from '../../engine/people'
import type { ImmigrationPolicy, SchoolFocus, SchoolStage, SkillKey, SpendingKey } from '../../engine/types'
import { SKILL_KEYS } from '../../engine/types'
import { useGame, type PeopleSection } from '../../store'
import { fmt, signed, usePlayerView } from '../hooks'
import { Bar, LevelPicker, Pending, StackedBar, StatTile, Tiles } from '../kit'
import { pct } from '../format'
import { Tabs } from '../panel'
import { Card, Line } from './parts'
import { CampaignCard, PolicyCard } from './people/PolicyCard'
import { StabilityWhy } from './people/StabilityWhy'
import { openGovernment } from './government/section'

const SKILL_COLORS: Record<SkillKey, string> = { basic: '#8e8e93', skilled: '#0a84ff', engineers: '#ff9f0a', doctors: '#30d158', scientists: '#bf5af2' }
const GROUP_COLORS: Record<SocialGroup, string> = { health: '#30d158', learning: '#bf5af2', work: '#ff9f0a', family: '#ff6482', safety: '#0a84ff' }

const SECTIONS: [PeopleSection, string][] = [
  ['overview', 'Overview'],
  ['health', 'Health'],
  ['learning', 'Learning'],
  ['work', 'Work'],
  ['family', 'Family'],
  ['safety', 'Safety'],
  ['campaigns', 'Campaigns'],
]

/** Months until schooling closes most of its gap, for the projection line. */
function projection(now: number, target: number): string {
  if (Math.abs(target - now) < 0.01) return `steady at ${pct(now)}`
  const months = Math.ceil(Math.log(0.25) / Math.log(1 - PEOPLE.schoolingRate))
  const after = now + (target - now) * 0.75
  return `${pct(now)} → ${pct(after)} in about ${Math.round(months / 12)} years (heading for ${pct(target)})`
}

/** Who the people are, what they know, how healthy they are, and everything the state does to look after them. */
export function PeopleTab() {
  const view = usePlayerView()!
  const section = useGame((s) => s.peopleSection)
  const setSection = useGame((s) => s.setPeopleSection)
  const { player, econ } = view
  const p = player.people
  const care = econ.spending.people + econ.society.bill
  const inForce = Object.values(player.social ?? {}).filter((x) => x && x.level > 0).length

  return (
    <section className="econ-grid">
      <Tiles compact>
        <StatTile label="Population" value={fmt(econ.population, 1)} sub={p.migration !== 0 ? `${p.migration > 0 ? '+' : ''}${(p.migration * 100).toFixed(2)}% from migration` : 'no migration'} />
        <StatTile label="Life expectancy" value={`${Math.round(lifeExpectancy(p.health))} years`} sub={`health ${pct(p.health)}`} tone={p.health < 0.45 ? 'bad' : undefined} />
        <StatTile label="Stability" value={`${Math.round(player.stability)}%`} sub={`heading for ${Math.round(econ.stabilityTarget)}%`} tone={player.stability < 35 ? 'bad' : undefined} />
        <StatTile label="Care budget" value={signed(-care)} sub={`a month · ${inForce} running`} />
        <StatTile label="Out of work" value={pct(p.unemployment, 1)} tone={p.unemployment > 0.1 ? 'bad' : p.unemployment > 0.07 ? 'warn' : undefined} sub="only workers pay tax" />
        <StatTile label="Epidemic" value={p.epidemic > 0 ? pct(p.epidemic) : 'None'} tone={p.epidemic > 0 ? 'bad' : 'good'} sub={p.epidemic > 0 ? 'severity' : 'all clear'} />
      </Tiles>

      <div className="span-all">
        <Tabs value={section} onChange={setSection} options={SECTIONS} />
      </div>

      {section === 'overview' && <Overview />}
      {section === 'health' && (
        <>
          <GroupIntro group="health" />
          <HealthCard />
          <Policies group="health" />
        </>
      )}
      {section === 'learning' && (
        <>
          <GroupIntro group="learning" />
          <SchoolsCard />
          <Policies group="learning" />
        </>
      )}
      {section === 'work' && (
        <>
          <GroupIntro group="work" />
          <JoblessCard />
          <Policies group="work" />
        </>
      )}
      {section === 'family' && (
        <>
          <GroupIntro group="family" />
          <FamilyCard />
          <Policies group="family" />
        </>
      )}
      {section === 'safety' && (
        <>
          <GroupIntro group="safety" />
          <SafetyCard />
          <Policies group="safety" />
        </>
      )}
      {section === 'campaigns' && <Campaigns />}
    </section>
  )
}

// ---- Overview ----

function Overview() {
  return (
    <>
      <StabilityWhy />
      <Mood />
      <CareBudget />
      <WhoWorks />
      <ImmigrationCard />
    </>
  )
}

/** Where the money for the people goes, by kind of care. */
function CareBudget() {
  const { econ } = usePlayerView()!
  const sp = econ.spending
  const by = econ.society.byPolicy
  const groupTotal = (g: SocialGroup) => SOCIAL_BY_GROUP(g).reduce((sum, id) => sum + (by[id] ?? 0), 0)
  const rows: { key: SocialGroup; name: string; value: number }[] = [
    { key: 'health', name: 'Health', value: sp.health + groupTotal('health') },
    { key: 'learning', name: 'Learning', value: sp.schools + groupTotal('learning') },
    { key: 'work', name: 'Work', value: sp.jobless + groupTotal('work') },
    { key: 'family', name: 'Family and homes', value: sp.pensions + sp.housing + groupTotal('family') },
    { key: 'safety', name: 'Safety and unity', value: groupTotal('safety') },
  ]
  const total = rows.reduce((a, r) => a + r.value, 0)
  return (
    <Card title="Where the care money goes" hint="Everything the state spends on its people each month, by kind. Public works are in Projects.">
      {total > 0 ? (
        <>
          <StackedBar label="Care budget" parts={rows.filter((r) => r.value > 0).map((r) => ({ key: r.key, value: r.value / total, color: GROUP_COLORS[r.key], name: r.name }))} />
          <div className="text-[14px] space-y-1">
            {rows.map((r) => (
              <Line key={r.key} k={r.name} v={signed(-r.value)} />
            ))}
            <Line k="Total" v={signed(-total)} strong />
          </div>
        </>
      ) : (
        <p className="text-[13px] text-white/65">Nothing is being spent on the people. Start with schools and health, then add programs in the other sections.</p>
      )}
    </Card>
  )
}

function WhoWorks() {
  const { player, econ } = usePlayerView()!
  const p = player.people
  return (
    <Card title="Who works" hint="The schools decide the mix. Factories need engineers, universities need scientists, hospitals need doctors." right={<button className="btn btn-quiet shrink-0" onClick={() => openGovernment('talent')}>Who needs them</button>}>
      <StackedBar label="Workforce by skill" parts={SKILL_KEYS.map((k) => ({ key: k, value: p.skills[k], color: SKILL_COLORS[k], name: SKILL_LABELS[k] }))} />
      <div className="text-[14px] space-y-1">
        <Line k="Factories run at" v={pct(econ.factoryStaff)} warn={econ.factoryStaff < 1} />
        <Line k="Universities run at" v={pct(econ.researchStaff)} warn={econ.researchStaff < 1} />
      </div>
      {econ.coverage.engineers < 0.95 && <p className="text-[13px] text-[#ffb340]">Short of engineers: train more with an Engineering focus (Learning), or build fewer factories for now.</p>}
      <p className="text-[12px] text-white/60">Every profession, how well it is staffed and who uses it (factories, space, missiles, ministries) is in Government, Talent.</p>
    </Card>
  )
}

function ImmigrationCard() {
  const view = usePlayerView()!
  const setPrograms = useGame((s) => s.setPrograms)
  const { player } = view
  const prog = view.pendingPrograms
  const spec = tierOf(player)
  const p = player.people
  return (
    <Card title="Immigration" hint="People move toward a better life. Your policy decides who may come." right={<Pending show={prog.immigration !== player.programs.immigration} />}>
      <LevelPicker
        label="Immigration policy"
        levels={(Object.keys(IMMIGRATION) as ImmigrationPolicy[]).map((k) => IMMIGRATION[k].name)}
        value={(Object.keys(IMMIGRATION) as ImmigrationPolicy[]).indexOf(prog.immigration)}
        onChange={(i) => setPrograms({ immigration: (Object.keys(IMMIGRATION) as ImmigrationPolicy[])[i] })}
        disabled={(i) => (i === 2 && !spec.selectiveImmigration ? 'Needs a Regional power (4 countries)' : null)}
      />
      <p className="text-[13px] text-white/70">{IMMIGRATION[prog.immigration].blurb}</p>
      <p className="text-[13px]">Last month {p.migration >= 0 ? `${(p.migration * 100).toFixed(2)}% of your population moved in` : `${(-p.migration * 100).toFixed(2)}% of your people left`}.</p>
    </Card>
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
    { label: 'Taxes', value: 65 + 2 * econ.stabilityParts.filter((x) => x.label === 'High taxes' || x.label === 'Low taxes').reduce((a, x) => a + x.value, 0), status: `${Math.round(view.pendingPolicy.taxRate * 100)}% tax` },
    { label: 'Peace', value: 100 - (player.warWeariness / 60) * 100, status: player.warWeariness > 25 ? 'War-weary' : player.warWeariness > 8 ? 'Tired of war' : enemiesOf(game, player.id).length ? 'At war' : 'Calm' },
    { label: 'Prices', value: 100 - Math.max(0, player.bank.inflation - 2) * 6, status: `${player.bank.inflation.toFixed(1)}% inflation` },
    { label: 'Health', value: player.people.health * 100, status: `${Math.round(lifeExpectancy(player.people.health))} years of life` },
    { label: 'Safety', value: 100 - Math.min(100, (Object.values(game.regions).filter((r) => r.owner === player.id && r.rebels > 0).length / Math.max(1, Object.values(game.regions).filter((r) => r.owner === player.id).length)) * 160), status: Object.values(game.regions).some((r) => r.owner === player.id && r.rebels > 0) ? 'Rebels about' : 'Quiet' },
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

// ---- Sections ----

/** A short line at the top of each group of programs: what it is for, how many are running and what they cost. */
function GroupIntro({ group }: { group: SocialGroup }) {
  const { player, econ } = usePlayerView()!
  const ids = SOCIAL_BY_GROUP(group)
  const running = ids.filter((id) => (player.social?.[id]?.level ?? 0) > 0).length
  const money = ids.reduce((sum, id) => sum + (econ.society.byPolicy[id] ?? 0), 0)
  return (
    <div className="span-all rounded-xl bg-white/5 px-3.5 py-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold tracking-tight">{SOCIAL_GROUPS[group].name}</div>
        <p className="text-[13px] text-white/70">{SOCIAL_GROUPS[group].blurb}</p>
      </div>
      <div className="text-[13px] text-white/70 tabular-nums whitespace-nowrap">
        {running} of {ids.length} in force · {signed(-money)} a month
      </div>
    </div>
  )
}

function Policies({ group }: { group: SocialGroup }) {
  return (
    <>
      {SOCIAL_BY_GROUP(group).map((id) => (
        <PolicyCard key={id} id={id} />
      ))}
    </>
  )
}

function Campaigns() {
  const { player } = usePlayerView()!
  const running = CAMPAIGN_IDS.filter((id) => (player.campaigns?.[id]?.left ?? 0) > 0).length
  return (
    <>
      <div className="span-all rounded-xl bg-white/5 px-3.5 py-2.5">
        <div className="text-[15px] font-semibold tracking-tight">Campaigns</div>
        <p className="text-[13px] text-white/70">
          A campaign is a one-off bill for a burst of effect that fades. Run one when you need help now: a festival before an election, a vaccination drive in a plague. {running > 0 ? `${running} running.` : 'None running.'}
        </p>
      </div>
      {CAMPAIGN_IDS.map((id) => (
        <CampaignCard key={id} id={id} />
      ))}
    </>
  )
}

function SchoolsCard() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const setPrograms = useGame((s) => s.setPrograms)
  const { player, econ } = view
  const p = player.people
  const sp = view.pendingPolicy.spending
  const prog = view.pendingPrograms
  const spec = tierOf(player)
  const changed = (k: SpendingKey) => sp[k] !== player.spending[k]
  const target = schoolingTarget({ ...player, spending: sp, programs: prog }, econ.basis.development)
  const focusSkill = FOCUSES[prog.focus].skill
  return (
    <Card title="Schools" hint="Spending sets how fast people learn; the stage sets how far they can go." right={<Pending show={changed('schools') || prog.stage !== player.programs.stage || prog.focus !== player.programs.focus} />}>
      <div className="text-[13px] text-white/70">Spending · {signed(-econ.spending.schools)} a month</div>
      <LevelPicker label="School spending" levels={SPENDING.schools.levels} value={sp.schools} onChange={(v) => setPolicy({ spending: { schools: v } })} />
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
  )
}

function HealthCard() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const setPrograms = useGame((s) => s.setPrograms)
  const { player, econ } = view
  const p = player.people
  const sp = view.pendingPolicy.spending
  const prog = view.pendingPrograms
  return (
    <Card title="Hospitals and health spending" hint="Healthy people live longer, have more children, fight better and riot less." right={<Pending show={sp.health !== player.spending.health || prog.quarantine !== player.programs.quarantine} />}>
      <div className="text-[13px] text-white/70">Spending · {signed(-econ.spending.health)} a month</div>
      <LevelPicker label="Health spending" levels={SPENDING.health.levels} value={sp.health} onChange={(v) => setPolicy({ spending: { health: v } })} />
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
      {p.epidemic > 0 && <p className="text-[13px] text-[#ff8a84]">An epidemic is costing lives, output and calm. Doctors, health spending, clean water and a quarantine end it sooner.</p>}
    </Card>
  )
}

/** One of the three welfare lines that were always spending levels: its name, bill, picker and what it does. */
function WelfareLine({ k }: { k: 'pensions' | 'jobless' | 'housing' }) {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const { player, econ } = view
  const sp = view.pendingPolicy.spending
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[14px]">
        <span className="font-semibold">{SPENDING[k].name}</span>
        <span className="tabular-nums text-white/70">
          {signed(-econ.spending[k])} a month {sp[k] !== player.spending[k] && <Pending show />}
        </span>
      </div>
      <LevelPicker label={SPENDING[k].name} levels={SPENDING[k].levels} value={sp[k]} onChange={(v) => setPolicy({ spending: { [k]: v } })} />
      <p className="text-[12px] text-white/65">{SPENDING[k].blurb}</p>
    </div>
  )
}

function JoblessCard() {
  return (
    <Card title="Jobless support" hint="Help for people between jobs. It costs more the more people are out of work.">
      <WelfareLine k="jobless" />
    </Card>
  )
}

function FamilyCard() {
  return (
    <Card title="Pensions and housing" hint="Care for the old and a roof for families. Each costs money every month and buys calm and an easier election.">
      <WelfareLine k="pensions" />
      <WelfareLine k="housing" />
    </Card>
  )
}

function SafetyCard() {
  const openMilitary = useGame((s) => s.openMilitary)
  const { player, game } = usePlayerView()!
  const rebels = Object.values(game.regions).filter((r) => r.owner === player.id && r.rebels > 0).length
  return (
    <Card title="Keeping the peace" hint="Programs below calm a country slowly. For a fire that is burning now, your security service can calm a province at once.">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-2.5">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">Security service</div>
          <div className="text-[12px] text-white/65">{rebels > 0 ? `${rebels} province${rebels === 1 ? ' has' : 's have'} rebels. Calm unrest, sweep out corruption or crush a rising.` : 'No rebels now. It can calm unrest and sweep out corruption.'}</div>
        </div>
        <button className="btn shrink-0" onClick={() => openMilitary('agencies')}>
          Open it
        </button>
      </div>
      <p className="text-[12px] text-white/60">
        {Object.keys(SOCIAL).length} programs in all. Care adds stability with a ceiling: the first programs give the most, and a country cannot be bought out of every trouble.
      </p>
    </Card>
  )
}
