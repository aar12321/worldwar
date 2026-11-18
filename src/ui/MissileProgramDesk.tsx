import { useEffect, useState } from 'react'
import {
  CHIEF,
  CHIEF_TRAITS,
  CONTRACTORS,
  CONTRACTOR_IDS,
  DEVS,
  DEV_BRANCHES,
  DEV_BRANCH_IDS,
  DEV_IDS,
  FACILITIES,
  FACILITY_IDS,
  MILESTONES,
  PRODUCTION_RULES,
  PROGRAM_RULES,
  STAFF,
  STAFF_ROLES,
  type Contractor,
  type FacilityId,
  type MissileDevId,
  type MissileProgramAction,
  type ProgramKind,
  type StaffRole,
} from '../data/missileProgram'
import { MISSILES, MISSILE_PROGRAM, PROGRAM_MISSILES } from '../data/missiles'
import { MW } from '../data/missileWar'
import { clockOf, isLive } from '../engine/calendar'
import { activeDevs, chiefCandidates, chiefHireCost, chiefSalary, devLock, devPrice, devSlots, devStatus, lineRate, milestones, poachRisk, programBill, programTalentCap, rivalPrograms, testMoney, testOdds, testsAllowed, testsUsed, type DevStatus } from '../engine/missileProgram'
import { arsenalSize, buildRoom, fundMissilesCost, missileStock, programLevel, storageCap } from '../engine/missiles'
import { interceptorCap, mobileCover, radarLevel } from '../engine/missileWar'
import { programFx, programStaff } from '../engine/programEffects'
import type { GameState, Nation, Order } from '../engine/types'
import { useGame } from '../store'
import { Pips } from './bits'
import { fmt, usePlayerView } from './hooks'
import { Bar, StatTile, Tiles } from './kit'
import { MISSILE_SWATCH } from './missileText'
import { capabilities, devEffectLines, nextLevel, programSteps, timeline, whenText } from './missileProgramText'
import { OrderButton } from './panel'

const pct = (v: number) => `${Math.round(v * 100)}%`
const act = (n: Nation, action: MissileProgramAction): Order => ({ type: 'missileProgram', nationId: n.id, action })

/** The game as of today, even on a quiet live day (the desks read a slower copy), so bars and countdowns move. */
function useToday(): GameState | null {
  return useGame((s) => s.game)
}

function Section({ title, sub, children, id }: { title: string; sub?: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="inset-card p-3.5 space-y-3" aria-label={title} data-section={id}>
      <div>
        <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
        {sub && <p className="text-[13px] text-white/70">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

// ---- The header: charter, budget, the bill ----

function Header({ player, workforce }: { player: Nation; workforce: number }) {
  const p = player.mprog
  const level = programLevel(player)
  const bill = programBill(player)
  const cap = Math.max(0, programTalentCap(player, workforce))
  const staff = programStaff(player)
  const cost = fundMissilesCost(player)
  const budget = p?.budget ?? 1
  return (
    <section className="inset-card p-3.5 space-y-3" aria-label="Program overview" data-program-header>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[19px] font-semibold tracking-tight">{player.name} missile program</div>
          <p className="text-[13px] text-white/70">{MISSILE_PROGRAM.names[level]}. Build the facilities, hire the talent, develop and test: every finished project changes real strikes and forecasts.</p>
        </div>
        <div className="text-right shrink-0">
          <div className="label">Charter</div>
          <div className="text-[22px] font-semibold tabular-nums leading-none">
            {level}
            <span className="text-white/50 text-[14px]"> / {MISSILE_PROGRAM.maxLevel}</span>
          </div>
          <Pips value={level} max={MISSILE_PROGRAM.maxLevel} />
        </div>
      </div>
      {level < MISSILE_PROGRAM.maxLevel && (
        <OrderButton order={{ type: 'fundMissiles', nationId: player.id }} label={`Raise the charter to level ${level + 1}`} cost={`${cost.capital} money · ${cost.tp} research`} effect={`Opens ${MISSILE_PROGRAM.names[level + 1].replace(/^Level \d: /, '')}, more missiles a month, and facilities one level higher.`} tone="btn-primary" className="w-full sm:w-auto" />
      )}
      <Tiles compact>
        <StatTile label="Costs a month" value={fmt(bill.total, 1)} sub={`upkeep ${fmt(bill.upkeep, 1)} · staff ${fmt(bill.salaries, 1)} · work ${fmt(bill.ops, 1)}`} tone={p?.stalled ? 'bad' : undefined} />
        <StatTile label="Talent" value={`${staff} / ${cap}`} sub="shared with space" tone={staff >= cap && cap > 0 ? 'warn' : undefined} />
        <StatTile label="Experience" value={`${Math.round(p?.exp ?? 0)} / 100`} sub="tests and launches" />
      </Tiles>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[14px] font-semibold">Budget</span>
          <span className="text-[12px] text-white/65">Work {pct(0.6 + 0.4 * budget)} speed · operations cost ×{budget}</span>
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Program budget">
          {PROGRAM_RULES.budgets.map((b) => (
            <BudgetButton key={b} player={player} level={b} current={budget} />
          ))}
        </div>
        <p className="text-[12px] text-white/60">A lean budget saves money but staff listen to offers from rivals; a crash budget is fast and keeps people.</p>
      </div>
      {p?.stalled && <p className="text-[13px] text-[#ff8a84]">The treasury was empty at the month's end: in-house work stands still this month.</p>}
    </section>
  )
}

function BudgetButton({ player, level, current }: { player: Nation; level: number; current: number }) {
  const issueOrder = useGame((s) => s.issueOrder)
  const label = level === 0.5 ? 'Lean' : level === 1 ? 'Normal' : level === 1.5 ? 'Crash' : `${Math.round(level * 100)}%`
  return (
    <button role="radio" aria-checked={current === level} className={`btn px-2.5 py-1.5 text-[13px] min-h-[36px] ${current === level ? 'btn-primary' : 'btn-quiet'}`} onClick={() => current !== level && issueOrder(act(player, { kind: 'budget', level }))}>
      {label}
    </button>
  )
}

// ---- Milestones and next steps ----

function MilestoneStrip({ player }: { player: Nation }) {
  const got = new Set(milestones(player))
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="list" aria-label="Milestones" data-milestones={got.size}>
      {MILESTONES.map((m) => (
        <div key={m.id} role="listitem" title={m.blurb} className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold border ${got.has(m.id) ? 'border-[#ffd60a]/60 bg-[#ffd60a]/15 text-[#ffd60a]' : 'border-white/10 bg-white/5 text-white/45'}`}>
          {got.has(m.id) ? '★ ' : '☆ '}
          {m.name}
        </div>
      ))}
    </div>
  )
}

function Steps({ game, player, workforce }: { game: GameState; player: Nation; workforce: number }) {
  const steps = programSteps(game, player, workforce, 3)
  if (!steps.length) return null
  return (
    <section className="inset-card p-3.5 space-y-2" aria-label="Next steps" data-steps={steps.length}>
      <h3 className="text-[15px] font-semibold">Next steps</h3>
      {steps.map((st) => (
        <div key={st.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/10 p-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">{st.title}</div>
            <div className="text-[12px] text-white/70">{st.detail}</div>
          </div>
          {st.order && <OrderButton order={st.order} label="Do it" tone="btn-primary" className="shrink-0" />}
        </div>
      ))}
    </section>
  )
}

// ---- The live timeline and the test pad ----

function Timeline({ player }: { player: Nation }) {
  const game = useToday()
  if (!game) return null
  const items = timeline(game, game.nations[player.id] ?? player)
  return (
    <Section title="Timeline" sub={isLive(game) ? 'Everything in hand, soonest first. Days count down as the clock runs.' : 'Everything in hand, soonest first. Work moves on when the month ends.'} id="timeline">
      {items.length === 0 ? (
        <p className="text-[13px] text-white/65">Nothing in hand. Build a facility, start a development or put missiles on the line.</p>
      ) : (
        <ul className="space-y-2" data-timeline={items.length}>
          {items.map((it) => (
            <li key={it.id} className="space-y-1" data-item={it.kind}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="font-semibold truncate">{it.title}</span>
                <span className="tabular-nums text-white/75 shrink-0">{whenText(game, it.due)}</span>
              </div>
              <Bar value={it.share} color={it.color} label={it.title} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** The big moment: a development ready for its test, the odds, and the button. A short 3-2-1 plays on this screen when you press it. */
function TestPad({ player }: { player: Nation }) {
  const game = useToday()
  const reduced = useGame((s) => s.settings.reducedMotion)
  const [burst, setBurst] = useState<number | null>(null)
  useEffect(() => {
    if (burst === null) return
    const t = window.setTimeout(() => setBurst(null), reduced ? 1200 : 2600)
    return () => window.clearTimeout(t)
  }, [burst, reduced])
  if (!game) return null
  const n = game.nations[player.id] ?? player
  const flights = (game.missileTests ?? []).filter((t) => t.nationId === n.id)
  const ready = DEV_IDS.filter((id) => n.mprog?.devs[id]?.state === 'test' && !flights.some((t) => t.dev === id))
  const now = clockOf(game)
  if (!ready.length && !flights.length && burst === null) return null
  return (
    <Section title="Test range" sub={`${testsUsed(game, n)} of ${testsAllowed(n)} tests this month (each stand level allows one). A success puts the project in service; a failure teaches the engineers.`} id="tests">
      {burst !== null && (
        <div className="relative overflow-hidden rounded-xl border border-[#ff453a]/40 bg-[#ff453a]/10 p-4 text-center" role="status" aria-live="polite" data-countdown>
          {!reduced && <span className="absolute inset-0 m-auto h-16 w-16 rounded-full bg-[#ff453a]/30 animate-ping" aria-hidden />}
          <div className="relative text-[28px] font-bold tracking-widest tabular-nums mp-countdown">{reduced ? 'LAUNCH ORDERED' : <CountdownText />}</div>
          <div className="relative text-[12px] text-white/75">{isLive(game) ? 'On the pad. It lifts off after the countdown and lands a day later, out at sea.' : 'On the pad. It flies as the month ends.'}</div>
        </div>
      )}
      {flights.map((t) => {
        const flying = now >= t.launched
        const days = Math.max(0, Math.round((flying ? t.lands : t.launched) - now))
        return (
          <div key={t.id} className="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-1" data-test-flight={flying ? 'air' : 'pad'}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="font-semibold">{DEVS[t.dev].name}</span>
              <span className={`tabular-nums ${flying ? 'text-[#ffd60a]' : 'text-[#ff8a84]'}`}>{isLive(game) ? (flying ? `in flight · lands ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}` : `T-${days} day${days === 1 ? '' : 's'}`) : 'flies as the month ends'}</span>
            </div>
            <Bar value={flying ? Math.min(1, (now - t.launched) / Math.max(1, t.lands - t.launched)) : 0} color="#ff453a" label={`Test of ${DEVS[t.dev].name}`} />
          </div>
        )
      })}
      {ready.map((id) => {
        const odds = testOdds(n, id)
        const fails = n.mprog?.devs[id]?.fails ?? 0
        return (
          <div key={id} className="rounded-xl border border-[#ff453a]/30 bg-white/5 p-3 space-y-2" data-test-ready={id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[15px] font-semibold">{DEVS[id].name}</span>
              <span className="text-[13px] tabular-nums">
                <b className={odds >= 0.7 ? 'text-[#6eeb8a]' : odds >= 0.5 ? 'text-[#ffd60a]' : 'text-[#ff8a84]'}>{Math.round(odds * 100)}%</b> chance{fails ? ` · ${fails} failed before` : ''}
              </span>
            </div>
            <Bar value={odds} color={odds >= 0.7 ? '#30d158' : odds >= 0.5 ? '#ffd60a' : '#ff453a'} label="Chance of success" />
            <OrderButton order={act(n, { kind: 'test', dev: id })} label="Test launch" cost={`${testMoney(n, id)} money`} effect="Rivals nearby notice; world tension rises a little." tone="btn-red" className="w-full" onDone={() => setBurst(Date.now())} />
          </div>
        )
      })}
    </Section>
  )
}

function CountdownText() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setI((x) => Math.min(3, x + 1)), 600)
    return () => window.clearInterval(t)
  }, [])
  return <span key={i}>{['3', '2', '1', 'LAUNCH'][i]}</span>
}

// ---- Structure ----

function FacilityCard({ game, player, id }: { game: GameState; player: Nation; id: FacilityId }) {
  const spec = FACILITIES[id]
  const lvl = player.mprog?.fac[id] ?? 0
  const next = nextLevel(player, id)
  const building = player.mprog?.builds.find((b) => b.facility === id)
  const due = building ? timeline(game, player).find((t) => t.id === `f-${id}`) : undefined
  return (
    <article className={`rounded-xl border p-3 space-y-2 ${lvl > 0 ? 'border-white/15 bg-white/6' : 'border-white/10 bg-white/3'}`} data-facility={id} data-level={lvl}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold leading-snug">{spec.name}</div>
          <div className="text-[12px] text-white/65">{spec.perLevel} a level</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[18px] font-semibold tabular-nums leading-none">{lvl}</div>
          <Pips value={lvl} max={spec.money.length} />
        </div>
      </header>
      <p className="text-[12px] text-white/70">{spec.blurb}</p>
      {building ? (
        <div className="space-y-1">
          <div className="flex justify-between text-[12px]">
            <span>Building level {building.level}</span>
            <span className="tabular-nums text-white/75">{due ? whenText(game, due.due) : ''}</span>
          </div>
          <Bar value={due?.share ?? 0} color="#64d2ff" label={`${spec.name} construction`} />
        </div>
      ) : next ? (
        <OrderButton order={act(player, { kind: 'build', facility: id })} label={lvl ? `Upgrade to ${next.level}` : 'Build'} cost={`${next.money} money · ${next.months} mo · ${next.upkeep}/mo`} className="w-full" />
      ) : (
        <p className="text-[12px] text-[#6eeb8a]">At its highest level.</p>
      )}
    </article>
  )
}

function Structure({ game, player }: { game: GameState; player: Nation }) {
  const mw = player.missileWar
  return (
    <Section title="Structure" sub="Facilities take months to build and cost upkeep. A facility can be one level above the charter; bigger empires build bigger ones and more at once." id="structure">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {FACILITY_IDS.map((f) => (
          <FacilityCard key={f} game={game} player={player} id={f} />
        ))}
      </div>
      <div className="rounded-xl bg-white/5 p-2.5 text-[12px] text-white/75 flex flex-wrap items-center justify-between gap-2">
        <span>
          Defences in the Missile War tab: radar level {radarLevel(player)} · interceptor store {interceptorCap(player)} · mobile launchers {mobileCover(player)} · {Object.keys(mw?.batteries ?? {}).length} batteries
        </span>
        <OpenTab tab="missiles" label="Missile War" />
      </div>
    </Section>
  )
}

function OpenTab({ tab, label }: { tab: 'missiles' | 'systems'; label: string }) {
  const openMilitary = useGame((s) => s.openMilitary)
  return (
    <button className="btn btn-quiet px-3 py-1.5 text-[13px]" onClick={() => openMilitary(tab)}>
      Open {label}
    </button>
  )
}

// ---- Talent ----

function StaffRow({ player, role, room }: { player: Nation; role: StaffRole; room: number }) {
  const spec = STAFF[role]
  const have = player.mprog?.staff[role] ?? 0
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-1.5" data-staff={role} data-count={have}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">{spec.name}</div>
          <div className="text-[12px] text-white/70">{spec.blurb}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[18px] font-semibold tabular-nums leading-none">{have}</div>
          <div className="text-[11px] text-white/55">useful to {spec.useful}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <OrderButton order={act(player, { kind: 'hire', role, count: 1 })} label="Hire 1" cost={`${spec.hire} · ${spec.salary}/mo`} className="flex-1 min-w-[120px]" />
        {room >= 3 && <OrderButton order={act(player, { kind: 'hire', role, count: 3 })} label="Hire 3" cost={`${spec.hire * 3}`} className="flex-1 min-w-[100px]" />}
        {have > 0 && <OrderButton order={act(player, { kind: 'dismiss', role, count: 1 })} label="Dismiss 1" tone="btn-quiet" className="min-w-[96px]" />}
      </div>
    </div>
  )
}

function ChiefCard({ game, player }: { game: GameState; player: Nation }) {
  const chief = player.mprog?.chief
  const candidates = chiefCandidates(game, player)
  if (chief) {
    const t = CHIEF_TRAITS[chief.trait]
    return (
      <div className="rounded-xl border border-[#ffd60a]/40 bg-[#ffd60a]/8 p-3 space-y-1.5" data-chief={chief.trait}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="label">Chief designer</div>
            <div className="text-[16px] font-semibold">{chief.name}</div>
            <div className="text-[13px] text-[#ffd60a]">{t.name}</div>
          </div>
          <div className="text-right">
            <div className="label">Skill</div>
            <Pips value={chief.skill} max={CHIEF.maxSkill} />
            <div className="text-[11px] text-white/60 tabular-nums">{chief.tests} / {CHIEF.testsPerSkill} tests to next</div>
          </div>
        </div>
        <p className="text-[12px] text-white/75">{t.blurb} Salary {chiefSalary(chief)} a month.</p>
        <OrderButton order={act(player, { kind: 'dropChief' })} label="Let them go" tone="btn-quiet" />
      </div>
    )
  }
  return (
    <div className="space-y-2" data-chief="none">
      <div className="text-[14px] font-semibold">Chief designer: candidates this year</div>
      <div className="grid gap-2 sm:grid-cols-3">
        {candidates.map((c, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-1.5">
            <div className="text-[14px] font-semibold">{c.name}</div>
            <div className="text-[12px] text-[#ffd60a]">{CHIEF_TRAITS[c.trait].name}</div>
            <Pips value={c.skill} max={CHIEF.maxSkill} />
            <p className="text-[12px] text-white/70">{CHIEF_TRAITS[c.trait].blurb}</p>
            <OrderButton order={act(player, { kind: 'chief', pick: i })} label="Hire" cost={`${chiefHireCost(c)} · ${chiefSalary(c)}/mo`} className="w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Talent({ game, player, workforce }: { game: GameState; player: Nation; workforce: number }) {
  const cap = Math.max(0, programTalentCap(player, workforce))
  const room = cap - programStaff(player)
  const risk = poachRisk(game, player)
  return (
    <Section title="Talent" sub={`Your people can spare ${cap} specialists for missiles (the space agency draws on the same pool). ${room > 0 ? `${room} more can be hired.` : 'The pool is used up: schooling and engineers raise it.'}`} id="talent">
      <ChiefCard game={game} player={player} />
      <div className="grid gap-2 sm:grid-cols-2">
        {STAFF_ROLES.map((r) => (
          <StaffRow key={r} player={player} role={r} room={room} />
        ))}
      </div>
      <p className={`text-[12px] ${risk >= 0.05 ? 'text-[#ffd60a]' : 'text-white/65'}`} data-poach={Math.round(risk * 100)}>
        Rivals poach: {Math.round(risk * 100)}% chance a month of losing staff. Analysts and a bigger budget cut it; experience grows with every test and launch.
      </p>
    </Section>
  )
}

// ---- Development ----

const STATUS: Record<DevStatus, { label: string; tone: string }> = {
  done: { label: 'In service', tone: 'bg-[#30d158]/20 text-[#6eeb8a]' },
  test: { label: 'Ready to test', tone: 'bg-[#ff453a]/20 text-[#ff8a84]' },
  dev: { label: 'In development', tone: 'bg-[#0a84ff]/25 text-[#8ec5ff]' },
  ready: { label: 'Can start', tone: 'bg-white/12 text-white/85' },
  locked: { label: 'Locked', tone: 'bg-white/8 text-white/55' },
}

function DevCard({ game, player, id, by }: { game: GameState; player: Nation; id: MissileDevId; by: Contractor }) {
  const spec = DEVS[id]
  const status = devStatus(player, id)
  const st = STATUS[status]
  const lock = status === 'locked' ? devLock(player, id) : null
  const price = devPrice(id, by)
  const item = status === 'dev' ? timeline(game, player).find((t) => t.id === `d-${id}`) : undefined
  const d = player.mprog?.devs[id]
  return (
    <article className={`rounded-xl border p-2.5 space-y-1.5 ${status === 'done' ? 'border-[#30d158]/30 bg-[#30d158]/5' : status === 'locked' ? 'border-white/8 bg-white/3 opacity-80' : 'border-white/12 bg-white/5'}`} data-dev={id} data-status={status}>
      <header className="flex items-start justify-between gap-2">
        <span className="text-[14px] font-semibold leading-snug">{spec.name}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.tone}`}>{st.label}</span>
      </header>
      <ul className="text-[12px] space-y-0.5">
        {devEffectLines(id).map((l) => (
          <li key={l} className={status === 'done' ? 'text-[#6eeb8a]' : 'text-white/85'}>
            {status === 'done' ? '✓ ' : '+ '}
            {l}
          </li>
        ))}
      </ul>
      {status === 'dev' && item && (
        <div className="space-y-1">
          <div className="flex justify-between text-[12px] text-white/70">
            <span>{d && d.by !== 'house' ? CONTRACTORS[d.by].name : 'In-house'}</span>
            <span className="tabular-nums">{whenText(game, item.due)}</span>
          </div>
          <Bar value={item.share} color={DEV_BRANCHES[spec.branch].color} label={spec.name} />
        </div>
      )}
      {status === 'test' && <p className="text-[12px] text-[#ff8a84]">Work done: test it on the range above ({Math.round(testOdds(player, id) * 100)}%).</p>}
      {lock && <p className="text-[12px] text-white/60">{lock}</p>}
      {status === 'ready' && (
        <OrderButton order={act(player, { kind: 'develop', dev: id, by })} label="Develop" cost={`${price.capital} money · ${price.tp} research · ${spec.months} mo${spec.test !== undefined ? ' + test' : ''}`} className="w-full" />
      )}
    </article>
  )
}

function Development({ game, player }: { game: GameState; player: Nation }) {
  const [by, setBy] = useState<Contractor>('house')
  const [branch, setBranch] = useState<'all' | (typeof DEV_BRANCH_IDS)[number]>('all')
  const done = DEV_IDS.filter((id) => player.mprog?.devs[id]?.state === 'done').length
  const branches = branch === 'all' ? DEV_BRANCH_IDS : [branch]
  return (
    <Section title="Development" sub={`${done} of ${DEV_IDS.length} in service · ${activeDevs(player).length} of ${devSlots(player)} slots in use (a bigger institute adds slots). Most projects end with a test launch.`} id="development">
      <div className="space-y-1.5">
        <div className="text-[13px] font-semibold">Who does the work</div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Who does the work">
          {CONTRACTOR_IDS.map((c) => (
            <button key={c} role="radio" aria-checked={by === c} className={`btn px-2.5 py-1.5 text-[13px] min-h-[36px] ${by === c ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setBy(c)}>
              {CONTRACTORS[c].name}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-white/65">{CONTRACTORS[by].blurb}{by !== 'house' ? ` Price ×${CONTRACTORS[by].price}, pace ×${CONTRACTORS[by].pace}, tests ${Math.round(CONTRACTORS[by].reliability * 100)}%.` : ''}</p>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Branch">
        {(['all', ...DEV_BRANCH_IDS] as const).map((b) => (
          <button key={b} role="tab" aria-selected={branch === b} className={`btn shrink-0 px-2.5 py-1 text-[12px] ${branch === b ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setBranch(b)}>
            {b === 'all' ? 'All' : DEV_BRANCHES[b].name}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {branches.map((b) => (
          <div key={b} className="space-y-2" data-branch={b}>
            <div className="flex items-baseline gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: DEV_BRANCHES[b].color }} aria-hidden />
              <span className="text-[14px] font-semibold" style={{ color: DEV_BRANCHES[b].color }}>
                {DEV_BRANCHES[b].name}
              </span>
              <span className="text-[12px] text-white/60">{DEV_BRANCHES[b].blurb}</span>
            </div>
            {DEV_IDS.filter((id) => DEVS[id].branch === b).map((id) => (
              <DevCard key={id} game={game} player={player} id={id} by={by} />
            ))}
          </div>
        ))}
      </div>
    </Section>
  )
}

// ---- Production and stockpile ----

function Production({ game, player }: { game: GameState; player: Nation }) {
  const [kind, setKind] = useState<ProgramKind>('cruise')
  const plant = player.mprog?.fac.plant ?? 0
  const rate = lineRate(player)
  const level = programLevel(player)
  const room = buildRoom(player, game.turn)
  return (
    <Section title="Production and stockpile" sub={`Stores ${arsenalSize(player)} of ${storageCap(player)} · the workshop builds ${room} more this month at once · the line delivers ${fmt(rate, 1)} a month.`} id="production">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PROGRAM_MISSILES.map((k) => (
          <div key={k} className="rounded-xl bg-white/6 px-3 py-2" data-stock={k}>
            <div className="flex items-center gap-1.5 label">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: MISSILE_SWATCH[k] }} aria-hidden />
              {MISSILES[k].name.replace(' missile', '').replace(' rocket', '')}
            </div>
            <div className="text-[20px] font-semibold tabular-nums">{missileStock(player, k)}</div>
          </div>
        ))}
      </div>
      {level < 1 ? (
        <p className="text-[13px] text-[#ffd60a]">Raise the charter to level 1 to build missiles.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-1 flex-wrap" role="radiogroup" aria-label="Missile to build">
            {PROGRAM_MISSILES.filter((k) => MISSILES[k].level <= level).map((k) => (
              <button key={k} role="radio" aria-checked={kind === k} className={`btn px-2.5 py-1.5 text-[13px] ${kind === k ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setKind(k as ProgramKind)}>
                {MISSILES[k].name}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <OrderButton order={{ type: 'buildMissiles', nationId: player.id, kind, count: Math.max(1, Math.min(3, room)) }} label={`Workshop: build ${Math.max(1, Math.min(3, room))} now`} effect="Into the stores at once, from this month's capacity." tone="btn-primary" />
            {plant > 0 ? (
              <OrderButton order={act(player, { kind: 'produce', missile: kind, count: 6 })} label="Line: queue 6" effect={`${Math.round((1 - PRODUCTION_RULES.price) * 100)}% cheaper, delivered one by one.`} />
            ) : (
              <p className="text-[12px] text-white/60 self-center">A production plant runs a line that delivers day by day, cheaper.</p>
            )}
          </div>
        </div>
      )}
      {(player.mprog?.line.length ?? 0) > 0 && (
        <ul className="space-y-1.5" aria-label="Production line">
          {player.mprog!.line.map((b, i) => (
            <li key={b.id} className="space-y-1">
              <div className="flex justify-between text-[12px]">
                <span>
                  {i === 0 ? 'On the line' : 'Waiting'}: {b.count} {MISSILES[b.kind].name.toLowerCase()}s
                </span>
                <span className="tabular-nums text-white/70">{Math.floor(b.made)} done</span>
              </div>
              <Bar value={b.made / b.count} color={MISSILE_SWATCH[b.kind]} label={`Batch of ${MISSILES[b.kind].name}`} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ---- What a strike gets, and the rivals ----

function Capabilities({ player }: { player: Nation }) {
  const fx = programFx(player)
  const rows = capabilities(player)
  return (
    <Section title="What your missiles get" sub="These numbers are what the War Room and the Missile War tab use for strikes and forecasts." id="capabilities">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums">
          <thead>
            <tr className="text-white/60 text-left">
              <th className="font-normal py-1">Missile</th>
              <th className="font-normal py-1">Range</th>
              <th className="font-normal py-1">CEP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind} className="border-t border-white/8">
                <td className="py-1">{r.name}</td>
                <td className={`py-1 ${r.km > r.baseKm ? 'text-[#6eeb8a]' : ''}`}>{r.km.toLocaleString()} km</td>
                <td className="py-1">{r.cep.toLocaleString()} m</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[12px]">
        {[
          ['Harm per hit', fx?.harm ?? 0],
          ['Evades interception', fx?.evade ?? 0],
          ['Extra interception', fx?.intercept ?? 0],
          ['Store safe from counterforce', fx?.harden ?? 0],
          ['Cheaper missiles', fx?.cost ?? 0],
        ].map(([label, v]) => (
          <span key={label as string} className={`rounded-full px-2.5 py-1 ${(v as number) > 0 ? 'bg-[#30d158]/15 text-[#6eeb8a]' : 'bg-white/8 text-white/55'}`}>
            {label} {(v as number) > 0 ? `+${pct(v as number)}` : '—'}
          </span>
        ))}
      </div>
    </Section>
  )
}

function Rivals({ game, player }: { game: GameState; player: Nation }) {
  const list = rivalPrograms(game, player).slice(0, 6)
  const analysts = player.mprog?.staff.analyst ?? 0
  return (
    <Section title="Rival programs" sub={analysts ? 'What your analysts see.' : 'Hire an intelligence analyst to see rival programs (enemies at war and programs with foreign contractors show anyway).'} id="rivals">
      {list.length === 0 ? (
        <p className="text-[13px] text-white/65">{analysts ? 'No rival program in sight.' : 'Nothing seen.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((r) => (
            <li key={r.id} className="rounded-xl bg-white/5 px-3 py-2 text-[13px]" data-rival={r.id}>
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{r.name}</span>
                <span className="tabular-nums text-white/70">
                  {r.detail ? `${r.facilities} facility levels · ${r.devsDone} in service · ${r.tests} tests` : `~${Math.max(1, Math.round(r.facilities / 2) * 2)} facility levels`}
                </span>
              </div>
              {r.detail && r.active.length > 0 && <div className="text-[12px] text-white/65">Working on: {r.active.map((d) => DEVS[d].name.toLowerCase()).join(', ')}</div>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** The Missile Program tab of the Military desk: the whole program on one screen. */
export function MissileProgramTab() {
  const view = usePlayerView()
  if (!view) return null
  const { game, player, econ } = view
  const workforce = econ.workforce
  return (
    <div className="space-y-3" data-missile-program>
      <Header player={player} workforce={workforce} />
      <MilestoneStrip player={player} />
      <div className="grid gap-3 lg:grid-cols-2 items-start">
        <div className="space-y-3">
          <Steps game={game} player={player} workforce={workforce} />
          <TestPad player={player} />
        </div>
        <Timeline player={player} />
      </div>
      <Structure game={game} player={player} />
      <Talent game={game} player={player} workforce={workforce} />
      <Development game={game} player={player} />
      <div className="grid gap-3 lg:grid-cols-2 items-start">
        <Production game={game} player={player} />
        <div className="space-y-3">
          <Capabilities player={player} />
          <Rivals game={game} player={player} />
        </div>
      </div>
      <p className="text-[12px] text-white/55">Missiles are fired from the War Room and the Missile War tab. {MW.enabled ? 'Every test and strike moves the world up the tension ladder.' : ''}</p>
    </div>
  )
}

export default MissileProgramTab
