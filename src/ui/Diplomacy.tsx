import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { perceivedPower } from '../ai/diplomat'
import { coalitionActive, nationNeighbors, opinionLabel, opinionReport, type OpinionReport } from '../ai/opinion'
import { PERSONALITIES } from '../data/personalities'
import { COSTS, DIPLOMACY, MARKET, PROPOSAL_COSTS, PROPOSAL_LABELS, TRADE_LIMITS } from '../data/unitTypes'
import { PACT_TURNS, describeProposal, loanPayment } from '../engine/diplomacy'
import { militaryPower } from '../engine/economy'
import { alliesOf, atWar, clamp, enemiesOf, hasCasusBelli, hasPact, isAllied, pairKey, regionsOf, turnDate } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import { bundleValue, describeBundle, marketPrices, stockOf } from '../engine/trade'
import type { Deal, Dispatch, NationId, Proposal, RegionId, ResourceBundle, SectorId, TradeResource } from '../engine/types'
import { INVEST, SECTORS, SECTOR_IDS } from '../data/business'
import { TRADE_RESOURCES } from '../engine/types'
import { MAX_REPARATIONS, netWarScore, puppetValue, REPARATION_MONTHS, regionValue, termsCost } from '../engine/warscore'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { OrderButton, PanelShell } from './panel'

const opinionColor = (v: number) => (v >= 25 ? '#34d399' : v >= 5 ? '#a7f3d0' : v > -5 ? '#94a3b8' : v > -25 ? '#fbbf24' : '#fb7185')

function Dot({ color }: { color: string }) {
  return <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
}

/** A centred bar for a value in -100..100. */
function SignedBar({ value, color }: { value: number; color: string }) {
  const w = `${Math.min(100, Math.abs(value)) / 2}%`
  return (
    <div className="relative h-1.5 rounded-full bg-slate-800 mt-1 overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-500/70" />
      <motion.div
        className="absolute inset-y-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}`, ...(value >= 0 ? { left: '50%' } : { right: '50%' }) }}
        initial={false}
        animate={{ width: w }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}

function OpinionMeter({ report }: { report: OpinionReport }) {
  const [open, setOpen] = useState(false)
  const v = report.total
  const color = opinionColor(v)
  return (
    <div>
      <button className="w-full text-left" onClick={() => setOpen((o) => !o)} title="Click for the reasons behind their opinion">
        <div className="flex justify-between text-[11px]">
          <span className="text-slate-400">{open ? 'Why they feel this way' : 'Opinion of you'}</span>
          <span style={{ color }}>
            {opinionLabel(v)} ({v > 0 ? '+' : ''}
            {v})
          </span>
        </div>
        <SignedBar value={v} color={color} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden text-[11px] mt-1.5 space-y-0.5">
            {report.parts.length === 0 && <li className="text-slate-500">No strong feelings either way.</li>}
            {report.parts.map((p) => (
              <li key={p.label} className="flex justify-between">
                <span className="text-slate-400">{p.label}</span>
                <span className={p.value > 0 ? 'text-emerald-300' : 'text-rose-300'}>
                  {p.value > 0 ? '+' : ''}
                  {p.value}
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

function WarScoreBar({ target }: { target: NationId }) {
  const view = usePlayerView()!
  const net = netWarScore(view.game, view.player.id, target)
  const color = net >= 0 ? '#22d3ee' : '#f472b6'
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-slate-400">War score</span>
        <span style={{ color }}>
          {net > 0 ? '+' : ''}
          {net} {net > 10 ? '(winning)' : net < -10 ? '(losing)' : '(stalemate)'}
        </span>
      </div>
      <SignedBar value={net} color={color} />
    </div>
  )
}

function InboxCard({ p }: { p: Proposal }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const removeOrder = useGame((s) => s.removeOrder)
  const { game, orders } = view
  const { map } = getWorld()
  const from = game.nations[p.from]
  const idx = orders.findIndex((o) => o.type === 'respond' && o.proposalId === p.id)
  const queued = idx >= 0 ? orders[idx] : null
  const answer = queued?.type === 'respond' ? queued.accept : null
  const base = { type: 'respond' as const, nationId: game.playerId, proposalId: p.id }
  const acceptErr = validateOrder(game, map, { ...base, accept: true }, orders.filter((_, i) => i !== idx))
  const left = p.expires - game.turn
  const answerWith = (accept: boolean) => (answer === accept ? removeOrder(idx) : issueOrder({ ...base, accept }))
  return (
    <motion.div layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -30 }} className="rounded-lg border border-amber-400/50 bg-amber-400/5 p-3 space-y-2">
      <div className="flex justify-between items-center gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <Dot color={from.color} />
          <span className="font-semibold truncate">{from.name}</span>
        </span>
        <span className="text-[12px] font-medium text-[#ffd60a] whitespace-nowrap">{PROPOSAL_LABELS[p.kind]}</span>
      </div>
      <p className="text-sm text-slate-300">{describeProposal(game, map, p)}.</p>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] ${left <= 0 ? 'text-rose-300' : 'text-slate-500'}`}>{left <= 0 ? 'Last month to answer' : `${left + 1} months to answer`}</span>
        <div className="flex gap-2">
          <button className={`btn ${answer === true ? 'bg-emerald-400/25 border-emerald-300/70 text-emerald-100' : ''}`} disabled={!!acceptErr && answer !== true} title={acceptErr ?? 'Accept at the end of this month'} onClick={() => answerWith(true)}>
            {answer === true ? 'Accepting' : 'Accept'}
          </button>
          <button className={`btn btn-red ${answer === false ? 'bg-rose-500/25' : ''}`} onClick={() => answerWith(false)}>
            {answer === false ? 'Declining' : 'Decline'}
          </button>
        </div>
      </div>
      {acceptErr && answer !== true && <p className="text-[11px] text-rose-300">Cannot accept: {acceptErr}</p>}
    </motion.div>
  )
}

function DealRow({ d }: { d: Deal }) {
  const view = usePlayerView()!
  const { game, player } = view
  const partner = game.nations[d.from === player.id ? d.to : d.from]
  const paying = d.from === player.id
  const out: ResourceBundle = paying ? d.give : d.receive
  const into: ResourceBundle = paying ? d.receive : d.give
  const left = d.until - game.turn + 1
  const text =
    d.kind === 'loan'
      ? paying
        ? `You repay ${describeBundle(out)} a month on a loan from ${partner.name}`
        : `${partner.name} repays you ${describeBundle(into)} a month on your loan`
      : d.kind === 'reparations'
      ? paying
        ? `You pay ${describeBundle(out)} a month in war reparations`
        : `${partner.name} pays you ${describeBundle(into)} a month in war reparations`
      : `You send ${describeBundle(out)} and receive ${describeBundle(into)} each month`
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Dot color={partner.color} />
          <span className="font-semibold">{partner.name}</span>
        </span>
        <span className="text-[10px] font-display tracking-widest text-slate-400">{left} MO LEFT</span>
      </div>
      <p className="text-slate-300 text-xs">{text}.</p>
      {!((d.kind === 'reparations' || d.kind === 'loan') && paying) && (
        <OrderButton
          order={{ type: 'cancelDeal', nationId: player.id, dealId: d.id }}
          label={d.kind === 'reparations' ? 'Forgive debt' : d.kind === 'loan' ? 'Forgive the loan' : 'Break deal'}
          effect={d.kind === 'trade' ? 'They will remember the betrayal' : 'They will remember the kindness'}
          tone={d.kind === 'trade' ? 'btn-red' : ''}
        />
      )}
    </div>
  )
}

const ZERO: Record<TradeResource, number> = { capital: 0, food: 0, tp: 0, manpower: 0, oil: 0, steel: 0, goods: 0 }
const compact = (b: Record<TradeResource, number>): ResourceBundle => {
  const out: ResourceBundle = {}
  for (const r of TRADE_RESOURCES) if (b[r] > 0) out[r] = b[r]
  return out
}

function AmountInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={0}
      max={TRADE_LIMITS.maxAmount}
      step={5}
      value={value || ''}
      placeholder="0"
      onChange={(e) => onChange(clamp(Math.round(+e.target.value || 0), 0, TRADE_LIMITS.maxAmount))}
      className="w-16 bg-slate-950/70 border border-slate-700 rounded px-1.5 py-0.5 text-right text-xs focus:border-cyan-400 outline-none"
    />
  )
}

function TradeComposer({ target }: { target: NationId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const them = game.nations[target]
  const [give, setGive] = useState(ZERO)
  const [receive, setReceive] = useState(ZERO)
  const [months, setMonths] = useState(0)
  const prices = useMemo(() => marketPrices(game), [game])
  const terms = { give: compact(give), receive: compact(receive), months }
  const gv = bundleValue(terms.give, prices) * Math.max(1, months)
  const rv = bundleValue(terms.receive, prices) * Math.max(1, months)
  return (
    <div className="space-y-2 rounded-lg bg-slate-950/50 p-2.5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-1.5 items-center text-xs">
        <span className="label">Resource</span>
        <span className="label text-right">You give</span>
        <span className="label text-right">You get</span>
        {TRADE_RESOURCES.map((r) => (
          <div key={r} className="contents">
            <div>
              <div>
                {MARKET[r].name} <span className="text-slate-500">@ {prices[r].toFixed(2)}</span>
              </div>
              <div className="text-[10px] text-slate-500">
                you {Math.floor(stockOf(player, r))} · them {Math.floor(stockOf(them, r))}
              </div>
            </div>
            <AmountInput value={give[r]} onChange={(v) => setGive({ ...give, [r]: v })} />
            <AmountInput value={receive[r]} onChange={(v) => setReceive({ ...receive, [r]: v })} />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">Schedule</span>
        <select className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5" value={months} onChange={(e) => setMonths(+e.target.value)}>
          <option value={0}>One-off exchange</option>
          {[3, 6, TRADE_LIMITS.maxMonths].map((m) => (
            <option key={m} value={m}>
              Every month for {m} months
            </option>
          ))}
        </select>
      </div>
      <div className="text-[11px] text-slate-400">
        Market value: you give <span className="text-white">{gv.toFixed(0)}</span>, you get <span className="text-white">{rv.toFixed(0)}</span> money.{' '}
        {rv > 0 && gv / rv < 1 && 'They will want more for it, unless they are short of what you offer.'}
      </div>
      <OrderButton order={{ type: 'propose', nationId: player.id, target, proposal: { kind: 'trade', terms } }} label="Offer deal" cost={`${PROPOSAL_COSTS.trade} influence`} effect="They answer when you press Next turn" tone="btn-primary" />
    </div>
  )
}

function RegionPick({ ids, picked, toggle }: { ids: RegionId[]; picked: RegionId[]; toggle: (id: RegionId) => void }) {
  const view = usePlayerView()!
  const { map } = getWorld()
  if (!ids.length) return <p className="text-[11px] text-slate-500">None available.</p>
  return (
    <div className="max-h-32 overflow-y-auto scroll-thin space-y-0.5 pr-1">
      {ids.map((id) => (
        <label key={id} className="flex items-center justify-between text-xs cursor-pointer hover:bg-white/5 rounded px-1">
          <span className="flex items-center gap-1.5">
            <input type="checkbox" checked={picked.includes(id)} onChange={() => toggle(id)} />
            {map.regions[id].name}
          </span>
          <span className="text-slate-500">{regionValue(view.game, map, id)}</span>
        </label>
      ))}
    </div>
  )
}

function PeaceComposer({ target }: { target: NationId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const { map } = getWorld()
  const [cede, setCede] = useState<RegionId[]>([])
  const [reparations, setReparations] = useState(0)
  const [puppet, setPuppet] = useState(false)
  const live = cede.filter((id) => game.regions[id] && (game.regions[id].owner === target || game.regions[id].owner === player.id))
  const terms = { cede: live, reparations, ...(puppet ? { puppet: true } : {}) }
  const net = netWarScore(game, player.id, target)
  const budget = Math.max(0, net)
  const { demand, concession } = termsCost(game, map, terms, player.id, target)
  const byValue = (owner: NationId, dir: 1 | -1) =>
    regionsOf(game, owner)
      .filter((id) => game.nations[owner].capital !== id)
      .sort((a, b) => dir * (regionValue(game, map, b) - regionValue(game, map, a)))
  const toggle = (id: RegionId) => setCede((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const cost = demand - concession
  return (
    <div className="space-y-2 rounded-lg bg-slate-950/50 p-2.5">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">Terms cost</span>
        <span className={cost > budget ? 'text-rose-300' : 'text-emerald-300'}>
          {cost} / {budget} war score
        </span>
      </div>
      <div>
        <div className="label mb-1">Demand regions</div>
        <RegionPick ids={byValue(target, 1)} picked={live} toggle={toggle} />
      </div>
      {net < 15 && (
        <div>
          <div className="label mb-1">Offer regions</div>
          <RegionPick ids={byValue(player.id, -1)} picked={live} toggle={toggle} />
        </div>
      )}
      <div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Reparations</span>
          <span>{reparations === 0 ? 'None' : reparations > 0 ? `They pay ${reparations}/mo` : `You pay ${-reparations}/mo`}</span>
        </div>
        <input type="range" className="w-full" min={-MAX_REPARATIONS} max={MAX_REPARATIONS} step={1} value={reparations} onChange={(e) => setReparations(+e.target.value)} />
        <div className="text-[12px] text-white/45">Paid in money for {REPARATION_MONTHS} months.</div>
      </div>
      {!game.nations[target].overlord && !player.overlord && (
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1" checked={puppet} onChange={(e) => setPuppet(e.target.checked)} />
          <span>
            Make them a puppet state
            <span className="block text-[12px] text-white/65">
              They keep their land but pay you {Math.round(DIPLOMACY.puppet.tribute * 100)}% of their income and cannot declare war. It costs {puppetValue(game, map, target)} war score, and they may break free if they grow strong or restless.
            </span>
          </span>
        </label>
      )}
      <OrderButton
        order={{ type: 'propose', nationId: player.id, target, proposal: { kind: 'peace', terms } }}
        label={live.length === 0 && reparations === 0 && !puppet ? 'Offer peace with no terms' : 'Send terms'}
        cost={`${PROPOSAL_COSTS.peace} influence`}
        effect="They answer when you press Next turn"
        tone="btn-primary"
      />
    </div>
  )
}

/** Loans and investment: lend money, or put money into their business. */
function MoneyComposer({ target }: { target: NationId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const [amount, setAmount] = useState(100)
  const [months, setMonths] = useState(12)
  const [sector, setSector] = useState<SectorId>('manufacturing')
  const L = DIPLOMACY.loan
  const them = game.nations[target]
  return (
    <div className="space-y-3 rounded-lg bg-slate-950/50 p-2.5">
      <div className="space-y-1.5">
        <div className="text-[15px] font-semibold">Lend them money</div>
        <div className="flex justify-between text-[14px]">
          <span className="text-white/75">Amount</span>
          <span className="tabular-nums">{amount}</span>
        </div>
        <input type="range" className="w-full" aria-label="Loan amount" min={L.min} max={L.max} step={10} value={amount} onChange={(e) => setAmount(+e.target.value)} />
        <div className="flex justify-between text-[14px]">
          <span className="text-white/75">Repaid over</span>
          <span className="tabular-nums">{months} months</span>
        </div>
        <input type="range" className="w-full" aria-label="Loan length" min={L.minMonths} max={L.maxMonths} step={1} value={months} onChange={(e) => setMonths(+e.target.value)} />
        <p className="text-[13px] text-white/70">
          They pay {loanPayment(amount, months).toFixed(1)} a month, {(loanPayment(amount, months) * months - amount).toFixed(0)} more than you lend. Someone who cannot pay breaks the deal and loses your trust.
        </p>
        <OrderButton order={{ type: 'propose', nationId: player.id, target, proposal: { kind: 'loan', amount, months } }} label="Offer the loan" cost={`${PROPOSAL_COSTS.loan} influence`} effect="Money moves when they accept" tone="btn-primary" />
      </div>
      <div className="space-y-1.5 border-t border-white/10 pt-3">
        <div className="text-[15px] font-semibold">Invest in their business</div>
        <p className="text-[13px] text-white/70">It makes their firms grow, pays you {(INVEST.dividend * 100).toFixed(1)}% a month, and they like you for it. If you go to war, you lose it.</p>
        <select className="field w-full px-3 py-2 text-[14px]" aria-label="Sector" value={sector} onChange={(e) => setSector(e.target.value as SectorId)}>
          {SECTOR_IDS.map((id) => (
            <option key={id} value={id}>
              {SECTORS[id].name} (they have {(them.sectors[id] ?? 0).toFixed(1)})
            </option>
          ))}
        </select>
        <OrderButton order={{ type: 'invest', nationId: player.id, target, sector, amount }} label={`Invest ${amount}`} cost={`${amount} money`} effect="Starts at once" />
      </div>
    </div>
  )
}

interface RowContext {
  neighbors: Set<NationId>
  coalition: boolean
  myPower: number
}

function NationRow({ id, ctx, focused }: { id: NationId; ctx: RowContext; focused: boolean }) {
  const view = usePlayerView()!
  const selectRegion = useGame((s) => s.selectRegion)
  const { game, player } = view
  const { map } = getWorld()
  const ref = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'none' | 'trade' | 'peace' | 'money'>('none')
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focused])
  const n = game.nations[id]
  const war = atWar(game, player.id, id)
  const allied = isAllied(game, player.id, id)
  const pact = hasPact(game, player.id, id)
  const cb = hasCasusBelli(game, player.id, id)
  const theirCb = hasCasusBelli(game, id, player.id)
  const borders = ctx.neighbors.has(id)
  const report = useMemo(() => opinionReport(game, map, id, player.id, { borders, coalition: ctx.coalition }), [game, map, id, player.id, borders, ctx.coalition])
  const power = perceivedPower(game, map, player.id, id)
  const persona = PERSONALITIES[n.personality]
  const callable = allied ? enemiesOf(game, player.id).filter((e) => !atWar(game, id, e) && !isAllied(game, id, e) && !hasPact(game, id, e)) : []
  const sanctionedByMe = game.sanctions.some((x) => x.from === player.id && x.to === id && x.until >= game.turn)
  const status = n.overlord ? `Puppet of ${game.nations[n.overlord]?.name ?? 'someone'}` : war ? 'At war' : allied ? 'Ally' : pact ? `Pact until ${turnDate(game.pacts[pairKey(player.id, id)])}` : 'At peace'
  const statusColor = war ? 'text-rose-400' : allied ? 'text-cyan-300' : pact ? 'text-emerald-300' : 'text-slate-400'
  const toggle = (m: 'trade' | 'peace' | 'money') => setMode((cur) => (cur === m ? 'none' : m))
  return (
    <div
      ref={ref}
      className={`rounded-lg border p-3 space-y-2 transition-shadow ${war ? 'border-rose-500/50 bg-rose-500/5' : allied ? 'border-cyan-400/40 bg-cyan-400/5' : 'border-slate-700/70 bg-slate-900/40'} ${focused ? 'shadow-[0_0_0_1px_rgba(34,211,238,0.7),0_0_18px_rgba(34,211,238,0.25)]' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <button className="flex items-center gap-2 hover:underline min-w-0" onClick={() => selectRegion(n.capital)}>
          <Dot color={n.color} />
          <span className="font-semibold truncate">{n.name}</span>
        </button>
        <span className={`text-[12px] font-medium whitespace-nowrap ${statusColor}`}>{status}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span className="chip" title={persona.description}>
          {persona.name}
        </span>
        <span>
          {regionsOf(game, id).length === 1 ? '1 country' : `${regionsOf(game, id).length} countries`} · strength {power.toFixed(0)} ({power > ctx.myPower ? 'stronger than you' : 'weaker than you'})
        </span>
      </div>
      {(cb || theirCb) && (
        <div className="text-[11px]">
          {cb && <span className="text-[#ffd60a]">You have a grievance, so war is cheaper. </span>}
          {theirCb && <span className="text-[#ff8a84]">They have a grievance against you.</span>}
        </div>
      )}
      <OpinionMeter report={report} />
      {war && <WarScoreBar target={id} />}
      <div className="flex flex-wrap gap-1.5">
        {war ? (
          <button className={`btn btn-primary ${mode === 'peace' ? 'bg-cyan-400/25' : ''}`} onClick={() => toggle('peace')}>
            Negotiate peace
          </button>
        ) : (
          <>
            <button className={`btn btn-primary ${mode === 'trade' ? 'bg-cyan-400/25' : ''}`} onClick={() => toggle('trade')}>
              Trade
            </button>
            <button className={`btn ${mode === 'money' ? 'bg-cyan-400/25' : ''}`} onClick={() => toggle('money')}>
              Loans and investment
            </button>
            {!allied && (
              <OrderButton
                order={{ type: 'declareWar', nationId: player.id, target: id }}
                label="Declare war"
                cost={`${cb ? COSTS.declareWarWithCasusBelli : COSTS.declareWar} influence`}
                effect="Then attack from the War Room. Every war bills you monthly."
                tone="btn-red"
              />
            )}
            {allied && <OrderButton order={{ type: 'leaveAlliance', nationId: player.id, target: id }} label="Leave alliance" cost={`${COSTS.leaveAlliance} influence`} tone="btn-quiet" />}
          </>
        )}
      </div>
      {!war && !allied && (
        <div className="flex flex-wrap gap-1.5">
          {!pact && (
            <OrderButton
              order={{ type: 'propose', nationId: player.id, target: id, proposal: { kind: 'pact' } }}
              label="Peace pact"
              cost={`${PROPOSAL_COSTS.pact} influence`}
              effect={`Neither side may declare war for ${PACT_TURNS} months`}
            />
          )}
          <OrderButton
            order={{ type: 'propose', nationId: player.id, target: id, proposal: { kind: 'alliance' } }}
            label="Alliance"
            cost={`${PROPOSAL_COSTS.alliance} influence`}
            effect="Each of you can call the other into a war"
          />
          <OrderButton
            order={{ type: 'propose', nationId: player.id, target: id, proposal: { kind: 'guarantee' } }}
            label="Guarantee"
            cost={`${PROPOSAL_COSTS.guarantee} influence`}
            effect={`You defend them if attacked, for ${DIPLOMACY.guarantee.months} months`}
          />
        </div>
      )}
      {!war && (
        <div className="flex flex-wrap gap-1.5">
          {sanctionedByMe ? (
            <OrderButton order={{ type: 'liftSanctions', nationId: player.id, target: id }} label="Lift sanctions" effect="They will like you more" />
          ) : (
            !allied && (
              <OrderButton
                order={{ type: 'imposeSanctions', nationId: player.id, target: id }}
                label="Sanction"
                cost={`${DIPLOMACY.sanctions.cost} influence`}
                effect={`Cuts their trade room and port income for ${DIPLOMACY.sanctions.months} months`}
                tone="btn-quiet"
              />
            )
          )}
          {n.overlord === player.id && <OrderButton order={{ type: 'releasePuppet', nationId: player.id, target: id }} label="Set free" effect="They stop paying tribute and will thank you" />}
        </div>
      )}
      {callable.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {callable.map((e) => (
            <OrderButton
              key={e}
              order={{ type: 'propose', nationId: player.id, target: id, proposal: { kind: 'callToArms', enemy: e } }}
              label={`Call into the war with ${game.nations[e].name}`}
              cost={`${PROPOSAL_COSTS.callToArms} influence`}
              tone="btn-magenta"
            />
          ))}
        </div>
      )}
      <AnimatePresence initial={false}>
        {mode !== 'none' && (
          <motion.div key={mode} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            {mode === 'trade' ? <TradeComposer target={id} /> : mode === 'money' ? <MoneyComposer target={id} /> : <PeaceComposer target={id} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const DISPATCH_COLOR: Record<Dispatch['kind'], string> = {
  proposal: 'text-amber-200',
  accepted: 'text-emerald-300',
  joined: 'text-emerald-300',
  completed: 'text-emerald-200',
  rejected: 'text-rose-300',
  ignored: 'text-rose-300',
  broken: 'text-rose-400',
  expired: 'text-slate-400',
}

export function DiplomacyPanel() {
  const view = usePlayerView()
  const focus = useGame((s) => s.diploFocus)
  const game = view?.game
  const ctx = useMemo<RowContext | null>(() => {
    if (!game) return null
    const { map } = getWorld()
    return { neighbors: nationNeighbors(game, map, game.playerId), coalition: coalitionActive(game, map), myPower: militaryPower(game, game.playerId) }
  }, [game])
  if (!view || !ctx || !game) return null
  const { player } = view
  const me = player.id
  const inbox = game.proposals.filter((p) => p.to === me)
  const deals = game.deals.filter((d) => d.from === me || d.to === me)
  const mine = game.dispatches.filter((d) => d.from === me || d.to === me)
  const world = game.dispatches.filter((d) => d.from !== me && d.to !== me)

  const close = new Set<NationId>([...ctx.neighbors, ...enemiesOf(game, me), ...alliesOf(game, me)])
  for (const d of deals) close.add(d.from === me ? d.to : d.from)
  if (focus && focus !== me && game.nations[focus]?.alive) close.add(focus)
  const closeList = [...close].filter((id) => game.nations[id]?.alive).sort((a, b) => Number(atWar(game, me, b)) - Number(atWar(game, me, a)) || Number(isAllied(game, me, b)) - Number(isAllied(game, me, a)) || game.nations[a].name.localeCompare(game.nations[b].name))
  const majors = Object.values(game.nations)
    .filter((n) => n.alive && n.id !== me && !close.has(n.id))
    .sort((a, b) => regionsOf(game, b.id).length - regionsOf(game, a.id).length || militaryPower(game, b.id) - militaryPower(game, a.id))
    .slice(0, 6)

  return (
    <PanelShell title="Diplomacy" kicker={`${enemiesOf(game, me).length} wars · ${alliesOf(game, me).length} allies · ${inbox.length} waiting on you. Offers are answered when you press Next turn.`} panel="diplomacy">
      {ctx.coalition && (
        <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-3 text-xs text-rose-200">
          Your growing power alarms the world. Neighbors now distrust you and are quicker to band together against you.
        </div>
      )}
      <AnimatePresence initial={false}>
        {inbox.length > 0 && (
          <motion.section key="inbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
            <div className="label text-amber-300">Awaiting your answer</div>
            <AnimatePresence initial={false}>
              {inbox.map((p) => (
                <InboxCard key={p.id} p={p} />
              ))}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>
      {mine.length > 0 && (
        <section className="space-y-1.5">
          <div className="label">Last month</div>
          {mine.map((d, i) => (
            <p key={i} className={`text-xs border-l-2 border-slate-700 pl-2 ${DISPATCH_COLOR[d.kind]}`}>
              {d.text}
            </p>
          ))}
        </section>
      )}
      {deals.length > 0 && (
        <section className="space-y-2">
          <div className="label">Active deals</div>
          {deals.map((d) => (
            <DealRow key={d.id} d={d} />
          ))}
        </section>
      )}
      <section className="space-y-2">
        <div className="label">Your neighbors, allies and enemies</div>
        {closeList.map((id) => (
          <NationRow key={id} id={id} ctx={ctx} focused={focus === id} />
        ))}
      </section>
      {majors.length > 0 && (
        <section className="space-y-2">
          <div className="label">The biggest powers elsewhere</div>
          {majors.map((n) => (
            <NationRow key={n.id} id={n.id} ctx={ctx} focused={focus === n.id} />
          ))}
        </section>
      )}
      {world.length > 0 && (
        <section className="space-y-1.5">
          <div className="label">Around the world</div>
          {world.slice(-8).map((d, i) => (
            <p key={i} className="text-[11px] text-slate-400 border-l-2 border-slate-800 pl-2">
              {d.text}
            </p>
          ))}
        </section>
      )}
    </PanelShell>
  )
}
