import { useState } from 'react'
import { LABS, PAD, ROCKETS, ROCKET_IDS, ROCKET_RULES, SAT_EFFECT, SAT_NAMES, SPACE } from '../../data/space'
import { discoveryBonus, expBonus, rocketBuildCost, rocketDevCost, rocketDevMonths, spaceComplexLevel } from '../../engine/spaceEffects'
import { freeAstronauts, freeEngineers, padSlots, padsInUse, spaceLocked, spaceProblem, staffOf, talentCap } from '../../engine/space'
import { signed, usePlayerView } from '../hooks'
import { Pips } from '../bits'
import { Bar, StatTile } from '../kit'
import { Tabs } from '../panel'
import { Card, Line } from './parts'
import { ColoniesSection } from './space/Colonies'
import { LabsSection } from './space/Labs'
import { MissionsSection } from './space/Missions'
import { Chip, QuickOrder } from './space/shared'
import { monthsText, money, percent, spaceOrder } from './space/words'
import { OrderButton } from '../panel'

type Section = 'agency' | 'rockets' | 'missions' | 'labs' | 'colonies'
const SECTIONS: readonly (readonly [Section, string])[] = [
  ['agency', 'Agency'],
  ['rockets', 'Rockets'],
  ['missions', 'Missions'],
  ['labs', 'Labs'],
  ['colonies', 'Colonies'],
]

// The section stays chosen while other desks are looked at.
let lastSection: Section = 'agency'

/** The space program: an agency of engineers and astronauts, the rockets they build, the missions they fly, the labs that learn from what comes back, and the colonies and mines beyond. */
export function SpaceTab() {
  const [section, setSection] = useState<Section>(lastSection)
  const choose = (s: Section) => {
    lastSection = s
    setSection(s)
  }
  const view = usePlayerView()!
  const locked = spaceLocked(view.player)
  return (
    <section className="econ-grid">
      <SpaceTiles />
      <div className="span-all">
        <Tabs value={section} onChange={choose} options={SECTIONS} />
      </div>
      {locked && (
        <div className="span-all inset-card p-3.5 text-[14px] text-[#ffd60a]">
          {locked}. Until then you can only look. Everything here is still explained, so you can plan for it.
        </div>
      )}
      {section === 'agency' && <AgencySection />}
      {section === 'rockets' && <RocketsSection />}
      {section === 'missions' && <MissionsSection />}
      {section === 'labs' && <LabsSection />}
      {section === 'colonies' && <ColoniesSection />}
    </section>
  )
}

function SpaceTiles() {
  const { player, econ } = usePlayerView()!
  const sp = player.space
  const cap = talentCap(player, econ.workforce)
  const flying = sp?.missions.length ?? 0
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 span-all tiles-compact">
      <StatTile label="Staff" value={`${staffOf(sp)} of ${cap}`} sub={`${sp?.engineers ?? 0} engineers, ${sp?.astronauts ?? 0} astronauts`} tone={staffOf(sp) > cap ? 'bad' : undefined} />
      <StatTile label="Experience" value={Math.floor(sp?.exp ?? 0)} sub={`launches ${percent(expBonus(sp?.exp ?? 0))} safer`} />
      <StatTile label="Standing in space" value={Math.round(sp?.prestige ?? 0)} sub={`${flying} flight${flying === 1 ? '' : 's'} under way`} />
      <StatTile label="Space budget" value={signed(-econ.space.bill.total)} sub={econ.space.income > 0 ? `mines bring in ${money(econ.space.income)}` : 'money a month'} tone={econ.space.bill.total > econ.gross * 0.3 ? 'warn' : undefined} />
    </div>
  )
}

// ---- Agency ----

function AgencySection() {
  const view = usePlayerView()!
  const { player, econ, game } = view
  const sp = player.space
  const cap = talentCap(player, econ.workforce)
  const bill = econ.space.bill
  const bonus = discoveryBonus(sp)
  const covers = econ.coverage.engineers
  const hireWhy = spaceProblem(game, player, { kind: 'hire', role: 'engineer', count: 1 }, econ.workforce)
  return (
    <>
      <Card title="Talent" hint="Engineers build and fly rockets. Astronauts fly the crewed missions. Both come out of the same specialists your factories and universities use, so a big agency thins them out. Pay is monthly.">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="text-[15px] font-semibold">Engineers · {sp?.engineers ?? 0}</div>
            <div className="text-[12px] text-white/65">{sp ? `${freeEngineers(sp)} free, ${SPACE.salaryEngineer} money a month each` : `${SPACE.salaryEngineer} money a month each`}</div>
            <div className="flex flex-wrap gap-1.5">
              <QuickOrder order={spaceOrder(player, { kind: 'hire', role: 'engineer', count: 1 })} label={`Hire 1 (${SPACE.hireEngineer})`} tone="btn-primary" />
              <QuickOrder order={spaceOrder(player, { kind: 'hire', role: 'engineer', count: 4 })} label={`Hire 4 (${SPACE.hireEngineer * 4})`} />
              <QuickOrder order={spaceOrder(player, { kind: 'dismiss', role: 'engineer', count: 1 })} label="Dismiss 1" tone="btn-quiet" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[15px] font-semibold">Astronauts · {sp?.astronauts ?? 0}</div>
            <div className="text-[12px] text-white/65">{sp ? `${freeAstronauts(sp)} free, ${SPACE.salaryAstronaut} money a month each` : `${SPACE.salaryAstronaut} money a month each`}</div>
            <div className="flex flex-wrap gap-1.5">
              <QuickOrder order={spaceOrder(player, { kind: 'hire', role: 'astronaut', count: 1 })} label={`Hire 1 (${SPACE.hireAstronaut})`} tone="btn-primary" />
              <QuickOrder order={spaceOrder(player, { kind: 'hire', role: 'astronaut', count: 2 })} label={`Hire 2 (${SPACE.hireAstronaut * 2})`} />
              <QuickOrder order={spaceOrder(player, { kind: 'dismiss', role: 'astronaut', count: 1 })} label="Dismiss 1" tone="btn-quiet" />
            </div>
          </div>
        </div>
        {hireWhy && <p className="text-[13px] text-[#ffd60a]">{hireWhy}</p>}
        <p className="text-[13px] text-white/70">
          Your people can spare {cap} specialists{bonus.talent > 0 ? ` (discoveries add ${percent(bonus.talent)})` : ''}. Factories are staffed at {percent(Math.min(covers, 1.2))}
          {covers < 0.95 ? `: the agency is taking engineers they need, and they slow down a little. Schooling and engineering focus bring more.` : '.'}
        </p>
      </Card>

      <Card title="Launch site" hint={`A rocket is built and launched from a pad. Each level adds a place for work; the national space launch complex (Economy, Projects) adds one more and lets the biggest pad be built.`}>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Pips value={sp?.pads ?? 0} max={PAD.max} />
            <div className="text-[13px] text-white/70">
              {sp?.pads ? `Level ${sp.pads}` : 'No launch site yet'} · {sp ? padsInUse(sp) : 0} of {padSlots(player)} places in use
              {spaceComplexLevel(player) > 0 ? ` (complex level ${spaceComplexLevel(player)})` : ''}
            </div>
          </div>
          <OrderButton
            order={spaceOrder(player, { kind: 'pad' })}
            label={sp?.padBuild ? 'Being built' : sp && sp.pads >= PAD.max ? 'Complete' : `Raise to level ${(sp?.pads ?? 0) + 1}`}
            cost={sp && sp.pads < PAD.max ? `${PAD.cost[sp.pads + 1]} over ${PAD.months[sp.pads + 1]} mo` : !sp ? `${PAD.cost[1]} over ${PAD.months[1]} mo` : undefined}
            tone="btn-primary"
          />
        </div>
        {sp?.padBuild && <Bar value={sp.padBuild.progress / PAD.months[sp.pads + 1]} label="Launch site progress" />}
        <p className="text-[12px] text-white/60">Upkeep {PAD.upkeep[sp?.pads ?? 0]} a month. The Orbital Network and your space launch complex are part of this: a complex lowers rocket prices 10%, and each level of Orbital Network makes satellites work 25% harder and launch 2 points safer.</p>
      </Card>

      <Card title="The monthly bill" hint="What the program costs and brings in each month. It is one line in your Budget.">
        <div className="text-[14px] space-y-1">
          <Line k="Pay for engineers and astronauts" v={money(-bill.staff)} />
          <Line k="Upkeep: launch site, labs, outposts, mines" v={money(-bill.upkeep)} />
          <Line k="Building: rockets, payloads, labs, bases" v={money(-bill.building)} />
          {econ.space.income > 0 && <Line k="Mines (sold at home)" v={`+${money(econ.space.income)}`} />}
          <Line k="Space program, net" v={money(econ.space.income - bill.total)} strong />
        </div>
      </Card>

      <SatellitesCard />

      <Card title="What has happened" hint="The agency's last events, newest first.">
        {sp?.events.length ? (
          <ul className="space-y-1.5 max-h-[320px] overflow-y-auto scroll-thin pr-1">
            {sp.events.map((e, i) => (
              <li key={i} className="text-[13px] flex gap-2">
                <span className="text-white/50 tabular-nums whitespace-nowrap">{Math.max(0, game.turn - e.turn) === 0 ? 'now' : `${game.turn - e.turn} mo ago`}</span>
                <span className={e.good ? 'text-white/85' : 'text-[#ff8a84]'}>{e.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-white/60">Nothing yet. Hire a few engineers, raise a launch site and develop a sounding rocket.</p>
        )}
      </Card>
    </>
  )
}

function SatellitesCard() {
  const { player, game } = usePlayerView()!
  const sats = player.space?.sats ?? []
  return (
    <Card title="Satellites in orbit" hint="Each works for six years, then falls. A second of one kind adds 60%.">
      {sats.length === 0 ? (
        <p className="text-[13px] text-white/60">None. A communications satellite lifts trade and research, a weather satellite calms the country, a reconnaissance satellite sees every enemy.</p>
      ) : (
        <ul className="space-y-1.5">
          {sats.map((x, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[13px]">
              <span>
                <span className="font-semibold">{SAT_NAMES[x.kind]}</span> <span className="text-white/65">· {SAT_EFFECT[x.kind].says}</span>
              </span>
              <Chip>{monthsText(Math.max(0, x.until - game.turn))} left</Chip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---- Rockets ----

function RocketsSection() {
  const view = usePlayerView()!
  const { player } = view
  const sp = player.space
  const [q, setQ] = useState('')
  const shown = ROCKET_IDS.filter((id) => `${ROCKETS[id].name} ${ROCKETS[id].blurb}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <>
      <div className="span-all">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rockets" aria-label="Search rockets" className="field w-full px-3 py-2 text-[14px]" />
      </div>
      <div className="span-all text-[13px] text-white/70">
        Each class has to be <b>developed</b> once (it takes months and engineers, and two later levels make it more reliable), and then every launch uses up a rocket that is <b>built</b>. Rockets are not reused unless your discoveries say so. The launch site has {padSlots(player)} place{padSlots(player) === 1 ? '' : 's'}{sp?.padBuild ? ` (more when the pad now being built is done)` : ''}; building a rocket and building a flight both use one.
      </div>
      {shown.map((id) => {
        const spec = ROCKETS[id]
        const level = sp?.rockets[id] ?? 0
        const nextL = Math.min(ROCKET_RULES.maxLevel, level + 1)
        const developing = sp?.dev?.rocket === id
        const have = sp?.hangar[id] ?? 0
        const building = (sp?.builds ?? []).filter((b) => b.rocket === id)
        const launch = spec.reliability + ROCKET_RULES.perLevel * Math.max(0, level - 1) + discoveryBonus(sp).reliability + expBonus(sp?.exp ?? 0)
              return (
          <div key={id} className={`inset-card p-3.5 space-y-2 ${level > 0 ? 'ring-1 ring-[#30d158]/25' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold tracking-tight">{spec.name}</h3>
                <p className="text-[13px] text-white/70">{spec.blurb}</p>
              </div>
              <div className="shrink-0 text-right space-y-1">
                <Pips value={level} max={ROCKET_RULES.maxLevel} />
                <div className="text-[12px] text-white/60">{level === 0 ? 'Not developed' : `Level ${level} of ${ROCKET_RULES.maxLevel}`}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip>launch odds {level > 0 ? percent(Math.min(SPACE.maxOdds, launch)) : `about ${percent(spec.reliability)}`}</Chip>
              <Chip>needs pad {spec.pad}</Chip>
              <Chip>{spec.engineers} engineers</Chip>
              <Chip tone={have > 0 ? 'good' : undefined}>{have} in the hangar</Chip>
              {building.length > 0 && <Chip tone="warn">{building.length} being built</Chip>}
            </div>
            {developing && sp?.dev && (
              <div className="space-y-1">
                <Bar value={sp.dev.progress / rocketDevMonths(id, level + 1)} label={`${spec.name} development`} color="#bf5af2" />
                <div className="text-[12px] text-white/65">
                  Developing level {level + 1}: {Math.max(0, rocketDevMonths(id, level + 1) - sp.dev.progress).toFixed(0)} months left, {money(rocketDevCost(id, level + 1) / rocketDevMonths(id, level + 1))} a month
                </div>
              </div>
            )}
            {building.map((b, i) => (
              <div key={i} className="space-y-1">
                <Bar value={b.progress / spec.months} label={`${spec.name} on the line`} color="#ff9f0a" />
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {level >= ROCKET_RULES.maxLevel ? (
                <span className="text-[13px] text-[#6eeb8a]">Fully developed</span>
              ) : (
                <OrderButton
                  order={spaceOrder(player, { kind: 'develop', rocket: id })}
                  label={developing ? 'Being developed' : level === 0 ? 'Develop' : `Improve to level ${nextL}`}
                  cost={developing ? undefined : `${rocketDevCost(id, nextL)} over ${rocketDevMonths(id, nextL)} mo`}
                  tone={level === 0 && !developing ? 'btn-primary' : ''}
                />
              )}
              <OrderButton
                order={spaceOrder(player, { kind: 'build', rocket: id })}
                label="Build one"
                cost={`${Math.round(rocketBuildCost(id, sp, player))} money, ${spec.steel} steel, ${spec.months} mo`}
              />
            </div>
          </div>
        )
      })}
      <div className="span-all text-[12px] text-white/55">Labs: level {sp?.labs ?? 0} of {LABS.max}. Discoveries can make rockets cheaper and more reliable.</div>
    </>
  )
}

