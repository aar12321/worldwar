import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { coalitionActive, opinionLabel, opinionReport } from '../ai/opinion'
import { SECTOR_IDS, SECTORS } from '../data/business'
import { PERSONALITIES } from '../data/personalities'
import { ACT_GROUPS, ACTS, AID, FAVOUR_ASKS, PARTNER_PINS_KEY, RELATIONS, type ActGroup } from '../data/relations'
import { TECH_BY_ID } from '../data/techTree'
import { isLive } from '../engine/calendar'
import { enemiesOf, hasPact, isAllied, pairKey, turnDate } from '../engine/helpers'
import { embassyOf, favoursOwed, plansBetween, programsBetween } from '../engine/relations'
import { groupReasons, movement, partnerNeeds, partnerRows, partnerWants, previewRelate, relationHealth, type PartnerRow } from '../engine/relationsView'
import type { GameState, NationId, RelateAid, RelateOrder } from '../engine/types'
import { canAttackRegion } from '../engine/warfare'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { LocateButton } from './Locate'
import { OrderButton, PanelShell, Tabs } from './panel'
import { CostEffect } from './widgets'

const opinionColor = (v: number) => (v >= 25 ? '#34d399' : v >= 5 ? '#a7f3d0' : v > -5 ? '#94a3b8' : v > -25 ? '#fbbf24' : '#fb7185')
const sign = (v: number, digits = 0) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`

function loadPins(): string[] {
  try {
    const raw = localStorage.getItem(PARTNER_PINS_KEY)
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
function savePins(p: string[]) {
  try {
    localStorage.setItem(PARTNER_PINS_KEY, JSON.stringify(p))
  } catch {
    /* storage may be blocked */
  }
}

function SignedBar({ value }: { value: number }) {
  const color = opinionColor(value)
  const w = `${Math.min(100, Math.abs(value)) / 2}%`
  return (
    <div className="relative h-1.5 rounded-full bg-white/10 overflow-hidden" role="img" aria-label={`Opinion ${sign(value)}`}>
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
      <div className="absolute inset-y-0 rounded-full" style={{ width: w, background: color, ...(value >= 0 ? { left: '50%' } : { right: '50%' }) }} />
    </div>
  )
}

function Trend({ v }: { v: number }) {
  if (Math.abs(v) < 0.15) return <span className="text-white/45" title="Steady" aria-label="Steady">●</span>
  return v > 0 ? (
    <span className="text-[#6eeb8a]" title={`Rising about ${v.toFixed(1)} a month`} aria-label={`Rising ${v.toFixed(1)} a month`}>
      ▲ {v.toFixed(1)}
    </span>
  ) : (
    <span className="text-[#ffb35a]" title={`Falling about ${(-v).toFixed(1)} a month`} aria-label={`Falling ${(-v).toFixed(1)} a month`}>
      ▼ {(-v).toFixed(1)}
    </span>
  )
}

type Filter = 'all' | 'pinned' | 'allies' | 'neighbors' | 'rivals' | 'trade' | 'faction' | 'cooling'
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['pinned', 'Watchlist'],
  ['allies', 'Allies'],
  ['neighbors', 'Neighbors'],
  ['rivals', 'Rivals'],
  ['trade', 'Trade partners'],
  ['faction', 'My faction'],
  ['cooling', 'Cooling'],
]
type Sort = 'opinion' | 'name' | 'trend' | 'low'
const SORTS: [Sort, string][] = [
  ['opinion', 'Warmest'],
  ['low', 'Coolest'],
  ['trend', 'Falling fastest'],
  ['name', 'Name'],
]

function Param<T extends string | number>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[13px]">
      <span className="text-white/70">{label}</span>
      <select className="field px-2 py-1 text-[13px] max-w-[60%]" value={String(value)} aria-label={label} onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}>
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

/** One action: what it is, what it costs and does, why not if it cannot be done, and the button. */
function ActRow({ order, title, blurb, label, children }: { order: RelateOrder; title: string; blurb?: string; label?: string; children?: ReactNode }) {
  const view = usePlayerView()!
  const { map } = getWorld()
  const pv = previewRelate(view.game, map, order, view.orders)
  return (
    <div className="rounded-lg border border-white/12 bg-white/5 p-2.5 space-y-2" data-act={order.act}>
      <div>
        <div className="font-semibold text-[14px]">{title}</div>
        {blurb && <p className="text-[12px] text-white/65">{blurb}</p>}
      </div>
      {children}
      <CostEffect costs={pv.costs} effects={[...pv.effects, ...(pv.risk ? [<span key="risk" className="text-[#ffd60a]">{pv.risk}</span>] : [])]} why={pv.why} />
      <OrderButton order={order} label={label ?? title} tone="btn-primary" />
    </div>
  )
}

function GroupBox({ group, children, open }: { group: ActGroup; children: ReactNode; open?: boolean }) {
  const g = ACT_GROUPS.find((x) => x.id === group)!
  return (
    <details className="rounded-lg border border-white/10 bg-black/20" open={open}>
      <summary className="cursor-pointer px-3 py-2 text-[14px] font-semibold flex flex-col">
        {g.name}
        <span className="text-[12px] font-normal text-white/60">{g.blurb}</span>
      </summary>
      <div className="p-2 space-y-2">{children}</div>
    </details>
  )
}

/** Every action there is for one partner, in groups. */
function Actions({ id }: { id: NationId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const me = player.id
  const them = game.nations[id]
  const live = isLive(game)
  const [aidRes, setAidRes] = useState<RelateAid>('food')
  const [aidAmt, setAidAmt] = useState<number>(16)
  const [sector, setSector] = useState<(typeof SECTOR_IDS)[number]>('manufacturing')
  const [stake, setStake] = useState(60)
  const [apology, setApology] = useState(0)
  const [ask, setAsk] = useState<'money' | 'influence' | 'research'>('money')
  const sharedEnemies = enemiesOf(game, me).filter((e) => enemiesOf(game, id).includes(e))
  const [enemy, setEnemy] = useState<string>(sharedEnemies[0] ?? '')
  const [months, setMonths] = useState(RELATIONS.plan.months)
  const [split, setSplit] = useState(0.25)
  const [thirdParty, setThirdParty] = useState('')
  const [tech, setTech] = useState('')
  const [give, setGive] = useState('')
  const o = (act: RelateOrder['act'], extra: Partial<RelateOrder> = {}): RelateOrder => ({ type: 'relate', nationId: me, target: id, act, ...extra })
  const spec = (a: keyof typeof ACTS) => ACTS[a]!
  const plain = (a: keyof typeof ACTS, extra?: Partial<RelateOrder>) => <ActRow key={a} order={o(a, extra)} title={spec(a).name} blurb={spec(a).blurb} />

  const emb = embassyOf(game, me, id)
  const progs = programsBetween(game, me, id)
  const plans = plansBetween(game, me, id)
  const theirSanctions = game.sanctions.filter((x) => x.from === id && x.until >= game.turn).map((x) => x.to)
  const theirFoes = enemiesOf(game, id).filter((e) => e !== me)
  const techs = player.techs.filter((t) => !them.techs.includes(t) && TECH_BY_ID[t] && TECH_BY_ID[t].requires.every((q) => them.techs.includes(q)))
  const { map } = getWorld()
  const borderRegions = Object.values(game.regions).filter((r) => r.owner === me && r.id !== player.capital && map.regions[r.id]?.neighbors.some((n) => game.regions[n]?.owner === id))
  const debts = game.deals.filter((d) => d.to === me && d.from === id && (d.kind === 'loan' || d.kind === 'reparations'))
  const enemyOpts: [string, string][] = sharedEnemies.length ? sharedEnemies.map((e) => [e, game.nations[e].name]) : [['', 'No shared enemy']]
  const strikeOpts = (p: { enemy: string }) => Object.values(game.regions).filter((r) => r.owner === p.enemy && canAttackRegion(game, map, me, r.id).ok).slice(0, 30)
  const [win, setWin] = useState('')

  return (
    <div className="space-y-2">
      <GroupBox group="goodwill" open>
        {plain('visit')}
        {plain('culture')}
        {plain('festival')}
        {plain('support')}
      </GroupBox>
      <GroupBox group="presence">
        {!emb && plain('embassy')}
        {emb && !emb.attache && plain('attache')}
        {emb && <ActRow order={o('closeEmbassy')} title={`Close your embassy${emb.attache ? ' and attaché' : ''}`} blurb={`Open since ${turnDate(emb.since)}. Closing costs goodwill.`} label="Close it" />}
      </GroupBox>
      <GroupBox group="economy">
        {plain('tradeMission')}
        {plain('tariff')}
        {plain('students')}
        {plain('science')}
        <ActRow order={o('venture', { sector, amount: stake })} title={spec('venture').name} blurb={spec('venture').blurb}>
          <Param label="Sector" value={sector} onChange={setSector} options={SECTOR_IDS.map((s) => [s, `${SECTORS[s].name} (they have ${(them.sectors[s] ?? 0).toFixed(1)})`])} />
          <Param label="Each side puts in" value={stake} onChange={setStake} options={[30, 60, 100, 150, 200].map((v) => [v, String(v)])} />
        </ActRow>
        {progs.map((p) => (
          <ActRow key={p.id} order={o('endProgram', { id: p.id })} title={`End: ${p.kind === 'route' ? 'trade mission' : p.kind}`} blurb={`Runs until ${turnDate(p.until)}. Leaving early costs goodwill${p.kind === 'venture' ? ' and half your stake' : ''}.`} label="End it" />
        ))}
      </GroupBox>
      <GroupBox group="aid">
        <ActRow order={o('aid', { resource: aidRes, amount: aidAmt })} title="Aid in kind" blurb={spec('aid').blurb}>
          <Param label="Send" value={aidRes} onChange={setAidRes} options={[['food', 'Food'], ['oil', 'Oil'], ['steel', 'Steel']]} />
          <Param label="Amount" value={aidAmt} onChange={setAidAmt} options={AID.amounts.map((v) => [v, String(v)])} />
        </ActRow>
        {debts.map((d) => (
          <ActRow key={d.id} order={o('forgive', { id: d.id })} title={`Forgive their ${d.kind === 'loan' ? 'loan' : 'reparations'}`} blurb={spec('forgive').blurb} label="Forgive it" />
        ))}
        {techs.length > 0 && (
          <ActRow order={o('techShare', { techId: tech || techs[0] })} title="Share a technology" blurb={spec('techShare').blurb}>
            <Param label="Technology" value={tech || techs[0]} onChange={setTech} options={techs.slice(0, 20).map((t) => [t, TECH_BY_ID[t].name])} />
          </ActRow>
        )}
        {borderRegions.length > 0 && (
          <ActRow order={o('cede', { give: give || borderRegions[0].id })} title="Cede a border country" blurb={spec('cede').blurb}>
            <Param label="Country" value={give || borderRegions[0].id} onChange={setGive} options={borderRegions.map((r) => [r.id, map.regions[r.id].name])} />
          </ActRow>
        )}
      </GroupBox>
      <GroupBox group="military">
        {plain('exercise')}
        {plain('training')}
        {plain('intelShare')}
        {plain('basing')}
        {plain('armsSale')}
        {theirSanctions.map((e) => (
          <ActRow key={e} order={o('sanction', { enemy: e })} title={`Join their sanctions on ${game.nations[e]?.name}`} blurb={spec('sanction').blurb} />
        ))}
      </GroupBox>
      <GroupBox group="plans">
        {plans.map((p) => (
          <div key={p.id} className="rounded-lg border border-[#0a84ff]/40 bg-[#0a84ff]/8 p-2.5 space-y-2 text-[13px]">
            <div className="font-semibold">Joint war plan against {game.nations[p.enemy]?.name}</div>
            <p className="text-white/70">
              Until {turnDate(p.until)}. The partner who does not take a country is paid {Math.round(p.split * 100)}% of its value{p.paid ? ` (${Math.round(p.paid)} paid so far)` : ''}. Hit the same country in the same {live ? 'few days' : 'month'} for a combined strike.
              {p.strike ? ` Strike planned: ${map.regions[p.strike.region]?.name}, ${p.strike.turn === game.turn ? 'this month' : turnDate(p.strike.turn)}${p.strike.day !== undefined ? `, day ${p.strike.day + 1}` : ''}.` : ''}
            </p>
            <Param label="Strike" value={win || strikeOpts(p)[0]?.id || ''} onChange={setWin} options={strikeOpts(p).length ? strikeOpts(p).map((r) => [r.id, map.regions[r.id].name]) : [['', 'Nothing in reach']]} />
            <OrderButton order={o('strikeWindow', { id: p.id, region: win || strikeOpts(p)[0]?.id, months: live ? 1 : 0 })} label={live ? 'Plan a strike for next month' : 'Plan a strike this month'} effect="Your partner is told; a rival will send its army too" />
            <OrderButton order={o('endPlan', { id: p.id })} label="End the plan" tone="btn-quiet" effect="They will remember it" />
          </div>
        ))}
        <ActRow order={o('warPlan', { enemy, months, split })} title={spec('warPlan').name} blurb={spec('warPlan').blurb}>
          <Param label="Against" value={enemy} onChange={setEnemy} options={enemyOpts} />
          <Param label="Runs for" value={months} onChange={setMonths} options={[6, 12, 18, 24].map((v) => [v, `${v} months`])} />
          <Param label="Their share of the spoils" value={split} onChange={setSplit} options={[0.1, 0.25, 0.4, 0.5].map((v) => [v, `${Math.round(v * 100)}%`])} />
        </ActRow>
      </GroupBox>
      <GroupBox group="repair">
        <ActRow order={o('apology', { amount: apology })} title="Apologise" blurb={spec('apology').blurb}>
          <Param label="Compensation" value={apology} onChange={setApology} options={[0, 30, 60, 100].map((v) => [v, v ? String(v) : 'None'])} />
        </ActRow>
        {plain('recognise')}
        <ActRow order={o('mediate', { enemy: thirdParty || theirFoes[0] })} title="Mediate" blurb={spec('mediate').blurb}>
          <Param label="Between them and" value={thirdParty || theirFoes[0] || ''} onChange={setThirdParty} options={theirFoes.length ? theirFoes.map((e) => [e, game.nations[e].name]) : [['', 'Nobody at war with them']]} />
        </ActRow>
      </GroupBox>
      <GroupBox group="favours">
        <div className="text-[13px] text-white/75 px-1">
          They owe you {favoursOwed(game, id, me)} favour{favoursOwed(game, id, me) === 1 ? '' : 's'}; you owe them {favoursOwed(game, me, id)}.
        </div>
        <ActRow order={o('callFavour', { ask })} title="Call in a favour" blurb="Spend one favour they owe you. They think a little less of you for being asked.">
          <Param label="Ask for" value={ask} onChange={setAsk} options={(Object.keys(FAVOUR_ASKS) as (keyof typeof FAVOUR_ASKS)[]).map((k) => [k, `${FAVOUR_ASKS[k].name} (+${FAVOUR_ASKS[k].amount})`])} />
        </ActRow>
      </GroupBox>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="label">{title}</div>
      {children}
    </section>
  )
}

/** One partner: why they feel this way, where it is heading, what they need, and everything you can do. */
function PartnerCard({ id, pinned, togglePin, onBack }: { id: NationId; pinned: boolean; togglePin: () => void; onBack: () => void }) {
  const view = usePlayerView()!
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const { game, player } = view
  const { map } = getWorld()
  const n = game.nations[id]
  const me = player.id
  const human = game.humans.includes(id)
  const report = useMemo(() => (human ? null : opinionReport(game, map, id, me, { coalition: coalitionActive(game, map) })), [game, map, id, me, human])
  if (!n) return null
  const total = report?.total ?? 0
  const mv = movement(game, id, me)
  const health = relationHealth(game, me, id, total)
  const needs = partnerNeeds(game, map, id, me)
  const wants = partnerWants(game, id)
  const groups = report ? groupReasons(report) : []
  const log = (game.relations?.log ?? []).filter((e) => (e.a === me && e.b === id) || (e.a === id && e.b === me)).slice(-12).reverse()
  const status = isAllied(game, me, id) ? 'Ally' : hasPact(game, me, id) ? 'Pact' : game.wars.includes(pairKey(me, id)) ? 'At war' : 'At peace'
  const hColor = health.score >= 70 ? '#34d399' : health.score >= 45 ? '#fbbf24' : '#fb7185'
  return (
    <div className="space-y-4" data-partner={id}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button className="btn btn-quiet" onClick={onBack}>
          ← All nations
        </button>
        <div className="flex gap-1.5">
          <LocateButton id={id} />
          <button className="btn btn-quiet" aria-pressed={pinned} onClick={togglePin} title="Keep this partner on your watchlist">
            {pinned ? '★ Watching' : '☆ Watch'}
          </button>
          <button className="btn btn-quiet" onClick={() => openDiplomacy(id)} title="Treaties, offers, trade deals, loans and peace">
            Treaties and trade
          </button>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: n.color }} />
          <h3 className="text-[19px] font-semibold">{n.name}</h3>
          <span className="chip">{status}</span>
          <span className="chip" title={PERSONALITIES[n.personality ?? 'honorable'].description}>
            {PERSONALITIES[n.personality ?? 'honorable'].name}
          </span>
        </div>
      </div>
      {human ? (
        <p className="text-[13px] text-white/70">Another player runs this nation. They decide for themselves: send them an offer in Diplomacy.</p>
      ) : (
        <>
          <div className="rounded-lg border border-white/12 bg-white/5 p-3 space-y-2">
            <div className="flex justify-between text-[13px]">
              <span className="text-white/70">Their opinion of you</span>
              <span style={{ color: opinionColor(total) }}>
                {opinionLabel(total)} ({sign(total)}) <Trend v={mv.total} />
              </span>
            </div>
            <SignedBar value={total} />
            <div className="flex justify-between text-[13px]">
              <span className="text-white/70">Relationship health</span>
              <span style={{ color: hColor }}>
                {health.label} · {health.score}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden" role="img" aria-label={`Health ${health.score} of 100`}>
              <div className="h-full rounded-full" style={{ width: `${health.score}%`, background: hColor }} />
            </div>
            {health.warning && <p className="text-[13px] text-[#ffd60a]">⚠ {health.warning}</p>}
            {mv.movers.length > 0 && (
              <div className="text-[12px] text-white/70">
                Moving it each month:{' '}
                {mv.movers.slice(0, 5).map((m, i) => (
                  <span key={m.label}>
                    {i > 0 && ', '}
                    {m.label} <span className={m.value > 0 ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}>{sign(m.value, 1)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <Section title="Why they feel this way">
            {groups.length === 0 && <p className="text-[13px] text-white/60">No strong feelings either way.</p>}
            {groups.map((g) => (
              <details key={g.group} className="text-[13px] rounded border border-white/8 bg-black/20 px-2.5 py-1.5">
                <summary className="cursor-pointer flex justify-between gap-2">
                  <span>{g.group}</span>
                  <span className={g.total >= 0 ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}>{sign(g.total)}</span>
                </summary>
                <ul className="mt-1 space-y-0.5 text-[12px]">
                  {g.parts.map((p) => (
                    <li key={p.label} className="flex justify-between">
                      <span className="text-white/70">{p.label}</span>
                      <span className={p.value > 0 ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}>{sign(p.value)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </Section>
          <Section title="What they need and want">
            <ul className="text-[13px] space-y-1">
              {needs.map((x, i) => (
                <li key={i} className={x.level === 'dire' ? 'text-[#ff8a84]' : 'text-[#ffd60a]'}>
                  {x.level === 'dire' ? '! ' : '• '}
                  {x.text}
                </li>
              ))}
              {wants.map((x, i) => (
                <li key={`w${i}`} className="text-white/75">
                  ♥ {x.text}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Do something">
            <Actions id={id} />
          </Section>
          <Section title="History with them">
            {log.length === 0 && <p className="text-[13px] text-white/60">Nothing yet.</p>}
            {log.map((e, i) => (
              <p key={i} className="text-[12px] border-l-2 border-white/15 pl-2 text-white/75">
                <span className="text-white/50">{turnDate(e.turn)}: </span>
                {e.text}
              </p>
            ))}
          </Section>
        </>
      )}
    </div>
  )
}

function Row({ row, game, pinned, onOpen, onPin }: { row: PartnerRow; game: GameState; pinned: boolean; onOpen: () => void; onPin: () => void }) {
  const n = game.nations[row.id]
  const chips: [string, boolean][] = [['Ally', row.ally], ['Pact', row.pact && !row.ally], ['Trade', row.trade], ['Embassy', row.embassy], ['Faction', row.faction], ['Neighbor', row.neighbor], ['War', row.war]]
  return (
    <div className={`rounded-lg border p-2.5 flex items-center gap-2 ${row.war ? 'border-[#ff453a]/50 bg-[#ff453a]/6' : row.ally ? 'border-[#0a84ff]/40 bg-[#0a84ff]/8' : 'border-white/12 bg-white/5'}`} data-nation={row.id}>
      <button className="flex-1 min-w-0 text-left space-y-1" onClick={onOpen} aria-label={`Open ${n.name}`}>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: n.color }} />
          <span className="font-semibold truncate">{n.name}</span>
          <span className="ml-auto text-[12px] whitespace-nowrap" style={{ color: opinionColor(row.opinion) }}>
            {row.human ? 'Player' : `${row.label} ${sign(row.opinion)}`} {!row.human && <Trend v={row.trend} />}
          </span>
        </div>
        {!row.human && <SignedBar value={row.opinion} />}
        <div className="flex flex-wrap gap-1 text-[11px]">
          {chips.filter(([, on]) => on).map(([l]) => (
            <span key={l} className={`chip ${l === 'War' ? 'chip-red' : l === 'Ally' ? 'chip-blue' : ''}`}>
              {l}
            </span>
          ))}
          {row.favoursOwedToMe > 0 && <span className="chip chip-green">Owes you {row.favoursOwedToMe}</span>}
          {row.favoursIOwe > 0 && <span className="chip">You owe {row.favoursIOwe}</span>}
        </div>
      </button>
      <div className="flex flex-col gap-1 shrink-0">
        <button className="btn btn-quiet px-2 py-1 text-[12px]" aria-pressed={pinned} aria-label={pinned ? `Stop watching ${n.name}` : `Watch ${n.name}`} onClick={onPin}>
          {pinned ? '★' : '☆'}
        </button>
        <LocateButton id={row.id} label="" compact />
      </div>
    </div>
  )
}

function Requests({ game, me }: { game: GameState; me: NationId }) {
  const list = (game.relations?.requests ?? []).filter((q) => q.to === me)
  const open = useGame((s) => s.openRelations)
  if (!list.length) return <p className="text-[13px] text-white/65">No rival is waiting on you. Rivals that like you may ask for help, a trade mission, a joint venture or a place in a war plan. Answer before the deadline: ignoring a request costs goodwill.</p>
  return (
    <div className="space-y-2">
      {list.map((q) => (
        <div key={q.id} className="rounded-lg border border-[#ffd60a]/40 bg-[#ffd60a]/6 p-3 space-y-2" data-request={q.id}>
          <div className="flex items-center justify-between gap-2">
            <button className="font-semibold hover:underline" onClick={() => open(q.from)}>
              {game.nations[q.from]?.name}
            </button>
            <span className="text-[12px] text-white/65">{Math.max(0, q.expires - game.turn) + 1} months to answer</span>
          </div>
          <p className="text-[13px]">Asks you to {q.text}</p>
          <p className="text-[12px] text-white/60">Saying yes wins their thanks and a favour. Saying no costs a little goodwill; silence costs more.</p>
          <div className="flex gap-1.5 flex-wrap">
            <OrderButton order={{ type: 'relate', nationId: me, target: q.from, act: 'answer', id: q.id, accept: true }} label="Accept" tone="btn-primary" />
            <OrderButton order={{ type: 'relate', nationId: me, target: q.from, act: 'answer', id: q.id, accept: false }} label="Decline" tone="btn-quiet" />
            <LocateButton id={q.from} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Running({ game, me, open }: { game: GameState; me: NationId; open: (id: NationId) => void }) {
  const r = game.relations
  const nm = (id: string) => game.nations[id]?.name ?? id
  const embassies = (r?.embassies ?? []).filter((e) => e.from === me)
  const programs = (r?.programs ?? []).filter((p) => p.a === me || p.b === me)
  const plans = (r?.plans ?? []).filter((p) => p.a === me || p.b === me)
  const upkeep = embassies.reduce((n, e) => n + (ACTS.embassy?.upkeep ?? 0) + (e.attache ? (ACTS.attache?.upkeep ?? 0) : 0), 0)
  const owed = Object.entries(r?.favours ?? {}).flatMap(([k, list]) => list.filter((u) => u >= game.turn).map(() => k.split('>')))
  const toMe = owed.filter(([, c]) => c === me)
  const byMe = owed.filter(([d]) => d === me)
  const Link = ({ id }: { id: string }) => (
    <button className="hover:underline font-semibold" onClick={() => open(id)}>
      {nm(id)}
    </button>
  )
  return (
    <div className="space-y-4">
      <Section title={`Embassies (${embassies.length}) · ${upkeep.toFixed(1)} money a month`}>
        {embassies.length === 0 && <p className="text-[13px] text-white/60">None. An embassy warms a nation slowly, shows you their numbers and opens joint programs.</p>}
        {embassies.map((e) => (
          <p key={e.to} className="text-[13px]">
            <Link id={e.to} /> · since {turnDate(e.since)}
            {e.attache ? ' · with a military attaché' : ''}
          </p>
        ))}
      </Section>
      <Section title={`Programs and ventures (${programs.length})`}>
        {programs.length === 0 && <p className="text-[13px] text-white/60">None running.</p>}
        {programs.map((p) => (
          <p key={p.id} className="text-[13px]">
            <Link id={p.a === me ? p.b : p.a} /> · {p.kind === 'route' ? 'trade mission' : p.kind}
            {p.kind === 'venture' ? ` (${Math.round(p.stake ?? 0)} each in ${p.sector ? SECTORS[p.sector].name.toLowerCase() : 'business'})` : ''} · until {turnDate(p.until)}
          </p>
        ))}
      </Section>
      <Section title={`Joint war plans (${plans.length})`}>
        {plans.length === 0 && <p className="text-[13px] text-white/60">None. You need a friend who fights the same enemy.</p>}
        {plans.map((p) => (
          <p key={p.id} className="text-[13px]">
            With <Link id={p.a === me ? p.b : p.a} /> against {nm(p.enemy)} · until {turnDate(p.until)}
          </p>
        ))}
      </Section>
      <Section title="Favours">
        <p className="text-[13px]">
          Owed to you: {toMe.length ? toMe.map(([d], i) => <span key={i}>{i > 0 && ', '}<Link id={d} /></span>) : 'none'}
        </p>
        <p className="text-[13px]">
          You owe: {byMe.length ? byMe.map(([, c], i) => <span key={i}>{i > 0 && ', '}<Link id={c} /></span>) : 'none'}
        </p>
      </Section>
    </div>
  )
}

export function RelationsPanel() {
  const view = usePlayerView()
  const focus = useGame((s) => s.relFocus)
  const openRelations = useGame((s) => s.openRelations)
  const locate = useGame((s) => s.locateNation)
  const [tab, setTab] = useState<'partners' | 'requests' | 'running' | 'log'>('partners')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('opinion')
  const [pins, setPins] = useState<string[]>(loadPins)
  const game = view?.game
  const rows = useMemo(() => {
    if (!game) return []
    const { map } = getWorld()
    return partnerRows(game, map, game.playerId, { coalition: coalitionActive(game, map) })
  }, [game])
  // Shift+L shows the open partner on the map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key === 'L' && e.shiftKey && focus && !(t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))) {
        e.preventDefault()
        locate(focus)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, locate])
  if (!view || !game) return null
  const me = view.player.id
  const requests = (game.relations?.requests ?? []).filter((x) => x.to === me)
  const togglePin = (id: string) => {
    const next = pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id]
    setPins(next)
    savePins(next)
  }
  const text = q.trim().toLowerCase()
  const shown = rows
    .filter((r) => !text || game.nations[r.id].name.toLowerCase().includes(text))
    .filter((r) => {
      switch (filter) {
        case 'pinned': return pins.includes(r.id)
        case 'allies': return r.ally || r.pact
        case 'neighbors': return r.neighbor
        case 'rivals': return r.war || (!r.human && r.opinion <= -10)
        case 'trade': return r.trade
        case 'faction': return r.faction
        case 'cooling': return !r.human && r.trend <= -0.3
        default: return true
      }
    })
    .sort((a, b) => {
      const byName = game.nations[a.id].name < game.nations[b.id].name ? -1 : 1
      if (sort === 'name') return byName
      if (sort === 'low') return a.opinion - b.opinion || byName
      if (sort === 'trend') return a.trend - b.trend || byName
      return b.opinion - a.opinion || byName
    })
  const pinnedFirst = [...shown.filter((r) => pins.includes(r.id)), ...shown.filter((r) => !pins.includes(r.id))]
  const cooling = rows.filter((r) => !r.human && r.trend <= -0.3 && (r.ally || r.pact || r.trade || r.embassy)).length
  const kicker = `${rows.filter((r) => r.ally).length} allies · ${view.player.resources.pp.toFixed(0)} influence · ${requests.length} request${requests.length === 1 ? '' : 's'}${cooling ? ` · ${cooling} partner${cooling === 1 ? '' : 's'} cooling` : ''}`
  return (
    <PanelShell
      title="Relations"
      kicker={kicker}
      panel="relations"
      wide
      tabs={<Tabs value={tab} onChange={(t) => { if (focus) openRelations(null); setTab(t) }} options={[['partners', 'Nations'], ['requests', 'Requests'], ['running', 'Running'], ['log', 'Log']] as const} badges={{ requests: requests.length || null }} />}
    >
      {tab === 'partners' && focus && game.nations[focus] && <PartnerCard id={focus} pinned={pins.includes(focus)} togglePin={() => togglePin(focus)} onBack={() => openRelations(null)} />}
      {tab === 'partners' && !(focus && game.nations[focus]) && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <input className="field px-3 py-2 text-[14px] flex-1 min-w-[160px]" type="search" placeholder="Search nations" aria-label="Search nations" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="field px-2 py-2 text-[14px]" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  Sort: {l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Filters">
            {FILTERS.map(([v, l]) => (
              <button key={v} className={`btn btn-quiet px-2.5 py-1 text-[12px] ${filter === v ? 'bg-[#0a84ff]/25' : ''}`} aria-pressed={filter === v} onClick={() => setFilter(v)}>
                {l}
                {v === 'pinned' && pins.length ? ` (${pins.length})` : ''}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-white/55">{pinnedFirst.length} nation{pinnedFirst.length === 1 ? '' : 's'}. Tap one to see why they feel as they do and everything you can do. Opinions of you only; relations cool on their own unless you keep them up.</p>
          <div className="space-y-2">
            {pinnedFirst.slice(0, 80).map((r) => (
              <Row key={r.id} row={r} game={game} pinned={pins.includes(r.id)} onOpen={() => openRelations(r.id)} onPin={() => togglePin(r.id)} />
            ))}
            {pinnedFirst.length > 80 && <p className="text-[12px] text-white/55">Showing the first 80. Search or filter to narrow it down.</p>}
            {pinnedFirst.length === 0 && <p className="text-[13px] text-white/60">No nation matches.</p>}
          </div>
        </div>
      )}
      {tab === 'requests' && <Requests game={game} me={me} />}
      {tab === 'running' && <Running game={game} me={me} open={(id) => { setTab('partners'); openRelations(id) }} />}
      {tab === 'log' && (
        <div className="space-y-1.5">
          {(game.relations?.log ?? []).filter((e) => e.a === me || e.b === me).slice(-60).reverse().map((e, i) => (
            <p key={i} className="text-[12px] border-l-2 border-white/15 pl-2 text-white/80">
              <span className="text-white/50">{turnDate(e.turn)}: </span>
              {e.text}
            </p>
          ))}
          {!(game.relations?.log ?? []).some((e) => e.a === me || e.b === me) && <p className="text-[13px] text-white/60">Nothing yet. Every visit, embassy, aid and plan is written here.</p>}
        </div>
      )}
    </PanelShell>
  )
}

