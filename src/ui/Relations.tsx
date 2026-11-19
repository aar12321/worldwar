import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { coalitionActive, nationNeighbors, opinionLabel, opinionReport } from '../ai/opinion'
import { SECTOR_IDS, SECTORS } from '../data/business'
import { PERSONALITIES } from '../data/personalities'
import { ACT_GROUPS, ACTS, AID, FAVOUR_ASKS, PARTNER_PINS_KEY, RELATIONS, type ActGroup } from '../data/relations'
import { TECH_BY_ID } from '../data/techTree'
import { isLive } from '../engine/calendar'
import { factionOf } from '../engine/factions'
import { enemiesOf, hasPact, isAllied, pairKey, turnDate } from '../engine/helpers'
import { showPower } from '../engine/intel'
import { embassyOf, favoursOwed, plansBetween, programsBetween } from '../engine/relations'
import { groupReasons, movement, partnerNeeds, partnerRows, partnerWants, previewRelate, relationHealth, TIER_ORDER, TIER_TEXT, topReasons, type PartnerRow, type RelTier } from '../engine/relationsView'
import { trustReport, type TrustReport } from '../engine/ties'
import type { GameState, NationId, RelateAct, RelateAid, RelateOrder } from '../engine/types'
import { canAttackRegion } from '../engine/warfare'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { LocateButton } from './Locate'
import { OrderButton, PanelShell, Tabs } from './panel'

/**
 * The Relations desk (O): find a nation fast, see where you stand with it and why, and do something about it.
 * Treaties, trade deals, loans and investment live in Diplomacy; this desk links there rather than repeating them.
 * Layout: on a wide screen a list (search, sort, filter chips, grouped by where they stand) beside the open nation; on a phone, one then the other.
 */

const GOOD = '#6eeb8a'
const BAD = '#ff8a84'
const opinionColor = (v: number) => (v >= 25 ? '#34d399' : v >= 5 ? '#a7f3d0' : v > -5 ? '#94a3b8' : v > -25 ? '#fbbf24' : '#fb7185')
const trustColor = (v: number) => (v >= 57 ? '#34d399' : v >= 43 ? '#94a3b8' : v >= 25 ? '#fbbf24' : '#fb7185')
const sign = (v: number, digits = 0) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`
const TIER_COLOR: Record<RelTier, string> = { war: '#ff453a', ally: '#0a84ff', friendly: '#34d399', neutral: '#94a3b8', wary: '#fbbf24', hostile: '#fb7185' }

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

// ---- small pieces ---------------------------------------------------------------------------------------------------------

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

function Trend({ v, long = false }: { v: number; long?: boolean }) {
  if (Math.abs(v) < 0.15) return <span className="text-white/45" title="Steady" aria-label="Steady">{long ? '● steady' : '●'}</span>
  const up = v > 0
  return (
    <span className={up ? 'text-[#6eeb8a]' : 'text-[#ffb35a]'} title={`${up ? 'Rising' : 'Falling'} about ${Math.abs(v).toFixed(1)} a month`} aria-label={`${up ? 'Rising' : 'Falling'} ${Math.abs(v).toFixed(1)} a month`}>
      {up ? '▲' : '▼'} {Math.abs(v).toFixed(1)}
      {long ? '/mo' : ''}
    </span>
  )
}

function Param<T extends string | number>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[13px]">
      <span className="text-white/70">{label}</span>
      <select className="field px-2 py-1 text-[13px] max-w-[62%]" value={String(value)} aria-label={label} onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}>
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

const Dot = ({ color }: { color: string }) => <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} aria-hidden />

// ---- actions --------------------------------------------------------------------------------------------------------------

/** One action, compact: name, what it does (or why not), what it costs, and the button. Settings for it sit underneath. */
function ActRow({ order, title, blurb, label, children }: { order: RelateOrder; title: string; blurb?: string; label?: string; children?: ReactNode }) {
  const view = usePlayerView()!
  const { map } = getWorld()
  const pv = previewRelate(view.game, map, order, view.orders)
  const cost = pv.costs.length ? pv.costs.map((c) => `${Math.round(c.amount)} ${c.label}`).join(' · ') : 'Free'
  const short = pv.costs.find((c) => c.have !== undefined && c.amount > c.have)
  return (
    <div className={`rounded-lg border px-3 py-2.5 space-y-2 ${pv.why ? 'border-white/8 bg-white/[0.02]' : 'border-white/12 bg-white/5'}`} data-act={order.act}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[14px]" title={blurb}>
            {title}
          </div>
          {pv.why ? (
            <p className="text-[12px] text-[#ffd60a]">{pv.why}</p>
          ) : (
            <p className="text-[12px] text-white/70">{pv.effects.join(' · ')}</p>
          )}
          {!pv.why && pv.risk && <p className="text-[12px] text-[#ffd60a]/90">{pv.risk}</p>}
          <p className={`text-[12px] tabular-nums ${short ? 'text-[#ff8a84]' : 'text-white/50'}`}>{cost}</p>
        </div>
        {pv.why ? (
          // The reason is already on the row; a plain disabled button does not repeat it.
          <button className="btn btn-quiet shrink-0" disabled aria-label={`${title}: ${pv.why}`}>
            {label ?? 'Do it'}
          </button>
        ) : (
          <OrderButton order={order} label={label ?? 'Do it'} tone="btn-primary" className="shrink-0" />
        )}
      </div>
      {children && <div className="space-y-1.5">{children}</div>}
    </div>
  )
}

function GroupBox({ group, available, total, children, open }: { group: ActGroup; available: number; total: number; children: ReactNode; open?: boolean }) {
  const g = ACT_GROUPS.find((x) => x.id === group)!
  return (
    <details className="rounded-lg border border-white/10 bg-black/20 group" open={open} data-group={group}>
      <summary className="cursor-pointer px-3 py-2 flex items-center justify-between gap-2 list-none">
        <span className="min-w-0">
          <span className="text-[14px] font-semibold">{g.name}</span>
          <span className="block text-[12px] text-white/55 truncate">{g.blurb}</span>
        </span>
        <span className={`text-[12px] whitespace-nowrap ${available ? 'text-[#6eeb8a]' : 'text-white/45'}`}>
          {available} of {total} open
        </span>
      </summary>
      <div className="p-2 pt-0 space-y-2">{children}</div>
    </details>
  )
}

/** Every relationship action for one nation, in groups, with what is open now counted, and the best few suggested first. */
function Actions({ id, focusAct }: { id: NationId; focusAct: RelateAct | null }) {
  const view = usePlayerView()!
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const { game, player } = view
  const me = player.id
  const them = game.nations[id]
  const live = isLive(game)
  const { map } = getWorld()
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
  const [win, setWin] = useState('')
  const o = (act: RelateOrder['act'], extra: Partial<RelateOrder> = {}): RelateOrder => ({ type: 'relate', nationId: me, target: id, act, ...extra })
  const spec = (a: keyof typeof ACTS) => ACTS[a]!

  const emb = embassyOf(game, me, id)
  const progs = programsBetween(game, me, id)
  const plans = plansBetween(game, me, id)
  const theirSanctions = game.sanctions.filter((x) => x.from === id && x.until >= game.turn).map((x) => x.to)
  const theirFoes = enemiesOf(game, id).filter((e) => e !== me)
  const techs = player.techs.filter((t) => !them.techs.includes(t) && TECH_BY_ID[t] && TECH_BY_ID[t].requires.every((q) => them.techs.includes(q)))
  const borderRegions = Object.values(game.regions).filter((r) => r.owner === me && r.id !== player.capital && map.regions[r.id]?.neighbors.some((n) => game.regions[n]?.owner === id))
  const debts = game.deals.filter((d) => d.to === me && d.from === id && (d.kind === 'loan' || d.kind === 'reparations'))
  const enemyOpts: [string, string][] = sharedEnemies.length ? sharedEnemies.map((e) => [e, game.nations[e].name]) : [['', 'No shared enemy']]
  const strikeOpts = (p: { enemy: string }) => Object.values(game.regions).filter((r) => r.owner === p.enemy && canAttackRegion(game, map, me, r.id).ok).slice(0, 30)

  // Each group's entries, as [order, row] so what is open now can be counted and the best suggested.
  type Entry = { order: RelateOrder; node: ReactNode }
  const plain = (a: keyof typeof ACTS, extra?: Partial<RelateOrder>): Entry => ({ order: o(a, extra), node: <ActRow key={a} order={o(a, extra)} title={spec(a).name} blurb={spec(a).blurb} /> })
  const groups: { group: ActGroup; entries: Entry[]; extra?: ReactNode }[] = [
    { group: 'goodwill', entries: [plain('visit'), plain('culture'), plain('festival'), plain('support')] },
    {
      group: 'presence',
      entries: [
        ...(!emb ? [plain('embassy')] : []),
        ...(emb && !emb.attache ? [plain('attache')] : []),
        ...(emb ? [{ order: o('closeEmbassy'), node: <ActRow key="close" order={o('closeEmbassy')} title={`Close your embassy${emb.attache ? ' and attaché' : ''}`} blurb={`Open since ${turnDate(emb.since)}. Closing costs goodwill.`} label="Close it" /> }] : []),
      ],
    },
    {
      group: 'economy',
      entries: [
        plain('tradeMission'),
        plain('tariff'),
        plain('students'),
        plain('science'),
        {
          order: o('venture', { sector, amount: stake }),
          node: (
            <ActRow key="venture" order={o('venture', { sector, amount: stake })} title={spec('venture').name} blurb={spec('venture').blurb}>
              <Param label="Sector" value={sector} onChange={setSector} options={SECTOR_IDS.map((s) => [s, `${SECTORS[s].name} (they have ${(them.sectors[s] ?? 0).toFixed(1)})`])} />
              <Param label="Each side puts in" value={stake} onChange={setStake} options={[30, 60, 100, 150, 200].map((v) => [v, String(v)])} />
            </ActRow>
          ),
        },
        ...progs.map((p) => ({ order: o('endProgram', { id: p.id }), node: <ActRow key={p.id} order={o('endProgram', { id: p.id })} title={`End: ${p.kind === 'route' ? 'trade mission' : p.kind === 'venture' ? 'joint venture' : p.kind}`} blurb={`Runs until ${turnDate(p.until)}. Leaving early costs goodwill${p.kind === 'venture' ? ' and half your stake' : ''}.`} label="End it" /> })),
      ],
    },
    {
      group: 'aid',
      entries: [
        {
          order: o('aid', { resource: aidRes, amount: aidAmt }),
          node: (
            <ActRow key="aid" order={o('aid', { resource: aidRes, amount: aidAmt })} title="Aid in kind" blurb={spec('aid').blurb}>
              <Param label="Send" value={aidRes} onChange={setAidRes} options={[['food', 'Food'], ['oil', 'Oil'], ['steel', 'Steel']]} />
              <Param label="Amount" value={aidAmt} onChange={setAidAmt} options={AID.amounts.map((v) => [v, String(v)])} />
            </ActRow>
          ),
        },
        ...debts.map((d) => ({ order: o('forgive', { id: d.id }), node: <ActRow key={d.id} order={o('forgive', { id: d.id })} title={`Forgive their ${d.kind === 'loan' ? 'loan' : 'reparations'}`} blurb={`${spec('forgive').blurb} Unlike cancelling it in Diplomacy, this also earns a favour.`} label="Forgive it" /> })),
        ...(techs.length
          ? [
              {
                order: o('techShare', { techId: tech || techs[0] }),
                node: (
                  <ActRow key="tech" order={o('techShare', { techId: tech || techs[0] })} title="Share a technology" blurb={spec('techShare').blurb}>
                    <Param label="Technology" value={tech || techs[0]} onChange={setTech} options={techs.slice(0, 20).map((t) => [t, TECH_BY_ID[t].name])} />
                  </ActRow>
                ),
              },
            ]
          : []),
        ...(borderRegions.length
          ? [
              {
                order: o('cede', { give: give || borderRegions[0].id }),
                node: (
                  <ActRow key="cede" order={o('cede', { give: give || borderRegions[0].id })} title="Cede a border country" blurb={spec('cede').blurb}>
                    <Param label="Country" value={give || borderRegions[0].id} onChange={setGive} options={borderRegions.map((r) => [r.id, map.regions[r.id].name])} />
                  </ActRow>
                ),
              },
            ]
          : []),
      ],
    },
    {
      group: 'military',
      entries: [plain('exercise'), plain('training'), plain('intelShare'), plain('basing'), plain('armsSale'), ...theirSanctions.map((e) => ({ order: o('sanction', { enemy: e }), node: <ActRow key={e} order={o('sanction', { enemy: e })} title={`Join their sanctions on ${game.nations[e]?.name}`} blurb={spec('sanction').blurb} /> }))],
    },
    {
      group: 'plans',
      entries: [
        {
          order: o('warPlan', { enemy, months, split }),
          node: (
            <ActRow key="plan" order={o('warPlan', { enemy, months, split })} title={spec('warPlan').name} blurb={spec('warPlan').blurb}>
              <Param label="Against" value={enemy} onChange={setEnemy} options={enemyOpts} />
              <Param label="Runs for" value={months} onChange={setMonths} options={[6, 12, 18, 24].map((v) => [v, `${v} months`])} />
              <Param label="Their share of the spoils" value={split} onChange={setSplit} options={[0.1, 0.25, 0.4, 0.5].map((v) => [v, `${Math.round(v * 100)}%`])} />
            </ActRow>
          ),
        },
      ],
      extra: plans.map((p) => (
        <div key={p.id} className="rounded-lg border border-[#0a84ff]/40 bg-[#0a84ff]/8 p-2.5 space-y-2 text-[13px]">
          <div className="font-semibold">Joint war plan against {game.nations[p.enemy]?.name}</div>
          <p className="text-white/70">
            Until {turnDate(p.until)}. The partner who does not take a country is paid {Math.round(p.split * 100)}% of its value{p.paid ? ` (${Math.round(p.paid)} paid so far)` : ''}. Hit the same country in the same {live ? 'few days' : 'month'} for a combined strike.
            {p.strike ? ` Strike planned: ${map.regions[p.strike.region]?.name}, ${p.strike.turn === game.turn ? 'this month' : turnDate(p.strike.turn)}${p.strike.day !== undefined ? `, day ${p.strike.day + 1}` : ''}.` : ''}
          </p>
          <Param label="Strike" value={win || strikeOpts(p)[0]?.id || ''} onChange={setWin} options={strikeOpts(p).length ? strikeOpts(p).map((r) => [r.id, map.regions[r.id].name]) : [['', 'Nothing in reach']]} />
          <div className="flex gap-1.5 flex-wrap">
            <OrderButton order={o('strikeWindow', { id: p.id, region: win || strikeOpts(p)[0]?.id, months: live ? 1 : 0 })} label={live ? 'Plan a strike for next month' : 'Plan a strike this month'} effect="Your partner is told; a rival will send its army too" />
            <OrderButton order={o('endPlan', { id: p.id })} label="End the plan" tone="btn-quiet" effect="They will remember it" />
          </div>
        </div>
      )),
    },
    {
      group: 'repair',
      entries: [
        {
          order: o('apology', { amount: apology }),
          node: (
            <ActRow key="apology" order={o('apology', { amount: apology })} title="Apologise" blurb={spec('apology').blurb}>
              <Param label="Compensation" value={apology} onChange={setApology} options={[0, 30, 60, 100].map((v) => [v, v ? String(v) : 'None'])} />
            </ActRow>
          ),
        },
        plain('recognise'),
        {
          order: o('mediate', { enemy: thirdParty || theirFoes[0] }),
          node: (
            <ActRow key="mediate" order={o('mediate', { enemy: thirdParty || theirFoes[0] })} title="Mediate" blurb={spec('mediate').blurb}>
              <Param label="Between them and" value={thirdParty || theirFoes[0] || ''} onChange={setThirdParty} options={theirFoes.length ? theirFoes.map((e) => [e, game.nations[e].name]) : [['', 'Nobody at war with them']]} />
            </ActRow>
          ),
        },
      ],
    },
    {
      group: 'favours',
      entries: [
        {
          order: o('callFavour', { ask }),
          node: (
            <ActRow key="favour" order={o('callFavour', { ask })} title="Call in a favour" blurb="Spend one favour they owe you. They think a little less of you for being asked.">
              <Param label="Ask for" value={ask} onChange={setAsk} options={(Object.keys(FAVOUR_ASKS) as (keyof typeof FAVOUR_ASKS)[]).map((k) => [k, `${FAVOUR_ASKS[k].name} (+${FAVOUR_ASKS[k].amount})`])} />
            </ActRow>
          ),
        },
      ],
      extra: (
        <p className="text-[13px] text-white/70 px-1">
          They owe you {favoursOwed(game, id, me)} favour{favoursOwed(game, id, me) === 1 ? '' : 's'}; you owe them {favoursOwed(game, me, id)}.
        </p>
      ),
    },
  ]
  const open = (e: Entry) => !previewRelate(game, map, e.order, view.orders).why
  // Suggested: what they need first, then a warm gesture, among what can be done now. Bookkeeping (closing, ending) is never suggested.
  const needs = partnerNeeds(game, map, id, me).map((n) => n.act)
  const wants = partnerWants(game, id).map((n) => n.act)
  const all = groups.flatMap((g) => g.entries).filter((e) => !['closeEmbassy', 'endProgram', 'endPlan', 'callFavour', 'forgive', 'cede'].includes(e.order.act))
  const rank = (e: Entry) => (needs.includes(e.order.act) ? 0 : wants.includes(e.order.act) ? 1 : e.order.act === 'embassy' ? 2 : ['visit', 'culture', 'tradeMission'].includes(e.order.act) ? 3 : 4)
  const suggested = all.filter(open).sort((a, b) => rank(a) - rank(b)).slice(0, 3)
  const focusGroup = focusAct ? ACTS[focusAct]?.group : undefined

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-white/75 min-w-0">Trade deals, investment, loans, pacts and alliances are agreed in Diplomacy.</p>
        <button className="btn" onClick={() => openDiplomacy(id)}>
          Open in Diplomacy →
        </button>
      </div>
      {suggested.length > 0 && (
        <section className="space-y-2" aria-label="Suggested">
          <div className="label">Suggested now</div>
          {suggested.map((e) => (
            <div key={`s-${e.order.act}`}>{e.node}</div>
          ))}
        </section>
      )}
      <section className="space-y-2" aria-label="All actions">
        <div className="label">All actions</div>
        {groups.map((g) => (
          <GroupBox key={g.group} group={g.group} available={g.entries.filter(open).length} total={g.entries.length} open={focusGroup === g.group}>
            {g.extra}
            {g.entries.map((e) => e.node)}
          </GroupBox>
        ))}
      </section>
    </div>
  )
}

// ---- one nation -----------------------------------------------------------------------------------------------------------

function TrustMeter({ trust }: { trust: TrustReport }) {
  return (
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden" role="img" aria-label={`Trust ${trust.total} of 100`}>
      <div className="h-full rounded-full" style={{ width: `${trust.total}%`, background: trustColor(trust.total) }} />
    </div>
  )
}

type DetailTab = 'why' | 'act' | 'history'

/** One nation: the headline (where you stand, which way it is going, the three biggest reasons), then why, what to do, and the history. */
function PartnerCard({ id, pinned, togglePin, onBack }: { id: NationId; pinned: boolean; togglePin: () => void; onBack: () => void }) {
  const view = usePlayerView()!
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const setPanel = useGame((s) => s.setPanel)
  const { game, player } = view
  const { map } = getWorld()
  const n = game.nations[id]
  const me = player.id
  const human = game.humans.includes(id) || !!n?.isPlayer
  // The parent keys this card by nation, so a new nation starts on 'Why' with nothing focused.
  const [tab, setTab] = useState<DetailTab>('why')
  const [focusAct, setFocusAct] = useState<RelateAct | null>(null)
  // Opening a nation starts at its top, wherever the list was scrolled to.
  const top0 = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Braces matter: newer browsers return a promise from scrollIntoView, and an effect may only return a clean-up function.
    top0.current?.scrollIntoView({ block: 'start' })
  }, [])
  const borders = useMemo(() => nationNeighbors(game, map, me).has(id), [game, map, me, id])
  const report = useMemo(() => (human ? null : opinionReport(game, map, id, me, { coalition: coalitionActive(game, map), borders })), [game, map, id, me, human, borders])
  const trust = useMemo(() => (human ? null : trustReport(game, id, me, { borders })), [game, id, me, human, borders])
  if (!n) return null
  const total = report?.total ?? 0
  const mv = movement(game, id, me, borders)
  const health = relationHealth(game, me, id, total)
  const needs = partnerNeeds(game, map, id, me)
  const wants = partnerWants(game, id)
  const groups = report ? groupReasons(report) : []
  const top = report ? topReasons(report) : []
  const log = (game.relations?.log ?? []).filter((e) => (e.a === me && e.b === id) || (e.a === id && e.b === me)).slice(-20).reverse()
  const war = game.wars.includes(pairKey(me, id))
  const status = isAllied(game, me, id) ? 'Ally' : hasPact(game, me, id) ? 'Pact' : war ? 'At war' : 'At peace'
  const bloc = factionOf(game, id)
  const persona = PERSONALITIES[n.personality ?? 'honorable']
  const act = (a?: RelateAct) => {
    setFocusAct(a ?? null)
    setTab('act')
  }
  return (
    <div className="space-y-4" data-partner={id} ref={top0}>
      <div className="flex items-center justify-between gap-1">
        <button className="btn btn-quiet px-2 lg:hidden" onClick={onBack} aria-label="Back to all nations">
          ← Nations
        </button>
        <div className="flex gap-1 ml-auto">
          <LocateButton id={id} className="px-2" />
          <button className="btn btn-quiet px-2" aria-pressed={pinned} onClick={togglePin} title="Keep this nation on your watchlist">
            {pinned ? '★ Watching' : '☆ Watch'}
          </button>
          <button className="btn btn-quiet px-2" onClick={() => openDiplomacy(id)} title="Treaties, trade deals, loans, investment, sanctions and peace">
            Diplomacy →
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: n.color }} />
        <h3 className="text-[20px] font-semibold tracking-tight">{n.name}</h3>
        <span className={`chip ${war ? 'chip-red' : status === 'Ally' ? 'chip-blue' : status === 'Pact' ? 'chip-green' : ''}`}>{status}</span>
        {human && <span className="chip chip-blue">Player</span>}
        {!human && (
          <span className="chip" title={persona.description}>
            {persona.name}
          </span>
        )}
        {bloc && (
          <button className="chip chip-blue hover:underline" onClick={() => setPanel('faction')} title="Open the Bloc desk">
            {bloc.name}
          </button>
        )}
      </div>
      {human ? (
        <p className="text-[13px] text-white/70">Another player runs this nation. They decide for themselves: send them an offer in Diplomacy.</p>
      ) : (
        <>
          <div className="rounded-xl border border-white/12 bg-white/5 p-3.5 space-y-3" data-headline>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="text-[12px] text-white/60">Their opinion of you</div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[24px] font-semibold tabular-nums leading-none" style={{ color: opinionColor(total) }}>
                    {sign(total)}
                  </span>
                  <span className="text-[14px]" style={{ color: opinionColor(total) }}>
                    {opinionLabel(total)}
                  </span>
                  <span className="text-[12px]">
                    <Trend v={mv.total} long />
                  </span>
                </div>
                <SignedBar value={total} />
              </div>
              {trust && (
                <div className="space-y-1.5 min-w-0" title="Whether they expect you to keep your word: treaties kept, steady trade, deals honoured; broken promises, spies and aggression count against you">
                  <div className="text-[12px] text-white/60">Their trust in you</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[24px] font-semibold tabular-nums leading-none" style={{ color: trustColor(trust.total) }}>
                      {trust.total}
                    </span>
                    <span className="text-[14px]" style={{ color: trustColor(trust.total) }}>
                      {trust.label}
                    </span>
                  </div>
                  <TrustMeter trust={trust} />
                </div>
              )}
            </div>
            {top.length > 0 && (
              <div className="text-[13px]">
                <span className="text-white/60">Mostly because: </span>
                {top.map((p, i) => (
                  <span key={p.label}>
                    {i > 0 && <span className="text-white/35"> · </span>}
                    {p.label} <span style={{ color: p.value > 0 ? GOOD : BAD }}>{sign(p.value)}</span>
                  </span>
                ))}
              </div>
            )}
            {health.warning && <p className="text-[13px] text-[#ffd60a]">⚠ {health.warning}</p>}
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            label={`${n.name}`}
            options={[
              ['why', 'Why'],
              ['act', 'Actions'],
              ['history', 'History'],
            ] as const}
          />
          {tab === 'why' && (
            <div className="space-y-4">
              <section className="space-y-1.5" aria-label="Why they feel this way">
                <div className="label">Why they feel this way</div>
                {groups.length === 0 && <p className="text-[13px] text-white/60">No strong feelings either way.</p>}
                <div className="rounded-lg border border-white/10 divide-y divide-white/8 overflow-hidden">
                  {groups.map((g) => (
                    <details key={g.group} className="text-[13px] bg-black/15 px-3 py-2" data-reason-group={g.group}>
                      <summary className="cursor-pointer flex justify-between gap-2 list-none">
                        <span>{g.group}</span>
                        <span className="tabular-nums" style={{ color: g.total >= 0 ? GOOD : BAD }}>
                          {sign(g.total)}
                        </span>
                      </summary>
                      <ul className="mt-1.5 space-y-0.5 text-[12px]">
                        {g.parts.map((p) => (
                          <li key={p.label} className="flex justify-between gap-2">
                            <span className="text-white/70">{p.label}</span>
                            <span className="tabular-nums" style={{ color: p.value > 0 ? GOOD : BAD }}>
                              {sign(p.value)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
                {mv.movers.length > 0 && (
                  <p className="text-[12px] text-white/60">
                    Each month:{' '}
                    {mv.movers.slice(0, 4).map((m, i) => (
                      <span key={m.label}>
                        {i > 0 && ', '}
                        {m.label} <span style={{ color: m.value > 0 ? GOOD : BAD }}>{sign(m.value, 1)}</span>
                      </span>
                    ))}
                  </p>
                )}
              </section>
              {trust && trust.parts.length > 0 && (
                <section className="space-y-1.5" aria-label="Trust">
                  <div className="label">Trust, from 50 untested</div>
                  <ul className="text-[12px] space-y-0.5 rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                    {trust.parts.map((p) => (
                      <li key={p.label} className="flex justify-between gap-2">
                        <span className="text-white/70">{p.label}</span>
                        <span className="tabular-nums" style={{ color: p.value > 0 ? GOOD : BAD }}>
                          {sign(p.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="space-y-1.5" aria-label="What they need and want">
                <div className="label">What they need and want</div>
                <ul className="text-[13px] space-y-1">
                  {[...needs, ...wants].map((x, i) => (
                    <li key={i} className="flex items-start justify-between gap-2">
                      <span className={x.level === 'dire' ? 'text-[#ff8a84]' : x.level === 'short' ? 'text-[#ffd60a]' : 'text-white/75'}>{x.text}</span>
                      {x.act && (
                        <button className="btn btn-quiet px-2 py-0.5 text-[12px] shrink-0" onClick={() => act(x.act)}>
                          Act →
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
          {tab === 'act' && <Actions id={id} focusAct={focusAct} />}
          {tab === 'history' && (
            <section className="space-y-1.5" aria-label="History with them">
              {log.length === 0 && <p className="text-[13px] text-white/60">Nothing yet. Visits, embassies, aid and plans with them are written here.</p>}
              {log.map((e, i) => (
                <p key={i} className="text-[12px] border-l-2 border-white/15 pl-2 text-white/75">
                  <span className="text-white/50">{turnDate(e.turn)}: </span>
                  {e.text}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}

// ---- the list -------------------------------------------------------------------------------------------------------------

type Filter = 'all' | 'pinned' | 'allies' | 'friendly' | 'neutral' | 'wary' | 'hostile' | 'war' | 'bloc' | 'trade' | 'neighbors'
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['allies', 'Allies'],
  ['friendly', 'Friendly'],
  ['neutral', 'Neutral'],
  ['wary', 'Wary'],
  ['hostile', 'Hostile'],
  ['war', 'At war'],
  ['bloc', 'Bloc'],
  ['trade', 'Trade partners'],
  ['neighbors', 'Neighbours'],
  ['pinned', 'Watchlist'],
]
type Sort = 'opinion' | 'low' | 'trust' | 'trade' | 'power' | 'distance' | 'trend' | 'name'
const SORTS: [Sort, string][] = [
  ['opinion', 'Opinion, warmest'],
  ['low', 'Opinion, coolest'],
  ['trust', 'Trust'],
  ['trade', 'Trade value'],
  ['power', 'Strength'],
  ['distance', 'Nearest'],
  ['trend', 'Cooling fastest'],
  ['name', 'Name'],
]

function matches(r: PartnerRow, f: Filter, pins: string[]): boolean {
  switch (f) {
    case 'pinned':
      return pins.includes(r.id)
    case 'allies':
      return r.ally
    case 'friendly':
    case 'neutral':
    case 'wary':
    case 'hostile':
      return r.tier === f
    case 'war':
      return r.war
    case 'bloc':
      return r.faction
    case 'trade':
      return r.trade
    case 'neighbors':
      return r.neighbor
    default:
      return true
  }
}

/** The number a sort is about, shown on the right of a row when it is not opinion. */
function metric(r: PartnerRow, sort: Sort): string | null {
  switch (sort) {
    case 'trust':
      return r.trust ? `trust ${r.trust.total}` : null
    case 'trade':
      return r.tradeValue ? `trade ${Math.round(r.tradeValue)}/mo` : 'no trade'
    case 'power':
      return `strength ${showPower(r.power)}`
    case 'distance':
      return `${r.distance.toLocaleString()} km`
    default:
      return null
  }
}

function Row({ row, game, sort, pinned, active, onOpen, onPin }: { row: PartnerRow; game: GameState; sort: Sort; pinned: boolean; active: boolean; onOpen: () => void; onPin: () => void }) {
  const n = game.nations[row.id]
  const chips: [string, boolean, string][] = [
    ['War', row.war, 'chip-red'],
    ['Ally', row.ally, 'chip-blue'],
    ['Pact', row.pact && !row.ally, 'chip-green'],
    ['Bloc', row.faction, 'chip-blue'],
    ['Trade', row.trade, ''],
    ['Embassy', row.embassy, ''],
    ['Neighbour', row.neighbor, ''],
  ]
  const m = metric(row, sort)
  return (
    <div className={`rounded-lg border flex items-stretch transition-colors ${active ? 'border-[#0a84ff]/70 bg-[#0a84ff]/12' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'}`} data-nation={row.id}>
      <button className="flex-1 min-w-0 text-left px-2.5 py-2 space-y-1" onClick={onOpen} aria-label={`Open ${n.name}`} aria-current={active ? 'true' : undefined}>
        <div className="flex items-center gap-2">
          <Dot color={n.color} />
          <span className="font-semibold truncate text-[14px]">{n.name}</span>
          <span className="ml-auto text-[13px] whitespace-nowrap tabular-nums" style={{ color: opinionColor(row.opinion) }}>
            {row.human ? 'Player' : sign(row.opinion)} {!row.human && Math.abs(row.trend) >= 0.15 && <Trend v={row.trend} />}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[11px] min-w-0">
          <span className="flex flex-wrap gap-1 min-w-0">
            {!row.human && <span className="text-white/55 mr-0.5">{row.label}</span>}
            {chips
              .filter(([, on]) => on)
              .map(([l, , tone]) => (
                <span key={l} className={`chip ${tone}`}>
                  {l}
                </span>
              ))}
            {row.favoursOwedToMe > 0 && <span className="chip chip-green">Owes you {row.favoursOwedToMe}</span>}
          </span>
          {m && <span className="ml-auto text-white/55 whitespace-nowrap tabular-nums">{m}</span>}
        </div>
      </button>
      <div className="flex flex-col justify-center gap-0.5 pr-1.5 shrink-0">
        <button className="btn btn-quiet px-2 py-0.5 text-[13px]" aria-pressed={pinned} aria-label={pinned ? `Stop watching ${n.name}` : `Watch ${n.name}`} title={pinned ? 'On your watchlist' : 'Add to your watchlist'} onClick={onPin}>
          {pinned ? '★' : '☆'}
        </button>
        <LocateButton id={row.id} label="" compact />
      </div>
    </div>
  )
}

const PAGE = 8

/** One tier of the list, with its count; long tiers show the first few until asked for more. */
function TierSection({ tier, rows, children, expanded, onMore }: { tier: RelTier; rows: number; children: ReactNode[]; expanded: boolean; onMore: () => void }) {
  return (
    <section className="space-y-1.5" data-tier={tier} aria-label={`${TIER_TEXT[tier].name}: ${rows}`}>
      <div className="flex items-center gap-2 pt-1">
        <span className="w-2 h-2 rounded-full" style={{ background: TIER_COLOR[tier] }} aria-hidden />
        <span className="text-[13px] font-semibold">{TIER_TEXT[tier].name}</span>
        <span className="text-[12px] text-white/50">{rows}</span>
      </div>
      {expanded ? children : children.slice(0, PAGE)}
      {!expanded && children.length > PAGE && (
        <button className="btn btn-quiet w-full text-[12px] py-1" onClick={onMore}>
          Show all {children.length}
        </button>
      )}
    </section>
  )
}

function NationLink({ game, r, open, right }: { game: GameState; r: PartnerRow; open: (id: NationId) => void; right: ReactNode }) {
  return (
    <li>
      <button className="w-full flex items-center justify-between gap-2 text-left hover:underline" onClick={() => open(r.id)}>
        <span className="flex items-center gap-2 min-w-0">
          <Dot color={game.nations[r.id].color} />
          <span className="truncate">{game.nations[r.id].name}</span>
        </span>
        <span className="tabular-nums text-[12px]">{right}</span>
      </button>
    </li>
  )
}

function OverviewCard({ title, children, empty }: { title: string; children: ReactNode; empty: boolean }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
      <div className="label">{title}</div>
      {empty ? <p className="text-[13px] text-white/55">None.</p> : <ul className="text-[13px] space-y-1.5">{children}</ul>}
    </section>
  )
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-1.5">
      <div className="label">{title}</div>
      {children}
    </section>
  )
}

function NameLink({ game, id, open }: { game: GameState; id: NationId; open: (id: NationId) => void }) {
  return (
    <button className="hover:underline font-semibold" onClick={() => open(id)}>
      {game.nations[id]?.name ?? id}
    </button>
  )
}

/** The desk's front page on a wide screen when no nation is open: where everyone stands, and what needs you. */
function Overview({ rows, game, setFilter, open, requests }: { rows: PartnerRow[]; game: GameState; setFilter: (f: Filter) => void; open: (id: NationId) => void; requests: number }) {
  const ai = rows.filter((r) => !r.human)
  const count = (t: RelTier) => rows.filter((r) => r.tier === t).length
  const cooling = ai.filter((r) => r.trend <= -0.3 && (r.ally || r.pact || r.trade || r.embassy)).sort((a, b) => a.trend - b.trend).slice(0, 5)
  const ties = ai.filter((r) => r.tradeValue > 0).sort((a, b) => b.tradeValue - a.tradeValue).slice(0, 5)
  const near = ai.filter((r) => r.neighbor).sort((a, b) => a.opinion - b.opinion).slice(0, 5)
  return (
    <div className="space-y-4" data-overview>
      <div className="grid grid-cols-3 xl:grid-cols-6 gap-2">
        {TIER_ORDER.map((t) => (
          <button key={t} className={`rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] p-3 text-left ${count(t) ? '' : 'opacity-45'}`} onClick={() => setFilter(t === 'ally' ? 'allies' : t)} disabled={!count(t)} aria-label={`${TIER_TEXT[t].name}: ${count(t)}. Show them`}>
            <div className="text-[22px] font-semibold tabular-nums" style={{ color: TIER_COLOR[t] }}>
              {count(t)}
            </div>
            <div className="text-[12px] text-white/65">{TIER_TEXT[t].name}</div>
          </button>
        ))}
      </div>
      {requests > 0 && <p className="text-[13px] text-[#ffd60a]">{requests} request{requests === 1 ? '' : 's'} waiting in Requests. Silence costs goodwill.</p>}
      <div className="grid xl:grid-cols-3 gap-3">
        <OverviewCard title="Cooling partners" empty={!cooling.length}>
          {cooling.map((r) => (
            <NationLink key={r.id} game={game} r={r} open={open} right={<Trend v={r.trend} long />} />
          ))}
        </OverviewCard>
        <OverviewCard title="Biggest trade ties" empty={!ties.length}>
          {ties.map((r) => (
            <NationLink key={r.id} game={game} r={r} open={open} right={<span className="text-white/70">{Math.round(r.tradeValue)}/mo</span>} />
          ))}
        </OverviewCard>
        <OverviewCard title="Your neighbours, coolest first" empty={!near.length}>
          {near.map((r) => (
            <NationLink key={r.id} game={game} r={r} open={open} right={<span style={{ color: opinionColor(r.opinion) }}>{sign(r.opinion)}</span>} />
          ))}
        </OverviewCard>
      </div>
      <p className="text-[12px] text-white/55">Choose a nation to see why it feels as it does and what you can do. Trade deals, investment, joint ventures, a long peace and a shared bloc all warm a nation over time; wars, spies and broken deals cool it.</p>
    </div>
  )
}

function Requests({ game, me }: { game: GameState; me: NationId }) {
  const list = (game.relations?.requests ?? []).filter((q) => q.to === me)
  const open = useGame((s) => s.openRelations)
  if (!list.length) return <p className="text-[13px] text-white/65">No rival is waiting on you. Rivals that like you may ask for help, a trade mission, a joint venture or a place in a war plan. Answer before the deadline: ignoring a request costs goodwill.</p>
  return (
    <div className="space-y-2 max-w-[760px]">
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
  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Box title={`Embassies (${embassies.length}) · ${upkeep.toFixed(1)} money a month`}>
        {embassies.length === 0 && <p className="text-[13px] text-white/60">None. An embassy warms a nation slowly, shows you their numbers and opens joint programs.</p>}
        {embassies.map((e) => (
          <p key={e.to} className="text-[13px]">
            <NameLink game={game} open={open} id={e.to} /> · since {turnDate(e.since)}
            {e.attache ? ' · with a military attaché' : ''}
          </p>
        ))}
      </Box>
      <Box title={`Programs and ventures (${programs.length})`}>
        {programs.length === 0 && <p className="text-[13px] text-white/60">None running.</p>}
        {programs.map((p) => (
          <p key={p.id} className="text-[13px]">
            <NameLink game={game} open={open} id={p.a === me ? p.b : p.a} /> · {p.kind === 'route' ? 'trade mission' : p.kind === 'venture' ? 'joint venture' : p.kind}
            {p.kind === 'venture' ? ` (${Math.round(p.stake ?? 0)} each in ${p.sector ? SECTORS[p.sector].name.toLowerCase() : 'business'})` : ''} · until {turnDate(p.until)}
          </p>
        ))}
      </Box>
      <Box title={`Joint war plans (${plans.length})`}>
        {plans.length === 0 && <p className="text-[13px] text-white/60">None. You need a friend who fights the same enemy.</p>}
        {plans.map((p) => (
          <p key={p.id} className="text-[13px]">
            With <NameLink game={game} open={open} id={p.a === me ? p.b : p.a} /> against {nm(p.enemy)} · until {turnDate(p.until)}
          </p>
        ))}
      </Box>
      <Box title="Favours">
        <p className="text-[13px]">
          Owed to you: {toMe.length ? toMe.map(([d], i) => <span key={i}>{i > 0 && ', '}<NameLink game={game} open={open} id={d} /></span>) : 'none'}
        </p>
        <p className="text-[13px]">
          You owe: {byMe.length ? byMe.map(([, c], i) => <span key={i}>{i > 0 && ', '}<NameLink game={game} open={open} id={c} /></span>) : 'none'}
        </p>
      </Box>
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
  const [more, setMore] = useState<Partial<Record<RelTier, boolean>>>({})
  const [pins, setPins] = useState<string[]>(loadPins)
  const game = view?.game
  const rows = useMemo(() => {
    if (!game) return []
    const { map } = getWorld()
    return partnerRows(game, map, game.playerId, { coalition: coalitionActive(game, map) })
  }, [game])
  // Shift+L shows the open nation on the map.
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
  const byName = (a: PartnerRow, b: PartnerRow) => (game.nations[a.id].name < game.nations[b.id].name ? -1 : 1)
  const shown = rows
    .filter((r) => !text || game.nations[r.id].name.toLowerCase().includes(text))
    .filter((r) => matches(r, filter, pins))
    .sort((a, b) => {
      switch (sort) {
        case 'name':
          return byName(a, b)
        case 'low':
          return a.opinion - b.opinion || byName(a, b)
        case 'trust':
          return (b.trust?.total ?? -1) - (a.trust?.total ?? -1) || b.opinion - a.opinion || byName(a, b)
        case 'trade':
          return b.tradeValue - a.tradeValue || b.opinion - a.opinion || byName(a, b)
        case 'power':
          return b.power.value - a.power.value || byName(a, b)
        case 'distance':
          return a.distance - b.distance || byName(a, b)
        case 'trend':
          return a.trend - b.trend || byName(a, b)
        default:
          return b.opinion - a.opinion || byName(a, b)
      }
    })
  const counts = Object.fromEntries(FILTERS.map(([f]) => [f, rows.filter((r) => matches(r, f, pins)).length])) as Record<Filter, number>
  const tally = (t: RelTier) => rows.filter((r) => r.tier === t).length
  const kicker = `${tally('ally')} allies · ${tally('friendly')} friendly · ${tally('wary') + tally('hostile')} wary or hostile${tally('war') ? ` · ${tally('war')} at war` : ''}${requests.length ? ` · ${requests.length} request${requests.length === 1 ? '' : 's'}` : ''}`
  const open = (id: NationId) => openRelations(id)
  const active = focus && game.nations[focus] ? focus : null
  // Grouped by where they stand when the list is about everyone; a single tier, a search or a sort by name reads better flat.
  const grouped = !text && ['all', 'pinned', 'bloc', 'trade', 'neighbors'].includes(filter)
  const rowOf = (r: PartnerRow) => <Row key={r.id} row={r} game={game} sort={sort} pinned={pins.includes(r.id)} active={r.id === active} onOpen={() => open(r.id)} onPin={() => togglePin(r.id)} />

  const list = (
    <div className="space-y-3" data-relations-list>
      <div className="flex gap-2">
        <input className="field px-3 py-2 text-[14px] flex-1 min-w-0" type="search" placeholder="Find a nation" aria-label="Find a nation" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field px-2 py-2 text-[13px] w-[44%] max-w-[190px]" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Filters">
        {FILTERS.filter(([f]) => f === 'all' || f === filter || counts[f] > 0).map(([v, l]) => (
          <button key={v} className={`btn btn-quiet px-2.5 py-1 text-[12px] ${filter === v ? 'bg-[#0a84ff]/25 text-white' : ''}`} aria-pressed={filter === v} onClick={() => setFilter(filter === v ? 'all' : v)}>
            {l}
            <span className="ml-1 text-white/45 tabular-nums">{counts[v]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="text-[13px] text-white/60">No nation matches.</p>}
      {grouped
        ? TIER_ORDER.map((t) => {
            const inTier = shown.filter((r) => r.tier === t)
            if (!inTier.length) return null
            return (
              <TierSection key={t} tier={t} rows={inTier.length} expanded={!!more[t] || inTier.length <= PAGE + 2} onMore={() => setMore({ ...more, [t]: true })}>
                {inTier.map(rowOf)}
              </TierSection>
            )
          })
        : (
          <div className="space-y-1.5">
            {shown.slice(0, more.neutral ? shown.length : 60).map(rowOf)}
            {shown.length > 60 && !more.neutral && (
              <button className="btn btn-quiet w-full text-[12px] py-1" onClick={() => setMore({ ...more, neutral: true })}>
                Show all {shown.length}
              </button>
            )}
          </div>
        )}
    </div>
  )

  return (
    <PanelShell
      title="Relations"
      kicker={kicker}
      panel="relations"
      wide
      tabs={
        <Tabs
          value={tab}
          onChange={(t) => setTab(t)}
          options={[
            ['partners', 'Nations'],
            ['requests', 'Requests'],
            ['running', 'Commitments'],
            ['log', 'History'],
          ] as const}
          badges={{ requests: requests.length || null }}
        />
      }
    >
      {tab === 'partners' && (
        <div className="lg:grid lg:grid-cols-[minmax(320px,400px)_1fr] lg:gap-5 lg:h-full lg:min-h-0" data-relations-board>
          <div className={`${active ? 'hidden lg:block' : ''} lg:overflow-y-auto lg:min-h-0 lg:pr-1 scroll-thin`}>{list}</div>
          <div className={`${active ? '' : 'hidden lg:block'} lg:overflow-y-auto lg:min-h-0 lg:pr-1 scroll-thin`}>
            {active ? <PartnerCard key={active} id={active} pinned={pins.includes(active)} togglePin={() => togglePin(active)} onBack={() => openRelations(null)} /> : <Overview rows={rows} game={game} setFilter={setFilter} open={open} requests={requests.length} />}
          </div>
        </div>
      )}
      {tab === 'requests' && <Requests game={game} me={me} />}
      {tab === 'running' && (
        <Running
          game={game}
          me={me}
          open={(id) => {
            setTab('partners')
            open(id)
          }}
        />
      )}
      {tab === 'log' && (
        <div className="space-y-1.5 max-w-[760px]">
          {(game.relations?.log ?? [])
            .filter((e) => e.a === me || e.b === me)
            .slice(-60)
            .reverse()
            .map((e, i) => (
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
