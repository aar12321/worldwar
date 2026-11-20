import { ELECTION, GOVERNMENTS, GOVERNMENT_TYPES, REFORM } from '../../data/government'
import { EMPIRE_RULES } from '../../data/empire'
import { LAW_SPECS } from '../../data/unitTypes'
import { GROUP_SPECS, MINISTRIES, MINISTRY_SPECS, PIPELINE, POLICY_AREAS, POLICY_SPECS, PROFESSION_SPECS, SERVICE } from '../../data/civics'
import { lawConflict, lawSlots, tierOf } from '../../engine/empire'
import { electionNeed } from '../../engine/people'
import { monthsToElection } from '../../engine/politics'
import { civicsEffects, employmentOf, groupReport, passChance, talentReport } from '../../engine/civics'
import type { LawId } from '../../engine/types'
import { usePlayerView } from '../hooks'
import { pct } from '../format'
import { StatTile, Tiles } from '../kit'
import { OrderButton, Tabs } from '../panel'
import { Card, Fold, Line } from './parts'
import { CabinetSection } from './government/Cabinet'
import { GroupsSection } from './government/Groups'
import { JobsSection } from './government/Jobs'
import { PoliciesSection } from './government/Policies'
import { TalentSection } from './government/Talent'
import { millions, people } from './government/words'
import { useGame, type GovSection } from '../../store'

type Section = GovSection

const SECTIONS: [Section, string][] = [
  ['command', 'Overview'],
  ['cabinet', 'Cabinet'],
  ['talent', 'Talent'],
  ['jobs', 'Jobs'],
  ['policies', 'Policies'],
  ['groups', 'Groups'],
  ['constitution', 'Laws'],
]

/**
 * The government as a command view: the cabinet and its candidates, the nation's talent and who uses it, jobs and employment, the
 * policy pipeline, the interest groups, and the form of government with its laws. Every change is an order (`civics`), so it runs the
 * same in a turn game, a live game and online.
 */
export function GovernmentTab() {
  const view = usePlayerView()!
  const { game, player, econ } = view
  const section = useGame((s) => s.govSection)
  const setSection = useGame((s) => s.setGovSection)
  const filled = MINISTRIES.filter((id) => player.civics?.cabinet[id]).length
  const { approval } = groupReport(game, player)
  const job = employmentOf(player, econ)
  const short = talentReport(player, econ).filter((r) => r.coverage < 1).length
  const bills = player.civics?.bills.length ?? 0
  const election = monthsToElection(game, player.id)
  const need = Math.round(electionNeed(player, ELECTION.needed))
  return (
    <section className="econ-grid">
      {/* The summary tiles lead the Overview only: the other sections open with their own figures, so nothing shows twice. */}
      {section === 'command' && (
      <Tiles compact>
        <StatTile label="Approval" value={`${Math.round(approval)}%`} tone={approval < 40 ? 'bad' : approval > 60 ? 'good' : undefined} sub={`stability ${Math.round(player.stability)}%`} />
        <StatTile label="Cabinet" value={`${filled} of ${MINISTRIES.length}`} sub={filled ? 'ministers in office' : 'no ministers yet'} tone={filled === 0 ? 'warn' : undefined} />
        <StatTile label="Unemployment" value={pct(job.rate, 1)} tone={job.rate > 0.1 ? 'bad' : job.rate > 0.07 ? 'warn' : 'good'} sub={`${millions(job.unemployed)} of ${millions(job.force)}`} />
        <StatTile label="Civil service" value={SERVICE.levels[player.civics?.service ?? SERVICE.standard]} sub={`${millions(job.sectors.public)} public jobs`} />
        <StatTile label="Talent short" value={short ? `${short} ${short === 1 ? 'kind' : 'kinds'}` : 'None'} tone={short ? 'warn' : 'good'} sub="see Talent" />
        {election !== null ? (
          <StatTile label="Next election" value={election === 0 ? 'This month' : `${election} mo`} tone={player.stability < need ? 'bad' : 'good'} sub={`needs stability ${need}%, now ${Math.round(player.stability)}%`} />
        ) : (
          <StatTile label="Bills" value={`${bills} of ${PIPELINE.maxBills}`} sub={bills ? 'in the pipeline' : 'nothing drafting'} />
        )}
      </Tiles>
      )}
      <div className="span-all">
        <Tabs value={section} onChange={setSection} options={SECTIONS} label="Government sections" />
      </div>
      {section === 'command' && <CommandSection go={setSection} />}
      {section === 'cabinet' && <CabinetSection />}
      {section === 'talent' && <TalentSection />}
      {section === 'jobs' && <JobsSection />}
      {section === 'policies' && <PoliciesSection />}
      {section === 'groups' && <GroupsSection />}
      {section === 'constitution' && <ConstitutionSection />}
    </section>
  )
}

/** One screen of the whole desk, each card leading to its section. */
function CommandSection({ go }: { go: (s: Section) => void }) {
  const { game, player, econ } = usePlayerView()!
  const c = player.civics
  const rows = talentReport(player, econ)
  const { groups } = groupReport(game, player)
  const eff = civicsEffects(player)
  const desk = econ.stabilityParts.find((p) => p.label === 'Cabinet and reforms')?.value ?? eff.stability
  const election = monthsToElection(game, player.id)
  const salaries = -(econ.lines.find((l) => l.label === 'Cabinet salaries')?.amount ?? 0)
  const open = (s: Section, label: string) => (
    <button className="btn btn-quiet shrink-0" onClick={() => go(s)}>
      {label}
    </button>
  )
  const reforms = POLICY_AREAS.filter((a) => c?.policies[a])
  return (
    <>
      <Card title="Cabinet" hint="Ministers chosen from candidates. Each delivers by competence and costs a salary." right={open('cabinet', 'Hire')}>
        <div className="flex flex-wrap gap-1.5">
          {MINISTRIES.map((id) => {
            const m = c?.cabinet[id]
            return (
              <span key={id} className={`chip ${m ? '' : 'opacity-60'}`} title={m ? `${m.name}, competence ${Math.round(m.competence)}` : 'Vacant'}>
                {MINISTRY_SPECS[id].name}: {m ? (m.name.split(' ')[1] ?? m.name) : 'vacant'}
              </span>
            )
          })}
        </div>
        <div className="text-[13px] text-white/70">
          Stability from the desk {desk >= 0 ? '+' : ''}
          {desk.toFixed(1)}
          {Math.abs(desk - eff.stability) >= 0.05 ? ` (${eff.stability.toFixed(1)} before the ceiling on care)` : ''} · salaries {salaries.toFixed(1)} a month
        </div>
      </Card>
      <Card title="Laws and elections" hint={`${GOVERNMENTS[player.government].name}. ${election !== null ? 'Pensions and housing lower the bar to win an election; unemployment raises it.' : 'It holds no elections.'}`} right={open('constitution', 'Laws')}>
        <div className="text-[14px] space-y-1">
          <Line k="Laws in force" v={`${player.laws.length} of ${lawSlots(player)}`} />
          {player.laws.length > 0 && <p className="text-[13px] text-white/70">{player.laws.map((l) => LAW_SPECS[l].name).join(', ')}</p>}
        </div>
      </Card>
      <Card title="Talent" hint="Professionals, the least staffed first." right={open('talent', 'Details')}>
        <div className="text-[14px] space-y-1">
          {[...rows]
            .sort((a, b) => a.coverage - b.coverage)
            .slice(0, 4)
            .map((r) => (
              <Line key={r.profession} k={PROFESSION_SPECS[r.profession].name} v={`${people(r.pool)} · ${Math.round(r.coverage * 100)}% staffed`} warn={r.coverage < 1} />
            ))}
        </div>
      </Card>
      <Card title="Policies" hint={`Drafting, the vote in ${PIPELINE.body[player.government] ?? 'the council'}, then phasing in.`} right={open('policies', 'Draft')}>
        <div className="text-[14px] space-y-1">
          {(c?.bills ?? []).map((b) => (
            <Line key={b.id} k={`${POLICY_SPECS[b.area].name}: ${POLICY_SPECS[b.area].options[b.option]?.name}`} v={b.stage === 'drafting' ? 'drafting' : `vote, ${Math.round(passChance(game, player, b) * 100)}%`} />
          ))}
          {reforms.map((a) => {
            const p = c!.policies[a]!
            return <Line key={a} k={POLICY_SPECS[a].name} v={`${POLICY_SPECS[a].options[p.option]?.name}${p.phase < 1 ? ` (${Math.round(p.phase * 100)}%)` : ''}`} />
          })}
          {!(c?.bills.length || reforms.length) && <p className="text-white/60">No reforms yet.</p>}
        </div>
      </Card>
      <Card title="Interest groups" hint="Who is pleased and who is not." right={open('groups', 'Details')}>
        <div className="text-[14px] space-y-1">
          {groups.map((g) => (
            <Line key={g.id} k={GROUP_SPECS[g.id].name} v={`${Math.round(g.satisfaction)}%`} warn={g.satisfaction < 40} />
          ))}
        </div>
      </Card>
    </>
  )
}

/** The form of government and the laws. Spending on the people is in the Budget and People tabs. */
function ConstitutionSection() {
  const view = usePlayerView()!
  const { game, player } = view
  const gov = GOVERNMENTS[player.government]
  const election = monthsToElection(game, player.id)
  const need = Math.round(electionNeed(player, ELECTION.needed))
  const slots = lawSlots(player)

  return (
    <>
      <Card title={gov.name} hint={gov.blurb} right={<span className="chip">Your government</span>}>
        {election !== null && (
          <p className="text-[14px]">
            Next election {election === 0 ? 'this month' : `in ${election} ${election === 1 ? 'month' : 'months'}`}. You need stability of at least {need}% to win it (now {Math.round(player.stability)}%). Pensions and housing lower the bar; unemployment raises it.
          </p>
        )}
        <Fold title={`Change the form of government (${GOVERNMENT_TYPES.length - 1} others)`} value={`${REFORM.cost} influence`}>
          <div className="grid gap-2 pt-1">
            {GOVERNMENT_TYPES.filter((g) => g !== player.government).map((g) => (
              <div key={g} className="rounded-xl bg-white/5 p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{GOVERNMENTS[g].name}</div>
                  <div className="text-[13px] text-white/70">{GOVERNMENTS[g].blurb}</div>
                </div>
                <OrderButton
                  order={{ type: 'setGovernment', nationId: player.id, government: g }}
                  label="Change"
                  cost={`${REFORM.cost} influence`}
                  effect={`Stability -${REFORM.turmoil} at once`}
                  className="shrink-0"
                />
              </div>
            ))}
          </div>
        </Fold>
      </Card>

      <div className="space-y-2.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold">Laws</h3>
            <p className="text-[13px] text-white/70">
              A law costs influence to pass and takes effect at once. Each one in force costs {EMPIRE_RULES.lawUpkeep} influence a month to uphold, and repealing costs {EMPIRE_RULES.repealCost}. Some laws cannot stand together.
            </p>
          </div>
          <span className={`chip shrink-0 ${player.laws.length >= slots ? 'text-[#ffd60a]' : ''}`} title={`A ${tierOf(player).name} has room for ${slots} laws. A bigger empire has room for more.`}>
            Laws {player.laws.length} of {slots}
          </span>
        </div>
        {(Object.keys(LAW_SPECS) as LawId[])
          .filter((law) => !LAW_SPECS[law].retired)
          .sort((a, b) => Number(player.laws.includes(b)) - Number(player.laws.includes(a)))
          .map((law) => {
          const active = player.laws.includes(law)
          const clash = active ? null : lawConflict(player, law)
          return (
            <div key={law} className="inset-card p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[16px] font-semibold tracking-tight">{LAW_SPECS[law].name}</span>
                {active ? (
                  <OrderButton order={{ type: 'repealLaw', nationId: player.id, law }} label="Repeal" cost={`${EMPIRE_RULES.repealCost} influence`} />
                ) : (
                  <OrderButton order={{ type: 'enactLaw', nationId: player.id, law }} label="Pass" cost={`${LAW_SPECS[law].cost} influence`} tone="btn-primary" />
                )}
              </div>
              <p className="text-[13px] text-white/70 mt-1.5">
                {active ? 'In force. ' : ''}
                {LAW_SPECS[law].description}
                {clash && <span className="block text-[#ffb340] mt-1">Cannot stand beside {LAW_SPECS[clash].name}.</span>}
              </p>
            </div>
          )
        })}
      </div>
    </>
  )
}

