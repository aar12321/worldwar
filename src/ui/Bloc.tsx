import { useMemo, useState } from 'react'
import { BLOC, GOALS, PERKS, ROLES } from '../data/blocs'
import { FACTION } from '../data/factions'
import { UNIT_SPECS } from '../data/unitTypes'
import { blocDue, blocOf, blocPower, forecastOp, goalChoices, goalProgress, goalTitle, joinProblem, leaderOf, levelOf, levelProgress, rivalBloc, sendable } from '../engine/bloc'
import { absDate, clockOf, daysInMonth, isLive } from '../engine/calendar'
import { SENDABLE } from '../engine/deploy'
import { factionOf, seatsUsed } from '../engine/factions'
import { atWar, enemiesOf, regionsOf, totalUnits, turnDate } from '../engine/helpers'
import { canAttackRegion } from '../engine/warfare'
import type { BlocCall, BlocOp, Faction, GameState, NationId, Order, RegionId, UnitCounts, UnitType } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { FactionNotices } from './FactionLinks'
import { InviteBox, NationPicker } from './Faction'
import { UnitIcon } from './icons'
import { Bar, StatTile, Tiles } from './kit'
import { LocateButton } from './Locate'
import { OrderButton, PanelShell, Tabs } from './panel'
import type { PickerItem } from './pickerItems'
import { usePlayerView } from './hooks'

type BlocTab = 'overview' | 'operations' | 'members' | 'feed'

const num = (v: number, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-US', { maximumFractionDigits: d })
const pct = (v: number) => `${Math.round(v * 100)}%`
const MEMBER_COLORS = ['#0a84ff', '#30d158', '#ffd60a', '#ff9f0a', '#bf5af2', '#64d2ff', '#ff6482', '#ac8e68']
const nm = (g: GameState, id: NationId) => g.nations[id]?.name ?? id
const isPerson = (g: GameState, id: NationId) => g.humans.includes(id) || !!g.nations[id]?.isPlayer
const roleName = (id: string | undefined) => ROLES.find((r) => r.id === id)?.name

/** The players' names, to tell people from rivals. */
function usePlayerNames(): Record<NationId, string> {
  const players = useGame((s) => s.online?.lobby?.players)
  return useMemo(() => {
    const out: Record<NationId, string> = {}
    for (const p of players ?? []) if (p.nationId) out[p.nationId] = p.name
    return out
  }, [players])
}

function Dot({ color }: { color: string }) {
  return <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
}

/** When something due on D-Day happens, as words: a countdown in a live game, the month's end in a turn game. */
function ddayText(g: GameState, op: BlocOp): string {
  if (isLive(g)) {
    const left = op.dday - clockOf(g)
    return left > 0 ? `D-Day in ${left} day${left === 1 ? '' : 's'} (${absDate(op.dday)})` : 'D-Day is today'
  }
  const left = op.dday - g.turn
  return left <= 0 ? 'D-Day: the end of this month' : `D-Day: the end of ${turnDate(op.dday)} (${left + 1} month ends away)`
}

/** How long a call to arms stays open. */
function callTimer(g: GameState, c: BlocCall): string {
  const months = c.expires - g.turn
  if (isLive(g)) {
    const days = daysInMonth(g.turn) - (g.day ?? 0) + months * 30
    return `${days} day${days === 1 ? '' : 's'} to answer`
  }
  return months <= 0 ? 'answer this month' : `${months + 1} months to answer`
}

// ---- overview ----

function Header({ g, f, me }: { g: GameState; f: Faction; me: NationId }) {
  const b = blocOf(f)
  const lv = levelProgress(b.xp)
  const next = lv.to === null ? null : PERKS.find((p) => p.level === lv.level + 1)
  const won = b.ops.filter((o) => o.result?.won).length
  return (
    <section className="rounded-2xl border border-[#0a84ff]/40 bg-gradient-to-br from-[#0a84ff]/18 to-white/4 p-4 space-y-3" aria-label="Your bloc">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label">Your bloc</div>
          <h3 className="text-[24px] font-semibold tracking-tight leading-tight truncate">{f.name}</h3>
          <p className="text-[13px] text-white/70">
            Led by {nm(g, leaderOf(f))}
            {leaderOf(f) === me ? ' (you)' : ''} · {seatsUsed(g, f)} member{seatsUsed(g, f) === 1 ? '' : 's'}
            {b.roles[me] ? ` · you are the ${roleName(b.roles[me])}` : ''}
          </p>
        </div>
        <div className="text-center shrink-0 rounded-xl bg-black/30 px-3 py-1.5" title={`Prestige ${num(b.xp)}`}>
          <div className="label">Level</div>
          <div className="text-[28px] font-semibold tabular-nums leading-none text-[#8ec5ff]" data-testid="bloc-level">{lv.level}</div>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-[12.5px] text-white/75">
          <span>Prestige {num(b.xp)}</span>
          <span>{lv.to === null ? 'Top level: every perk unlocked' : `${num(lv.to - b.xp)} to level ${lv.level + 1}${next ? `: ${next.name}` : ''}`}</span>
        </div>
        <Bar value={lv.to === null ? 1 : (b.xp - lv.from) / (lv.to - lv.from)} color="#64d2ff" label="Prestige toward the next level" />
      </div>
      <Tiles>
        <StatTile label="Strength" value={num(blocPower(g, f))} sub="all members together" />
        <StatTile label="Objectives" value={`${b.done} met`} sub={b.failed ? `${b.failed} missed` : 'none missed'} tone={b.done ? 'good' : undefined} />
        <StatTile label="Operations" value={`${b.ops.filter((o) => o.status === 'planned' || o.status === 'marching').length} open`} sub={`${won} won lately`} />
      </Tiles>
    </section>
  )
}

function Calls({ g, f, me, orders }: { g: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const b = blocOf(f)
  const open = b.calls.filter((c) => c.expires >= g.turn)
  if (!open.length) return null
  return (
    <section className="space-y-2" aria-label="Calls to arms">
      <div className="label text-[#ffd60a]">Calls to arms</div>
      {open.map((c) => {
        const mine = c.by === me
        const answered = c.answers[me]
        const queued = orders.find((o): o is Extract<Order, { type: 'blocAnswer' }> => o.type === 'blocAnswer' && o.callId === c.id)
        const why = mine ? null : joinProblem(g, me, c.target)
        const joined = f.members.filter((m) => m !== c.by && atWar(g, m, c.target))
        return (
          <div key={c.id} className="rounded-2xl border border-[#ffd60a]/55 bg-[#ffd60a]/7 p-3.5 space-y-2.5" data-testid="call-card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[18px] font-semibold leading-tight">
                  {mine ? `You called the bloc against ${nm(g, c.target)}` : `${nm(g, c.by)} calls you to war on ${nm(g, c.target)}`}
                </div>
                <div className="text-[12.5px] text-white/70">{c.auto ? 'A member is at war: the bloc is called in.' : 'The leader calls the bloc to arms.'} · {callTimer(g, c)}</div>
              </div>
              <LocateButton id={c.target} compact />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {f.members.filter((m) => m !== c.by && !g.nations[m]?.territoryOf).map((m) => {
                const a = c.answers[m] ?? (joined.includes(m) ? 'join' : undefined)
                return (
                  <span key={m} className={`chip ${a === 'join' ? 'chip-green' : a === 'decline' ? 'chip-red' : ''}`}>
                    {a === 'join' ? '✓' : a === 'decline' ? '✗' : '…'} {nm(g, m)}
                  </span>
                )
              })}
            </div>
            {!mine && (answered === 'join' || atWar(g, me, c.target) ? (
              <p className="text-[13px] text-[#9ff0b5]">You are at war with {nm(g, c.target)} beside {nm(g, c.by)}. Pledge divisions to an operation on the Operations tab.</p>
            ) : queued ? (
              <p className="text-[13px] text-white/80">Your answer ({queued.join ? 'join' : 'decline'}) is sent when the month ends.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <OrderButton order={{ type: 'blocAnswer', nationId: me, callId: c.id, join: true }} label="Join the war" effect={why ?? `+${BLOC.joinPrestige} bloc prestige`} tone="btn-primary" className="min-h-[48px]" />
                <OrderButton order={{ type: 'blocAnswer', nationId: me, callId: c.id, join: false }} label={answered === 'decline' ? 'Declined' : 'Decline'} effect="Stay out of it" tone="btn-quiet" className="min-h-[48px]" />
              </div>
            ))}
          </div>
        )
      })}
    </section>
  )
}

function Objective({ g, f, me }: { g: GameState; f: Faction; me: NationId }) {
  const b = blocOf(f)
  const goal = b.goal
  const leader = leaderOf(f) === me
  const choices = goalChoices(g, f)
  const canPick = leader && (!goal || g.turn <= goal.since)
  const p = goal ? goalProgress(g, f, goal) : null
  const left = goal ? goal.until - g.turn + 1 : 0
  return (
    <section className="rounded-2xl border border-white/14 bg-white/5 p-4 space-y-3" aria-label="Season objective">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="label">Season objective</div>
          <h3 className="text-[19px] font-semibold tracking-tight">{goal ? goalTitle(g, goal) : 'Chosen when the month ends'}</h3>
          <p className="text-[13px] text-white/75">{goal ? GOALS[goal.kind].text : 'The bloc takes the best fit for the new season; the leader can change it in the season’s first month.'}</p>
        </div>
        {goal && <span className="chip chip-blue whitespace-nowrap">{left > 0 ? `${left} month${left === 1 ? '' : 's'} left` : 'last month'}</span>}
      </div>
      {goal && p && (
        <div className="space-y-1">
          <Bar value={p.value} color={p.met ? '#30d158' : '#ffd60a'} label="Objective progress" />
          <div className="flex justify-between text-[12.5px] text-white/75">
            <span>{p.text}</span>
            <span>Reward: +{BLOC.goalPrestige} prestige, +{BLOC.goalInfluence} influence each</span>
          </div>
        </div>
      )}
      {canPick && choices.length > 1 && (
        <div className="space-y-1.5">
          <div className="label">{leader ? 'As leader, choose this season’s objective' : ''}</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5" role="radiogroup" aria-label="Objectives on offer">
            {choices.map((c) => {
              const on = goal?.kind === c.kind && goal?.target === c.target
              return (
                <OrderButton key={`${c.kind}-${c.target ?? ''}`} order={{ type: 'blocGoal', nationId: me, goal: c.kind, ...(c.target ? { target: c.target } : {}) }} label={goalTitle(g, c)} effect={on ? 'The current objective' : GOALS[c.kind].text} tone={on ? 'btn-primary' : ''} className="text-left" />
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function Perks({ f }: { f: Faction }) {
  const lv = levelOf(blocOf(f).xp)
  return (
    <section className="space-y-2" aria-label="Perks">
      <div className="label">Perks: unlocked by level</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PERKS.map((p) => {
          const on = lv >= p.level
          return (
            <div key={p.id} className={`rounded-xl border p-3 ${on ? 'border-[#30d158]/50 bg-[#30d158]/8' : 'border-white/10 bg-white/4 opacity-75'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[14.5px]">{p.name}</span>
                <span className={`chip ${on ? 'chip-green' : ''}`}>{on ? 'Active' : `Level ${p.level}`}</span>
              </div>
              <p className="text-[12.5px] text-white/75 mt-0.5">{p.text}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Scoreboard({ g, f }: { g: GameState; f: Faction }) {
  const rows = [...(g.factions ?? [])].map((x) => ({ f: x, power: blocPower(g, x) })).sort((a, b) => b.power - a.power).slice(0, 5)
  const top = Math.max(1, ...rows.map((r) => r.power))
  if (rows.length < 2) return null
  return (
    <section className="space-y-2" aria-label="Blocs of the world">
      <div className="label">Your bloc against the world</div>
      {rows.map((r) => {
        const mine = r.f.id === f.id
        const enemy = r.f.members.some((m) => f.members.some((x) => atWar(g, m, x)))
        return (
          <div key={r.f.id} className={`rounded-xl p-2.5 ${mine ? 'bg-[#0a84ff]/12 border border-[#0a84ff]/40' : 'bg-white/5 border border-white/10'}`}>
            <div className="flex items-center justify-between gap-2 text-[13.5px]">
              <span className="font-semibold truncate">
                {r.f.name} {mine && <span className="chip chip-blue">You</span>} {enemy && <span className="chip chip-red">At war</span>}
              </span>
              <span className="text-white/70 tabular-nums whitespace-nowrap">Lv {levelOf(blocOf(r.f).xp)} · {seatsUsed(g, r.f)} members · {num(r.power)}</span>
            </div>
            <div className="mt-1.5">
              <Bar value={r.power / top} color={mine ? '#0a84ff' : enemy ? '#ff453a' : '#8e8e93'} label={`${r.f.name} strength`} />
            </div>
          </div>
        )
      })}
    </section>
  )
}

function WarsAndCall({ g, f, me, orders }: { g: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const enemies = [...new Set(f.members.flatMap((m) => enemiesOf(g, m)))].filter((e) => !f.members.includes(e) && g.nations[e]?.alive).sort()
  if (!enemies.length) return null
  const leader = leaderOf(f) === me
  return (
    <section className="space-y-2" aria-label="The bloc's wars">
      <div className="label text-[#ff8a84]">The bloc's wars</div>
      {enemies.map((e) => {
        const fighting = f.members.filter((m) => atWar(g, m, e))
        const order: Order = { type: 'blocCall', nationId: me, target: e }
        return (
          <div key={e} className="rounded-xl border border-[#ff453a]/40 bg-[#ff453a]/7 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{nm(g, e)}</span>
              <span className="flex items-center gap-2">
                <span className="text-[12.5px] text-white/70">{regionsOf(g, e).length} countries</span>
                <LocateButton id={e} compact />
              </span>
            </div>
            <div className="text-[12.5px] text-white/75">Fighting: {fighting.map((m) => nm(g, m)).join(', ')}</div>
            {leader && atWar(g, me, e) && fighting.length < f.members.length && !blocOf(f).calls.some((c) => c.target === e) && !orders.some((o) => o.type === 'blocCall' && o.target === e) && (
              <OrderButton order={order} label={`Call the bloc to arms against ${nm(g, e)}`} cost={`${BLOC.callInfluence} influence`} effect="Members join with one click" />
            )}
          </div>
        )
      })}
    </section>
  )
}

// ---- operations ----

function Stepper({ k, value, max, onChange }: { k: UnitType; value: number; max: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(0, Math.min(Math.floor(max * 10) / 10, Math.round(v * 10) / 10)))
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="flex items-center gap-2 min-w-0">
        <UnitIcon unit={k} size={18} />
        <span className="min-w-0">
          <span className="block text-[14px] truncate">{UNIT_SPECS[k].name}</span>
          <span className="block text-[11.5px] text-white/60">{num(max, 1)} free</span>
        </span>
      </span>
      <span className="flex items-center gap-1">
        <button type="button" className="btn px-0 w-9 h-9 text-[18px]" aria-label={`One less ${UNIT_SPECS[k].name}`} onClick={() => set(value - 1)} disabled={value <= 0}>
          −
        </button>
        <input type="number" min={0} max={Math.floor(max * 10) / 10} step={1} value={value || ''} placeholder="0" aria-label={`${UNIT_SPECS[k].name} to pledge`} onChange={(e) => set(+e.target.value || 0)} className="w-[62px] bg-black/40 border border-white/15 rounded-lg px-2 py-1.5 text-right text-[14px] tabular-nums focus:border-[#0a84ff] outline-none" />
        <button type="button" className="btn px-0 w-9 h-9 text-[18px]" aria-label={`One more ${UNIT_SPECS[k].name}`} onClick={() => set(value + 1)} disabled={value >= max - 0.05}>
          +
        </button>
        <button type="button" className="btn btn-quiet px-2 py-1 text-[12px]" onClick={() => set(max)} disabled={max < 0.1}>
          Max
        </button>
      </span>
    </div>
  )
}

function PledgeForm({ g, op, me, orders }: { g: GameState; op: BlocOp; me: NationId; orders: Order[] }) {
  const queued = orders.find((o): o is Extract<Order, { type: 'blocCommit' }> => o.type === 'blocCommit' && o.opId === op.id)
  const current = queued?.units ?? op.pledges[me] ?? {}
  const [draft, setDraft] = useState<Partial<UnitCounts>>(current)
  const free = sendable(g, me)
  const kinds = SENDABLE.filter((k) => free[k] >= 0.1 || (draft[k] ?? 0) > 0)
  const total = SENDABLE.reduce((a, k) => a + (draft[k] ?? 0), 0)
  const units = Object.fromEntries(SENDABLE.filter((k) => (draft[k] ?? 0) > 0).map((k) => [k, draft[k]])) as Partial<UnitCounts>
  const atWarNow = atWar(g, me, g.regions[op.target]?.owner ?? '')
  return (
    <div className="rounded-xl bg-black/30 p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14.5px] font-semibold">Your pledge</span>
        <span className="text-[12.5px] text-white/70">{num(total, 1)} divisions · they stay home until the force sets out</span>
      </div>
      {!atWarNow && <p className="text-[12.5px] text-[#ffd60a]">You are not at war with {nm(g, g.regions[op.target]?.owner ?? op.enemy)}: your pledge only counts if you are by D-Day.</p>}
      {kinds.length === 0 && <p className="text-[13px] text-white/65">You have no free divisions to send.</p>}
      <div className="divide-y divide-white/8">
        {kinds.map((k) => (
          <Stepper key={k} k={k} value={draft[k] ?? 0} max={Math.max(free[k], draft[k] ?? 0)} onChange={(v) => setDraft({ ...draft, [k]: v })} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1.5">
        <OrderButton order={{ type: 'blocCommit', nationId: me, opId: op.id, units }} label={op.pledges[me] || queued ? 'Update pledge' : 'Pledge'} effect={isLive(g) ? 'Counts at once' : 'Counts when the month ends'} tone="btn-primary" className="min-h-[46px]" />
        {(op.pledges[me] || queued) && <OrderButton order={{ type: 'blocCommit', nationId: me, opId: op.id, units: {} }} label="Withdraw" effect="Keep your divisions home" tone="btn-quiet" className="min-h-[46px]" onDone={() => setDraft({})} />}
      </div>
    </div>
  )
}

function OpCard({ g, f, op, me, orders }: { g: GameState; f: Faction; op: BlocOp; me: NationId; orders: Order[] }) {
  const { map } = getWorld()
  const fc = useMemo(() => forecastOp(g, map, f, op), [g, map, f, op])
  const owner = g.regions[op.target]?.owner ?? op.enemy
  const army = op.armyId ? g.armies?.find((a) => a.id === op.armyId) : undefined
  const pledged = Object.keys(op.pledges).sort()
  const canCancel = op.status === 'planned' && (op.by === me || leaderOf(f) === me)
  const arrive = army ? army.end - clockOf(g) : 0
  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${op.status === 'marching' ? 'border-[#ff9f0a]/60 bg-[#ff9f0a]/8' : 'border-[#0a84ff]/45 bg-[#0a84ff]/7'}`} data-testid="op-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="label">{op.status === 'marching' ? 'On the march' : 'Operation planned'} · by {nm(g, op.by)}</div>
          <h3 className="text-[20px] font-semibold leading-tight truncate">{map.regions[op.target]?.name ?? op.target}</h3>
          <div className="text-[13px] text-white/75">held by {nm(g, owner)} · Defense Line {num(g.regions[op.target]?.line ?? 0, 1)}</div>
        </div>
        <LocateButton id={owner} compact />
      </div>
      <div className={`rounded-xl px-3 py-2 text-[15px] font-semibold tabular-nums ${op.status === 'marching' ? 'bg-[#ff9f0a]/18 text-[#ffd08a]' : 'bg-black/30 text-[#8ec5ff]'}`} data-testid="op-countdown">
        {op.status === 'marching' && army ? `${army.phase === 'outbound' ? (arrive > 0 ? `Arrives in ${arrive} day${arrive === 1 ? '' : 's'}` : 'Arriving') : 'Fighting'}: ${num(totalUnits(army.units), 1)} divisions, led over ${nm(g, army.nationId)}'s border` : ddayText(g, op)}
      </div>
      {op.status === 'planned' && (
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Odds today" value={fc.lead ? pct(fc.winChance) : '—'} tone={fc.winChance >= 0.65 ? 'good' : fc.winChance >= 0.4 ? 'warn' : 'bad'} sub={fc.lead ? `led by ${nm(g, fc.lead)}` : 'nobody can lead it yet'} />
          <StatTile label="Force" value={`${num(fc.divisions, 1)} div.`} sub={`${fc.fighters.length} member${fc.fighters.length === 1 ? '' : 's'}`} />
          <StatTile label="Combined arms" value={`+${pct(fc.bonus)}`} sub={`+${pct(BLOC.perMember)} a member`} tone={fc.bonus > 0 ? 'good' : undefined} />
        </div>
      )}
      <div className="space-y-1">
        <div className="label">Pledges</div>
        {pledged.length === 0 && <p className="text-[13px] text-white/65">Nobody has pledged yet.</p>}
        <div className="flex flex-wrap gap-1.5">
          {pledged.map((m) => (
            <span key={m} className={`chip ${fc.dropped[m] ? 'chip-red' : 'chip-green'}`} title={fc.dropped[m] ?? undefined}>
              {nm(g, m)} {num(totalUnits({ infantry: 0, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0, ...op.pledges[m] }), 1)} div.{fc.dropped[m] ? ` · ${fc.dropped[m]}` : ''}
            </span>
          ))}
        </div>
      </div>
      {op.status === 'planned' && f.members.includes(me) && <PledgeForm key={`${op.id}-${JSON.stringify(op.pledges[me] ?? {})}`} g={g} op={op} me={me} orders={orders} />}
      {canCancel && <OrderButton order={{ type: 'blocCancel', nationId: me, opId: op.id }} label="Call it off" tone="btn-quiet" effect="Pledges are released" />}
    </div>
  )
}

function OpReport({ g, op }: { g: GameState; op: BlocOp }) {
  const { map } = getWorld()
  const r = op.result
  if (!r) return null
  const place = map.regions[op.target]?.name ?? op.target
  const members = Object.keys(r.members).sort((a, b) => r.members[b].share - r.members[a].share)
  return (
    <div className="rounded-2xl border border-white/14 bg-white/5 p-3.5 space-y-2" data-testid="op-report">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[16px] truncate">{place}</span>
        <span className={`chip ${r.failed ? '' : r.captured ? 'chip-green' : r.won ? 'chip-green' : 'chip-red'}`}>{r.failed ? 'Did not go ahead' : r.captured ? 'Captured' : r.won ? 'Won' : 'Repulsed'}</span>
      </div>
      <div className="text-[12.5px] text-white/65">
        {turnDate(r.turn)}
        {r.failed ? ` · ${r.failed}` : ` · led by ${nm(g, r.lead)} · combined arms +${pct(r.bonus)}`}
        {r.owner ? ` · ${place} goes to ${nm(g, r.owner)}` : ''}
      </div>
      {members.length > 0 && (
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[13px] tabular-nums">
          <span className="label">Member</span>
          <span className="label text-right">Sent</span>
          <span className="label text-right">Lost</span>
          <span className="label text-right">Share</span>
          {members.map((m, i) => (
            <div key={m} className="contents">
              <span className="flex items-center gap-1.5 min-w-0">
                <Dot color={MEMBER_COLORS[i % MEMBER_COLORS.length]} />
                <span className="truncate">{nm(g, m)}</span>
              </span>
              <span className="text-right">{num(r.members[m].sent, 1)}</span>
              <span className="text-right text-[#ff8a84]">{num(r.members[m].lost, 1)}</span>
              <span className="text-right">
                {pct(r.members[m].share)}
                {r.spoils?.[m] ? <span className="text-[#ffd60a]"> +{num(r.spoils[m])}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PlanOp({ g, f, me, orders }: { g: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const { map } = getWorld()
  const [pick, setPick] = useState<RegionId | null>(null)
  const live = isLive(g)
  const whenOptions = live ? [7, 15, 30] : [1, 2, 3]
  const [when, setWhen] = useState(whenOptions[live ? 1 : 0])
  const items = useMemo<PickerItem[]>(() => {
    const out: PickerItem[] = []
    const enemies = [...new Set(f.members.flatMap((m) => enemiesOf(g, m)))].filter((e) => !f.members.includes(e) && g.nations[e]?.alive).sort()
    for (const e of enemies) {
      for (const r of regionsOf(g, e)) {
        const by = f.members.filter((m) => atWar(g, m, e) && canAttackRegion(g, map, m, r).ok)
        out.push({
          id: r,
          name: map.regions[r]?.name ?? r,
          group: nm(g, e),
          color: g.nations[e]?.color,
          note: `line ${num(g.regions[r].line, 1)}`,
          why: by.length ? undefined : 'No member at war with them can reach it',
          chips: by.length ? [{ text: `via ${by.map((m) => nm(g, m)).join(', ')}`, tone: 'good' as const }] : [],
        })
      }
    }
    return out.sort((a, b) => (a.why ? 1 : 0) - (b.why ? 1 : 0))
  }, [g, f, map])
  if (!items.length) {
    return (
      <section className="rounded-2xl border border-white/14 bg-white/5 p-4 space-y-1" aria-label="Plan an operation">
        <h3 className="text-[18px] font-semibold">Plan an operation</h3>
        <p className="text-[13.5px] text-white/75">An operation needs an enemy. When a member goes to war the others are called in; then plan a joint attack here.</p>
      </section>
    )
  }
  return (
    <section className="rounded-2xl border border-white/14 bg-white/5 p-4 space-y-3" aria-label="Plan an operation">
      <div>
        <h3 className="text-[19px] font-semibold tracking-tight">Plan an operation</h3>
        <p className="text-[13px] text-white/70">Pick an enemy country and a D-Day. Every member pledges divisions from its own army; on D-Day they attack as one force, {pct(BLOC.perMember)} harder for each extra member, and the spoils go by what each sent.</p>
      </div>
      <NationPicker label="Enemy countries" items={items} value={pick} onChange={setPick} placeholder="Search enemy countries" max={240} />
      <div className="space-y-1">
        <div className="label">D-Day</div>
        <div className="segmented" role="radiogroup" aria-label="D-Day">
          {whenOptions.map((w) => (
            <button key={w} role="radio" aria-checked={when === w} aria-pressed={when === w} onClick={() => setWhen(w)}>
              {live ? `${w} days` : w === 1 ? 'Next month' : `In ${w} months`}
            </button>
          ))}
        </div>
      </div>
      {pick ? (
        <OrderButton order={{ type: 'blocPlan', nationId: me, target: pick, when }} label={`Plan the operation on ${map.regions[pick]?.name}`} cost={`${BLOC.planInfluence} influence`} effect={live ? 'The members see it at once' : 'It is planned when the month ends'} tone="btn-primary" className="w-full" onDone={() => setPick(null)} />
      ) : (
        <p className="text-[13px] text-white/60">Choose a country. {orders.some((o) => o.type === 'blocPlan') ? 'An operation is already queued this month.' : ''}</p>
      )}
    </section>
  )
}

function OperationsTab({ g, f, me, orders }: { g: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const b = blocOf(f)
  const active = b.ops.filter((o) => o.status === 'planned' || o.status === 'marching')
  const done = b.ops.filter((o) => o.status === 'done' && o.result).reverse()
  return (
    <div className="space-y-5">
      {active.length > 0 && (
        <section className="space-y-3" aria-label="Operations">
          {active.map((op) => (
            <OpCard key={op.id} g={g} f={f} op={op} me={me} orders={orders} />
          ))}
        </section>
      )}
      {active.length < BLOC.maxOps && <PlanOp g={g} f={f} me={me} orders={orders} />}
      {done.length > 0 && (
        <section className="space-y-2" aria-label="Battle reports">
          <div className="label">Joint battle reports</div>
          {done.map((op) => (
            <OpReport key={op.id} g={g} op={op} />
          ))}
        </section>
      )}
    </div>
  )
}

// ---- members ----

function MembersTab({ g, f, me, orders }: { g: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const b = blocOf(f)
  const names = usePlayerNames()
  const rows = [...f.members].sort((a, x) => (a === leaderOf(f) ? -1 : x === leaderOf(f) ? 1 : 0) || (a < x ? -1 : 1))
  const queuedRole = orders.find((o): o is Extract<Order, { type: 'blocRole' }> => o.type === 'blocRole')
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-label="Members">
        <div className="label">Members</div>
        {rows.map((id, i) => {
          const n = g.nations[id]
          const rec = b.record[id]
          return (
            <div key={id} className={`rounded-xl border p-3 ${id === me ? 'border-[#0a84ff]/50 bg-[#0a84ff]/8' : 'border-white/12 bg-white/5'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0 flex-wrap">
                  <Dot color={n?.color ?? MEMBER_COLORS[i % MEMBER_COLORS.length]} />
                  <span className="font-semibold text-[15px] truncate">{n?.name ?? id}</span>
                  {id === me && <span className="chip chip-blue">You</span>}
                  {id === leaderOf(f) && <span className="chip chip-blue">Leader</span>}
                  {b.roles[id] && <span className="chip chip-green">{roleName(b.roles[id])}</span>}
                  {n?.territoryOf && <span className="chip">Territory of {nm(g, n.territoryOf)}</span>}
                  {!(id === me && !names[id]) && <span className="chip">{isPerson(g, id) ? (names[id] ? `Player: ${names[id]}` : 'Player') : 'Rival'}</span>}
                </span>
                {n && <LocateButton id={id} compact />}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-white/70">
                <span>{regionsOf(g, id).length} countries</span>
                <span>{rec?.ops ?? 0} operations · {num(rec?.sent ?? 0, 1)} divisions sent</span>
                <span>{rec?.joined ?? 0} calls answered</span>
                {enemiesOf(g, id).length > 0 && <span className="text-[#ff8a84]">at war with {enemiesOf(g, id).map((e) => nm(g, e)).join(', ')}</span>}
              </div>
            </div>
          )
        })}
      </section>
      {!g.nations[me]?.territoryOf && (
        <section className="space-y-2" aria-label="Roles">
          <div className="label">Roles: one member each</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ROLES.map((r) => {
              const holder = Object.entries(b.roles).find(([m, x]) => x === r.id && f.members.includes(m))?.[0]
              const mine = holder === me
              return (
                <div key={r.id} className={`rounded-xl border p-3 space-y-1.5 ${mine ? 'border-[#30d158]/55 bg-[#30d158]/8' : 'border-white/12 bg-white/5'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[15px]">{r.name}</span>
                    <span className="text-[12px] text-white/65">{holder ? nm(g, holder) : 'open'}</span>
                  </div>
                  <p className="text-[12.5px] text-white/80">{r.text}</p>
                  <p className="text-[12px] text-white/60">Duty: {r.duty}</p>
                  {mine ? (
                    <OrderButton order={{ type: 'blocRole', nationId: me, role: null }} label="Give it up" tone="btn-quiet" />
                  ) : !holder ? (
                    <OrderButton order={{ type: 'blocRole', nationId: me, role: r.id }} label={queuedRole?.role === r.id ? 'Taking it…' : `Become the ${r.name}`} effect={b.roles[me] ? `Instead of ${roleName(b.roles[me])}` : undefined} />
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      )}
      <InviteBox game={g} f={f} me={me} orders={orders} />
      <section className="flex flex-wrap gap-2 pt-1">
        <OrderButton order={{ type: 'factionLeave', nationId: me }} label={`Leave ${f.name}`} effect="Your divisions are your own: nothing to take back" tone="btn-red" />
      </section>
    </div>
  )
}

// ---- feed ----

const KIND_STYLE: Record<string, string> = { chat: 'border-[#64d2ff]/60', op: 'border-[#ff9f0a]/70', goal: 'border-[#30d158]/70', call: 'border-[#ffd60a]/70', level: 'border-[#bf5af2]/70', member: 'border-white/30' }

function FeedTab({ g, f, me }: { g: GameState; f: Faction; me: NationId }) {
  const [text, setText] = useState('')
  const lines = [...f.history].reverse()
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/14 bg-white/5 p-3 space-y-2" aria-label="Write to the bloc">
        <div className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={BLOC.chatMax} placeholder="Write to the bloc (everyone in it sees this)" aria-label="Message to the bloc" className="field flex-1 min-w-0 px-3 py-2 text-[15px]" />
          <OrderButton order={{ type: 'blocChat', nationId: me, text }} label="Send" tone="btn-primary" onDone={() => setText('')} />
        </div>
        {!isLive(g) && <p className="text-[12px] text-white/55">Turn games: your message is posted when the month ends.</p>}
      </section>
      <section className="space-y-1.5" aria-label="Feed">
        {lines.length === 0 && <p className="text-[13.5px] text-white/65">Nothing yet.</p>}
        {lines.map((h, i) => (
          <p key={i} className={`text-[13.5px] border-l-2 pl-2.5 py-0.5 ${KIND_STYLE[h.kind ?? ''] ?? 'border-white/15'}`}>
            <span className="text-white/55 tabular-nums mr-1.5">{turnDate(h.turn)}</span>
            {h.kind === 'chat' && h.by ? <span className="font-semibold text-[#8ec5ff] mr-1">{nm(g, h.by)}:</span> : null}
            {h.text}
          </p>
        ))}
      </section>
    </div>
  )
}

// ---- no bloc yet ----

function FoundBloc({ g, me }: { g: GameState; me: NationId }) {
  const [name, setName] = useState('')
  const others = [...(g.factions ?? [])].sort((a, b) => blocPower(g, b) - blocPower(g, a))
  return (
    <div className="space-y-5">
      <FactionNotices game={g} me={me} />
      <section className="rounded-2xl border border-white/14 bg-white/5 p-4 space-y-3">
        <h3 className="text-[20px] font-semibold tracking-tight">Form an alliance bloc</h3>
        <ul className="text-[14px] text-white/85 space-y-1.5 list-none">
          <li><span className="font-semibold text-[#8ec5ff]">Joint operations.</span> Pick a target and a D-Day; every member pledges divisions from its own army and they attack as one force, harder together.</li>
          <li><span className="font-semibold text-[#8ec5ff]">One click to war.</span> When a member goes to war the others are called in: Join or Decline.</li>
          <li><span className="font-semibold text-[#8ec5ff]">Season objectives.</span> Take new ground, hold the line, outmatch the rival bloc: prestige and influence when you do.</li>
          <li><span className="font-semibold text-[#8ec5ff]">Levels and perks.</span> Prestige unlocks a common market, shared research, mutual defence and joint production.</li>
          <li><span className="font-semibold text-[#8ec5ff]">Roles.</span> Arsenal, Shield, Breadbasket or Spymaster, each with its own bonus.</li>
        </ul>
        <label className="block space-y-1">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={FACTION.nameMax} placeholder="The Iron Pact" aria-label="Bloc name" className="field w-full px-3 py-2 text-[15px]" />
        </label>
        <OrderButton order={{ type: 'factionFound', nationId: me, name }} label="Found the bloc" cost={`${FACTION.foundInfluence} influence`} effect="It exists when the month ends; then invite others" tone="btn-primary" className="w-full" />
      </section>
      {others.length > 0 && (
        <section className="space-y-2" aria-label="Blocs in the world">
          <div className="label">Blocs in the world</div>
          {others.map((x) => (
            <div key={x.id} className="rounded-xl border border-white/12 bg-white/5 p-3 text-[14px] space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{x.name}</span>
                <span className="text-white/65 whitespace-nowrap">Lv {levelOf(blocOf(x).xp)} · {seatsUsed(g, x)} members · {num(blocPower(g, x))}</span>
              </div>
              <div className="text-white/75">{x.members.map((m) => nm(g, m)).join(', ')}</div>
              <OrderButton order={{ type: 'factionRequest', nationId: me, factionId: x.id }} label={`Ask to join ${x.name}`} cost={`${FACTION.requestInfluence} influence`} effect={x.members.some((m) => isPerson(g, m)) ? 'A member who is a player decides' : 'Its members answer when the month ends'} />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

/** The Bloc desk: the faction as an alliance with an objective, perks, roles, calls to arms and joint operations. */
export function BlocPanel() {
  const view = usePlayerView()
  const [tab, setTab] = useState<BlocTab>('overview')
  if (!view) return null
  const { game: g, orders } = view
  const me = g.playerId
  const f = factionOf(g, me)
  const b = blocOf(f)
  const due = f ? blocDue(g, me, orders) : 0
  const opsDue = f ? b.ops.filter((o) => o.status === 'planned' && !o.pledges[me] && atWar(g, me, g.regions[o.target]?.owner ?? '')).length : 0
  const rival = f ? rivalBloc(g, f) : null
  return (
    <PanelShell
      title="Bloc"
      kicker={f ? `${f.name} · level ${levelOf(b.xp)} · ${seatsUsed(g, f)} members${rival ? ` · rival: ${rival.name}` : ''}` : 'Form an alliance bloc: joint operations, objectives, perks and roles.'}
      panel="faction"
      tabs={
        f ? (
          <Tabs<BlocTab>
            value={tab}
            onChange={setTab}
            options={[['overview', due - opsDue > 0 ? `Overview (${due - opsDue})` : 'Overview'], ['operations', opsDue > 0 ? `Operations (${opsDue})` : 'Operations'], ['members', 'Members'], ['feed', 'Feed']] as const}
          />
        ) : undefined
      }
    >
      {!f && <FoundBloc g={g} me={me} />}
      {f && tab === 'overview' && (
        <div className="space-y-5">
          <Header g={g} f={f} me={me} />
          <Calls g={g} f={f} me={me} orders={orders} />
          <FactionNotices game={g} me={me} />
          <Objective g={g} f={f} me={me} />
          <WarsAndCall g={g} f={f} me={me} orders={orders} />
          <Scoreboard g={g} f={f} />
          <Perks f={f} />
        </div>
      )}
      {f && tab === 'operations' && <OperationsTab g={g} f={f} me={me} orders={orders} />}
      {f && tab === 'members' && <MembersTab g={g} f={f} me={me} orders={orders} />}
      {f && tab === 'feed' && <FeedTab g={g} f={f} me={me} />}
    </PanelShell>
  )
}
