import { AnimatePresence, motion } from 'framer-motion'
import { LocateButton } from './Locate'
import { useEffect, useMemo, useRef, useState } from 'react'
import { powerView, showPower } from '../engine/intel'
import { coalitionActive, nationNeighbors, opinionLabel, opinionReport, type OpinionReport } from '../ai/opinion'
import { PERSONALITIES } from '../data/personalities'
import { COSTS, DIPLOMACY, MARKET, PROPOSAL_COSTS, PROPOSAL_LABELS, TRADE_LIMITS } from '../data/unitTypes'
import { blocOf, blocsOf } from '../engine/blocs'
import { PACT_TURNS, describeProposal, generalPeaceTies, joinWarBlocked, loanPayment } from '../engine/diplomacy'
import { militaryPower } from '../engine/economy'
import { alliesOf, atWar, clamp, enemiesOf, hasCasusBelli, hasPact, isAllied, justificationOf, pairKey, puppetsOf, regionsOf, turnDate } from '../engine/helpers'
import { annexCost, warCost } from '../engine/orders'
import { tierOf } from '../engine/empire'
import { isLive } from '../engine/calendar'
import { CRISIS } from '../data/crises'
import { EMPIRE, JUSTIFY } from '../data/war'
import { warRefusal } from './warHint'
import { offerWhen } from './offerWhen'
import { validateOrder } from '../engine/orders'
import { bundleValue, describeBundle, marketPrices, stockOf } from '../engine/trade'
import type { Deal, Dispatch, GameState, NationId, Proposal, RegionId, ResourceBundle, SectorId, TradeResource } from '../engine/types'
import { INVEST, SECTORS, SECTOR_IDS } from '../data/business'
import { TRADE_RESOURCES } from '../engine/types'
import { LIBERATE_TEXT } from '../data/puppets'
import { liberablePuppets } from '../engine/puppets'
import { TERRITORY, TERRITORY_TEXT } from '../data/territories'
import { annexTerritoryCost, territoryProblem, territoryValue } from '../engine/territories'
import { MAX_REPARATIONS, liberateValue, netWarScore, puppetValue, REPARATION_MONTHS, regionValue, termsCost, warStanding } from '../engine/warscore'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { useHumanName, usePlayerView } from './hooks'
import { OrderButton, PanelShell, Tabs } from './panel'
import { Ledger } from './Ledger'
import { FactionNoticeLine, FactionRow } from './FactionLinks'
import { factionChip } from './pickerItems'
import { closeNations, offerIsMoot } from './diplomacyList'
import { offerOutlook } from '../ai/diplomat'
import { trustLean } from '../engine/ties'
import type { ProposalDraft } from '../engine/types'
import { CallOddsList, OddsLine } from './OddsLine'
import { TONE_TEXT, verdictOf } from './oddsText'
import { callOutlooks } from '../ai/blocs'
import { BLOC } from '../data/blocs'
import { factionOf } from '../engine/factions'
import type { DiploCompose } from '../store'

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** The engine's alliance groups are named "X bloc"; the Bloc desk's blocs are something else, so here they are alliances. */
const allianceName = (name: string) => name.replace(/ bloc$/, ' alliance')

const opinionColor = (v: number) => (v >= 25 ? '#34d399' : v >= 5 ? '#a7f3d0' : v > -5 ? '#94a3b8' : v > -25 ? '#fbbf24' : '#fb7185')

function Dot({ color }: { color: string }) {
  return <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
}

/** A centred bar for a value in -100..100. */
function SignedBar({ value, color }: { value: number; color: string }) {
  const w = `${Math.min(100, Math.abs(value)) / 2}%`
  return (
    <div className="relative h-1.5 rounded-full bg-white/10 mt-1 overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
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
        <div className="flex justify-between text-[12px]">
          <span className="text-white/70">{open ? 'Why they feel this way' : 'Opinion of you'}</span>
          <span style={{ color }}>
            {opinionLabel(v)} ({v > 0 ? '+' : ''}
            {v})
          </span>
        </div>
        <SignedBar value={v} color={color} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden text-[12px] mt-1.5 space-y-0.5">
            {report.parts.length === 0 && <li className="text-white/55">No strong feelings either way.</li>}
            {report.parts.map((p) => (
              <li key={p.label} className="flex justify-between">
                <span className="text-white/70">{p.label}</span>
                <span className={p.value > 0 ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}>
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

/** The war in one line: the score and who is winning. The breakdown, the fronts and the odds are in Military, Wars. */
function WarLine({ target }: { target: NationId }) {
  const view = usePlayerView()!
  const openMilitary = useGame((s) => s.openMilitary)
  const { map } = getWorld()
  const net = netWarScore(view.game, view.player.id, target)
  const standing = warStanding(view.game, map, view.player.id, target)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]" data-war-line>
      <span className="text-white/80">
        War score <b className="tabular-nums" style={{ color: net >= 0 ? '#22d3ee' : '#f472b6' }}>{net > 0 ? '+' : ''}{net}</b> · {STANDING_TEXT[standing.verdict]}
      </span>
      <button className="btn btn-quiet px-3 py-1 text-[13px]" onClick={() => openMilitary('wars')} title="The score's breakdown, every front and your odds">
        Fronts and odds in Wars →
      </button>
    </div>
  )
}

const STANDING_TEXT = { winning: 'winning', ahead: 'slightly ahead', even: 'even', behind: 'slightly behind', losing: 'losing' } as const

function InboxCard({ p, moot = false }: { p: Proposal; moot?: boolean }) {
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
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -30 }} className="rounded-lg border border-[#ffd60a]/50 bg-[#ffd60a]/6 p-3 space-y-2">
      <div className="flex justify-between items-center gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <Dot color={from.color} />
          <span className="font-semibold truncate">{from.name}</span>
        </span>
        <span className="text-[12px] font-medium text-[#ffd60a] whitespace-nowrap">{PROPOSAL_LABELS[p.kind]}</span>
      </div>
      <p className="text-sm text-white/80">{describeProposal(game, map, p)}.</p>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[12px] ${left <= 0 ? 'text-[#ff8a84]' : 'text-white/55'}`}>{left <= 0 ? 'Last month to answer' : `${left + 1} months to answer`}</span>
        <div className="flex gap-2">
          {!moot && (
            <button className={`btn ${answer === true ? 'bg-[#30d158]/25 border-[#30d158]/70 text-[#6eeb8a]' : ''}`} disabled={!!acceptErr && answer !== true} title={acceptErr ?? (isLive(game) ? 'Accept now' : 'Accept at the end of this month')} onClick={() => answerWith(true)}>
              {answer === true ? 'Accepting' : 'Accept'}
            </button>
          )}
          <button className={`btn btn-red ${answer === false ? 'bg-[#ff453a]/25' : ''}`} onClick={() => answerWith(false)}>
            {answer === false ? (moot ? 'Clearing' : 'Declining') : moot ? 'Clear' : 'Decline'}
          </button>
        </div>
      </div>
      {acceptErr && answer !== true && <p className={`text-[12px] ${moot ? 'text-white/60' : 'text-[#ff8a84]'}`}>{moot ? `No longer possible: ${acceptErr}. Clearing it declines it politely.` : `Cannot accept: ${acceptErr}`}</p>}
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
    <div className="rounded-lg border border-white/12 bg-white/5 p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Dot color={partner.color} />
          <span className="font-semibold">{partner.name}</span>
        </span>
        <span className="text-[12px] font-display tracking-widest text-white/70">{left} MO LEFT</span>
      </div>
      <p className="text-white/80 text-[13px]">{text}.</p>
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
      className="w-16 bg-black/40 border border-white/15 rounded px-1.5 py-0.5 text-right text-[13px] focus:border-[#0a84ff] outline-none"
    />
  )
}

/**
 * How a rival would answer an offer, read off its own rule (`offerOutlook`), with the part trust plays and, for a score (peace, a call to
 * arms), its terms folded away. Nothing for an offer that cannot be made. Another player decides for themselves: nothing, or with
 * `friend`, "Your friend decides". `blocked`: a yes that would come to nothing, said instead.
 */
function OfferOdds({ target, draft, label, friend, blocked }: { target: NationId; draft: ProposalDraft | null; label?: string; friend?: boolean; blocked?: string | null }) {
  const view = usePlayerView()!
  const { game, player } = view
  const { map } = getWorld()
  const human = game.humans.includes(target) || !!game.nations[target]?.isPlayer
  // Keyed by the terms' text, so a new object with the same terms does not ask again.
  const key = draft ? JSON.stringify(draft) : ''
  const o = useMemo(() => (human || !key || blocked ? null : offerOutlook(game, map, target, player.id, JSON.parse(key) as ProposalDraft)), [game, map, target, player.id, human, key, blocked])
  if (human) return friend && key ? <OddsLine label={label} text="Your friend decides" tone="none" kind="human" /> : null
  if (blocked) return <OddsLine label={label} text="Comes to nothing" tone="bad" reason={blocked} quote={false} kind="unlikely" />
  if (!o) return null
  const v = verdictOf(o.outlook, o.chance, 'accept')
  // Untested trust weighs nothing: saying so on every line is noise.
  const lean = o.trust ? trustLean(o.trust) : null
  return <OddsLine label={label} text={v.text} tone={v.tone} reason={o.reason} extra={lean && lean.tone !== 'none' ? lean : null} factors={o.factors} dice={o.dice} kind={o.outlook} />
}

/**
 * Declaring war as a member of a bloc calls the others in when the month ends: who would join, read off the rules the rivals answer by.
 * Folded to one line; nothing outside a bloc or when the target is in it.
 */
function BlocWarOdds({ target }: { target: NationId }) {
  const { game, player } = usePlayerView()!
  const { map } = getWorld()
  const f = BLOC.on ? factionOf(game, player.id) : null
  const rows = useMemo(() => (f && f.members.length > 1 && !f.members.includes(target) ? callOutlooks(game, map, f, player.id, target, true).members : []), [game, map, f, player.id, target])
  if (!f || !rows.length) return null
  const count = (k: string) => rows.filter((r) => r.o.outlook === k).length
  const parts = [
    { n: count('likely'), text: 'likely', tone: 'good' as const },
    { n: count('unsure'), text: 'may', tone: 'warn' as const },
    { n: count('unlikely'), text: 'unlikely', tone: 'bad' as const },
  ].filter((p) => p.n > 0)
  const friends = count('human')
  return (
    <details className="group/bloc text-[12px] leading-snug" data-testid="bloc-war-odds">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="text-white/75">If you go to war, {f.name}: </span>
        {parts.map((p, i) => (
          <span key={p.text} className={TONE_TEXT[p.tone]}>
            {i > 0 ? ', ' : ''}
            {p.n} {p.text}
          </span>
        ))}
        {parts.length > 0 && <span className="text-white/75"> to join</span>}
        {friends > 0 && <span className="text-white/60">{parts.length ? '; ' : ''}{friends === 1 ? 'your friend decides' : 'your friends decide'}</span>}
        <span className="text-white/45 group-open/bloc:hidden"> · who ▾</span>
        <span className="text-white/45 hidden group-open/bloc:inline"> · ▴</span>
      </summary>
      <div className="mt-1 ml-3">
        <CallOddsList g={game} map={map} f={f} by={player.id} target={target} opening />
      </div>
    </details>
  )
}

function TradeComposer({ target }: { target: NationId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const them = game.nations[target]
  const human = useHumanName(target)
  const [give, setGive] = useState(ZERO)
  const [receive, setReceive] = useState(ZERO)
  const [months, setMonths] = useState(0)
  const prices = useMemo(() => marketPrices(game), [game])
  const terms = { give: compact(give), receive: compact(receive), months }
  const gv = bundleValue(terms.give, prices) * Math.max(1, months)
  const rv = bundleValue(terms.receive, prices) * Math.max(1, months)
  return (
    <div className="space-y-2 rounded-lg bg-black/30 p-2.5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-1.5 items-center text-[13px]">
        <span className="label">Resource</span>
        <span className="label text-right">You give</span>
        <span className="label text-right">You get</span>
        {TRADE_RESOURCES.map((r) => (
          <div key={r} className="contents">
            <div>
              <div>
                {MARKET[r].name} <span className="text-white/55">@ {prices[r].toFixed(2)}</span>
              </div>
              <div className="text-[12px] text-white/55">
                you {Math.floor(stockOf(player, r))} · them {Math.floor(stockOf(them, r))}
              </div>
            </div>
            <AmountInput value={give[r]} onChange={(v) => setGive({ ...give, [r]: v })} />
            <AmountInput value={receive[r]} onChange={(v) => setReceive({ ...receive, [r]: v })} />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-white/70">Schedule</span>
        <select className="bg-[#1c1c20] border border-white/15 rounded px-2 py-0.5" value={months} onChange={(e) => setMonths(+e.target.value)}>
          <option value={0}>One-off exchange</option>
          {[3, 6, TRADE_LIMITS.maxMonths].map((m) => (
            <option key={m} value={m}>
              Every month for {m} months
            </option>
          ))}
        </select>
      </div>
      <div className="text-[12px] text-white/70">
        Market value: you give <span className="text-white">{gv.toFixed(0)}</span>, you get <span className="text-white">{rv.toFixed(0)}</span> money.{' '}
        {rv > 0 && gv / rv < 1 && 'They will want more for it, unless they are short of what you offer.'}
      </div>
      <OfferOdds target={target} draft={gv + rv > 0 ? { kind: 'trade', terms } : null} />
      <OrderButton order={{ type: 'propose', nationId: player.id, target, proposal: { kind: 'trade', terms } }} label="Offer deal" cost={`${PROPOSAL_COSTS.trade} influence`} effect={offerWhen(game, human)} tone="btn-primary" />
    </div>
  )
}

function RegionPick({ ids, picked, toggle }: { ids: RegionId[]; picked: RegionId[]; toggle: (id: RegionId) => void }) {
  const view = usePlayerView()!
  const { map } = getWorld()
  if (!ids.length) return <p className="text-[12px] text-white/55">None available.</p>
  return (
    <div className="max-h-32 overflow-y-auto scroll-thin space-y-0.5 pr-1">
      {ids.map((id) => (
        <label key={id} className="flex items-center justify-between text-[13px] cursor-pointer hover:bg-white/5 rounded px-1">
          <span className="flex items-center gap-1.5">
            <input type="checkbox" checked={picked.includes(id)} onChange={() => toggle(id)} />
            {map.regions[id].name}
          </span>
          <span className="text-white/55">{regionValue(view.game, map, id)}</span>
        </label>
      ))}
    </div>
  )
}

function PeaceComposer({ target }: { target: NationId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const { map } = getWorld()
  const human = useHumanName(target)
  const [cede, setCede] = useState<RegionId[]>([])
  const [reparations, setReparations] = useState(0)
  const [puppet, setPuppet] = useState(false)
  const [territory, setTerritory] = useState(false)
  const [general, setGeneral] = useState(false)
  const [free, setFree] = useState<NationId | ''>('')
  const ties = generalPeaceTies(game, player.id, target)
  const freeable = liberablePuppets(game, player.id, target)
  const hasPuppets = puppetsOf(game, target).length > 0
  const territoryWhy = territoryProblem(game, player.id, target)
  const live = cede.filter((id) => game.regions[id] && (game.regions[id].owner === target || game.regions[id].owner === player.id))
  const terms = { cede: live, reparations: territory ? Math.min(0, reparations) : reparations, ...(puppet ? { puppet: true } : {}), ...(territory ? { territory: true } : {}), ...(free && freeable.includes(free) ? { liberate: free } : {}), ...(general && ties.length ? { general: true } : {}) }
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
    <div className="space-y-2 rounded-lg bg-black/30 p-2.5">
      <div className="flex justify-between text-[13px]">
        <span className="text-white/70">Terms cost</span>
        <span className={cost > budget ? 'text-[#ff8a84]' : 'text-[#6eeb8a]'}>
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
        <div className="flex justify-between text-[13px]">
          <span className="text-white/70">Reparations</span>
          <span>{reparations === 0 ? 'None' : reparations > 0 ? `They pay ${reparations}/mo` : `You pay ${-reparations}/mo`}</span>
        </div>
        <input type="range" className="w-full" min={-MAX_REPARATIONS} max={MAX_REPARATIONS} step={1} value={reparations} onChange={(e) => setReparations(+e.target.value)} />
        <div className="text-[12px] text-white/45">Paid in money for {REPARATION_MONTHS} months.</div>
      </div>
      {!game.nations[target].overlord && !player.overlord && (
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1" checked={puppet} onChange={(e) => { setPuppet(e.target.checked); if (e.target.checked) setTerritory(false) }} />
          <span>
            Make them a puppet state
            <span className="block text-[12px] text-white/65">
              They keep their land but pay you {Math.round(DIPLOMACY.puppet.tribute * 100)}% of their income and cannot declare war. It costs {puppetValue(game, map, target)} war score, and they may break free if they grow strong or restless.
            </span>
          </span>
        </label>
      )}
      {!game.nations[target].overlord && !game.nations[target].territoryOf && !player.overlord && !player.territoryOf && (
        <label className={`flex items-start gap-2 text-[14px] ${territoryWhy ? 'opacity-60' : ''}`} data-testid="territory-term">
          <input type="checkbox" className="mt-1" checked={territory && !territoryWhy} disabled={!!territoryWhy} onChange={(e) => { setTerritory(e.target.checked); if (e.target.checked) { setPuppet(false); setFree('') } }} />
          <span>
            {TERRITORY_TEXT.term}
            <span className="block text-[12px] text-white/65">
              {territoryWhy ? territoryWhy : `${TERRITORY_TEXT.hint} It costs ${territoryValue(game, map, target)} war score (a puppet would cost ${puppetValue(game, map, target)}).`}
            </span>
          </span>
        </label>
      )}
      {hasPuppets && (
        <div className="text-[14px]" data-testid="liberate-term">
          <label className="block">
            {LIBERATE_TEXT.term}
            <select className="field mt-1 block w-full px-3 py-2 text-[14px]" value={free && freeable.includes(free) ? free : ''} onChange={(e) => setFree(e.target.value as NationId | '')} disabled={freeable.length === 0}>
              <option value="">{freeable.length === 0 ? LIBERATE_TEXT.none : 'Do not free a puppet'}</option>
              {freeable.map((id) => (
                <option key={id} value={id}>
                  {LIBERATE_TEXT.short} {game.nations[id].name} ({liberateValue(game, map, id)} war score)
                </option>
              ))}
            </select>
          </label>
          <span className="block text-[12px] text-white/65">{LIBERATE_TEXT.hint}</span>
        </div>
      )}
      {ties.length > 0 && (
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1" checked={general} onChange={(e) => setGeneral(e.target.checked)} />
          <span>
            Include allies on both sides
            <span className="block text-[12px] text-white/65">
              Also ends {ties.length === 1 ? 'the war' : `${ties.length} wars`} between their friends and yours ({ties.slice(0, 4).map(([x, y]) => `${game.nations[x].name}–${game.nations[y].name}`).join(', ')}
              {ties.length > 4 ? ', …' : ''}). A broader peace is harder to sell.
            </span>
          </span>
        </label>
      )}
      <OfferOdds target={target} draft={{ kind: 'peace', terms }} friend />
      <OrderButton
        order={{ type: 'propose', nationId: player.id, target, proposal: { kind: 'peace', terms } }}
        label={live.length === 0 && reparations === 0 && !puppet && !territory && !terms.liberate && !terms.general ? 'Offer peace with no terms' : 'Send terms'}
        cost={`${PROPOSAL_COSTS.peace} influence`}
        effect={offerWhen(game, human)}
        tone="btn-primary"
      />
    </div>
  )
}

/** Loans and investment: lend money, or put money into their business. */
function MoneyComposer({ target, focus }: { target: NationId; focus?: 'loan' | 'invest' }) {
  const view = usePlayerView()!
  // Coming from the Relations desk for a loan or an investment, that part is brought into view and marked.
  const loanRef = useRef<HTMLDivElement>(null)
  const investRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // After the composer has unfolded (0.2 s), or the part would be measured at its folded place.
    const t = setTimeout(() => (focus === 'loan' ? loanRef.current : focus === 'invest' ? investRef.current : null)?.scrollIntoView({ block: 'center' }), 260)
    return () => clearTimeout(t)
  }, [focus])
  const mark = (on: boolean) => (on ? 'rounded-lg ring-1 ring-[#0a84ff]/70 p-2 -m-2' : '')
  const { game, player } = view
  const [amount, setAmount] = useState(100)
  const [months, setMonths] = useState(12)
  const [withPact, setWithPact] = useState(false)
  const [sector, setSector] = useState<SectorId>('manufacturing')
  const L = DIPLOMACY.loan
  const lender = tierOf(player)
  const them = game.nations[target]
  return (
    <div className="space-y-3 rounded-lg bg-black/30 p-2.5">
      <div ref={loanRef} className={`space-y-1.5 ${mark(focus === 'loan')}`} data-compose-part="loan">
        <div className="text-[15px] font-semibold">Lend them money</div>
        <div className="flex justify-between text-[14px]">
          <span className="text-white/75">Amount</span>
          <span className="tabular-nums">{amount}</span>
        </div>
        <input type="range" className="w-full" aria-label="Loan amount" min={L.min} max={lender.loanMax} step={10} value={Math.min(amount, lender.loanMax)} onChange={(e) => setAmount(+e.target.value)} />
        <div className="flex justify-between text-[14px]">
          <span className="text-white/75">Repaid over</span>
          <span className="tabular-nums">{months} months</span>
        </div>
        <input type="range" className="w-full" aria-label="Loan length" min={L.minMonths} max={lender.loanMonths} step={1} value={Math.min(months, lender.loanMonths)} onChange={(e) => setMonths(+e.target.value)} />
        {lender.loanPact && (
          <label className="flex items-center justify-between gap-3 text-[14px]">
            <span>
              World Bank terms
              <span className="block text-[12px] text-white/65">They sign a non-aggression pact for as long as the loan runs, and think well of you for it.</span>
            </span>
            <input type="checkbox" checked={withPact} onChange={(e) => setWithPact(e.target.checked)} aria-label="Attach a non-aggression pact" />
          </label>
        )}
        <p className="text-[12px] text-white/55">A {lender.name} lends up to {lender.loanMax} for {lender.loanMonths} months. A bigger empire lends more.</p>
        <p className="text-[13px] text-white/70">
          They pay {loanPayment(amount, months).toFixed(1)} a month, {(loanPayment(amount, months) * months - amount).toFixed(0)} more than you lend. Someone who cannot pay breaks the deal and loses your trust.
        </p>
        <OfferOdds target={target} draft={{ kind: 'loan', amount: Math.min(amount, lender.loanMax), months: Math.min(months, lender.loanMonths), ...(withPact && lender.loanPact ? { pact: true } : {}) }} />
        <OrderButton order={{ type: 'propose', nationId: player.id, target, proposal: { kind: 'loan', amount: Math.min(amount, lender.loanMax), months: Math.min(months, lender.loanMonths), ...(withPact && lender.loanPact ? { pact: true } : {}) } }} label="Offer the loan" cost={`${PROPOSAL_COSTS.loan} influence`} effect="Money moves when they accept" tone="btn-primary" />
      </div>
      <div ref={investRef} className={`space-y-1.5 border-t border-white/10 pt-3 ${mark(focus === 'invest')}`} data-compose-part="invest">
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
  const openRelations = useGame((s) => s.openRelations)
  const { game, player } = view
  const { map } = getWorld()
  const ref = useRef<HTMLDivElement>(null)
  // Coming from the Wars tab or the Relations desk, the composer asked for is already open: peace, a trade deal, a loan or an investment, or the treaties.
  const [compose] = useState<DiploCompose | null>(() => (focused ? useGame.getState().diploCompose : null))
  const [mode, setMode] = useState<'none' | 'trade' | 'peace' | 'money'>(() => {
    const war = atWar(game, player.id, id)
    if (compose === 'peace') return war ? 'peace' : 'none'
    if (war) return 'none'
    return compose === 'trade' ? 'trade' : compose === 'loan' || compose === 'invest' ? 'money' : 'none'
  })
  const treatyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (compose !== 'treaty') return
    const t = setTimeout(() => treatyRef.current?.scrollIntoView({ block: 'center' }), 260)
    return () => clearTimeout(t)
  }, [compose])
  useEffect(() => {
    // A composer part (treaties, a loan, an investment) brings itself into view; a smooth scroll of the row would carry it away again.
    if (focused && compose !== 'treaty' && compose !== 'loan' && compose !== 'invest') ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focused, compose])
  const n = game.nations[id]
  const war = atWar(game, player.id, id)
  const allied = isAllied(game, player.id, id)
  const pact = hasPact(game, player.id, id)
  const cb = hasCasusBelli(game, player.id, id)
  const theirCb = hasCasusBelli(game, id, player.id)
  const borders = ctx.neighbors.has(id)
  const report = useMemo(() => opinionReport(game, map, id, player.id, { borders, coalition: ctx.coalition }), [game, map, id, player.id, borders, ctx.coalition])
  const seen = powerView(game, player.id, id)
  const power = seen.value
  const persona = PERSONALITIES[n.personality]
  const human = useHumanName(id)
  const bloc = blocOf(game, id)
  const inFaction = factionChip(game, id, player.id)
  const callable = allied ? enemiesOf(game, player.id).filter((e) => !atWar(game, id, e) && !isAllied(game, id, e) && !hasPact(game, id, e)) : []
  const sanctionedByMe = game.sanctions.some((x) => x.from === player.id && x.to === id && x.until >= game.turn)
  const status = n.territoryOf ? `Territory of ${game.nations[n.territoryOf]?.name ?? 'someone'}${n.territoryOf === player.id ? ' · yours' : ''}` : n.overlord ? `Puppet of ${game.nations[n.overlord]?.name ?? 'someone'}${n.overlord === player.id && n.loyalty !== undefined ? ` · loyalty ${Math.round(n.loyalty)}` : ''}` : war ? 'At war' : allied ? 'Ally' : pact ? `Pact until ${turnDate(game.pacts[pairKey(player.id, id)])}` : 'At peace'
  const statusColor = war ? 'text-[#ff8a84]' : allied ? 'text-[#64d2ff]' : pact ? 'text-[#6eeb8a]' : 'text-white/70'
  const toggle = (m: 'trade' | 'peace' | 'money') => setMode((cur) => (cur === m ? 'none' : m))
  // Treaties, trade, money, war and the bloc fold away, so the list reads as a list. A row you came to opens unfolded.
  const [open, setOpen] = useState(focused)
  return (
    <div
      ref={ref}
      className={`rounded-lg border p-3 space-y-2 transition-shadow ${war ? 'border-[#ff453a]/50 bg-[#ff453a]/6' : allied ? 'border-[#0a84ff]/40 bg-[#0a84ff]/8' : 'border-white/12 bg-white/5'} ${focused ? 'shadow-[0_0_0_1px_rgba(10,132,255,0.7),0_0_18px_rgba(10,132,255,0.25)]' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <button className="flex items-center gap-2 hover:underline min-w-0" onClick={() => selectRegion(n.capital)}>
          <Dot color={n.color} />
          <span className="font-semibold truncate">{n.name}</span>
        </button>
        <span className="flex items-center gap-2">
          <LocateButton id={id} compact />
          <span className={`text-[12px] font-medium whitespace-nowrap ${statusColor}`}>{status}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 text-[12px] text-white/70">
        {human ? (
          <span className="chip chip-blue" title="Another player runs this nation, not the AI. Offers wait in their inbox.">
            Played by {human}
          </span>
        ) : (
          <span className="chip" title={persona.description}>
            {persona.name}
          </span>
        )}
        {bloc && <span className="chip chip-blue" title={`Tied by alliances: ${bloc.members.map((m) => game.nations[m]?.name).join(', ')}. Not the same as a bloc of the Bloc desk.`}>{allianceName(bloc.name)}</span>}
        {n.territoryOf && <span className="chip chip-blue" title={`Held for ever by ${game.nations[n.territoryOf]?.name}: ${Math.round(TERRITORY.cut * 100)}% of its revenue goes to its master, it fights in every war and sits in its master's faction.`}>Territory of {game.nations[n.territoryOf]?.name}</span>}
        {inFaction && <span className={`chip ${inFaction.tone === 'good' ? 'chip-green' : ''}`} title="Their faction">{inFaction.text}</span>}
        <span>
          {regionsOf(game, id).length === 1 ? '1 country' : `${regionsOf(game, id).length} countries`} · strength {showPower(seen)} ({power > ctx.myPower ? 'stronger than you' : 'weaker than you'})
        </span>
      </div>
      {(cb || theirCb) && (
        <div className="text-[12px]">
          {cb && <span className="text-[#ffd60a]">You have a grievance, so war is cheaper. </span>}
          {theirCb && <span className="text-[#ff8a84]">They have a grievance against you.</span>}
        </div>
      )}
      <OpinionMeter report={report} />
      {war && <WarLine target={id} />}
      {!war && (
        <div className="flex flex-wrap gap-1.5">
          <button className="btn btn-quiet px-3 py-1.5 text-[13px]" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-row-actions>
            {open ? 'Hide actions' : 'Treaties, trade and more'} <span aria-hidden>{open ? '▴' : '▾'}</span>
          </button>
          <button className="btn px-3 py-1.5 text-[13px]" onClick={() => openRelations(id)} title="Visits, embassies, aid, ventures, joint war plans and favours">
            Build relations →
          </button>
        </div>
      )}
      {(war || open) && <>
      {!war && <FactionRow id={id} />}
      <div className="flex flex-wrap gap-1.5">
        {war ? (
          <button className={`btn btn-primary ${mode === 'peace' ? 'bg-[#0a84ff]/25' : ''}`} onClick={() => toggle('peace')}>
            Negotiate peace
          </button>
        ) : (
          <>
            <button className={`btn btn-primary ${mode === 'trade' ? 'bg-[#0a84ff]/25' : ''}`} onClick={() => toggle('trade')}>
              Trade
            </button>
            <button className={`btn ${mode === 'money' ? 'bg-[#0a84ff]/25' : ''}`} onClick={() => toggle('money')}>
              Loans and investment
            </button>
            {!allied && (
              <OrderButton
                order={{ type: 'declareWar', nationId: player.id, target: id }}
                label="Declare war"
                explain={(why) => warRefusal(game, player.id, id, why)}
                cost={`${warCost(game, player.id, id)} influence`}
                effect={cb ? `Reason: ${justificationOf(game, player.id, id)?.reason}. Then attack from the War Room.` : 'No reason to fight: costs stability and the world will distrust you. Build a case first.'}
                tone="btn-red"
              />
            )}
            {n.territoryOf === player.id && (
              <OrderButton order={{ type: 'annexTerritory', nationId: player.id, target: id }} label="Annex" cost={`${annexTerritoryCost(game, id)} influence`} effect={`Its land, army and treasury join yours. A territory must serve ${TERRITORY.annexMonths} months first.`} />
            )}
            {n.overlord === player.id && (
              <OrderButton order={{ type: 'annexPuppet', nationId: player.id, target: id }} label="Annex" cost={`${annexCost(game, id)} influence`} effect={`Its land, army and treasury join yours. A puppet must serve ${EMPIRE.annexMonths} months first.`} />
            )}
            {!allied && !cb && (
              <OrderButton
                order={{ type: 'buildCase', nationId: player.id, target: id }}
                label="Build a case"
                cost={`${JUSTIFY.caseCost} influence`}
                effect={`A reason for war, ready in ${JUSTIFY.caseMonths} months.`}
              />
            )}
            {allied && <OrderButton order={{ type: 'leaveAlliance', nationId: player.id, target: id }} label="Leave alliance" cost={`${COSTS.leaveAlliance} influence`} tone="btn-quiet" />}
            {pact && !allied && <OrderButton order={{ type: 'breakPact', nationId: player.id, target: id }} label="Break the pact" cost={`${COSTS.breakPact} influence`} effect="They will remember it, and so will the world" tone="btn-quiet" />}
          </>
        )}
      </div>
      {!war && !allied && <BlocWarOdds target={id} />}
      {!war && !allied && (
        <div ref={treatyRef} className={`space-y-1.5 ${compose === 'treaty' ? 'rounded-lg ring-1 ring-[#0a84ff]/70 p-2' : ''}`} data-compose-part="treaty">
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
        {!pact && <OfferOdds target={id} draft={{ kind: 'pact' }} label="Pact" />}
        <OfferOdds target={id} draft={{ kind: 'alliance' }} label="Alliance" />
        <OfferOdds target={id} draft={{ kind: 'guarantee' }} label="Guarantee" />
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
          {n.territoryOf === player.id && <OrderButton order={{ type: 'releaseTerritory', nationId: player.id, target: id }} label="Release" effect="It leaves your faction and keeps all it earns" />}
          {n.overlord === player.id && <OrderButton order={{ type: 'releasePuppet', nationId: player.id, target: id }} label="Set free" effect="They stop paying tribute and will thank you" />}
        </div>
      )}
      {callable.length > 0 && (
        <div className="space-y-1.5">
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
          {callable.map((e) => (
            <OfferOdds key={e} target={id} draft={{ kind: 'callToArms', enemy: e }} label={callable.length > 1 ? `Against ${game.nations[e].name}` : 'Call to arms'} friend blocked={joinWarBlocked(game, id, e)} />
          ))}
        </div>
      )}
      </>}
      <AnimatePresence initial={false}>
        {mode !== 'none' && (war || open) && (
          <motion.div key={mode} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            {mode === 'trade' ? <TradeComposer target={id} /> : mode === 'money' ? <MoneyComposer target={id} focus={compose === 'loan' || compose === 'invest' ? compose : undefined} /> : <PeaceComposer target={id} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const DISPATCH_COLOR: Record<Dispatch['kind'], string> = {
  proposal: 'text-[#ffd60a]',
  accepted: 'text-[#6eeb8a]',
  joined: 'text-[#6eeb8a]',
  completed: 'text-[#6eeb8a]',
  rejected: 'text-[#ff8a84]',
  ignored: 'text-[#ff8a84]',
  broken: 'text-[#ff8a84]',
  expired: 'text-white/70',
}

const CRISIS_STAGE = ['Rumor', 'Disturbance', 'On the brink']

/** Trouble brewing around the world, and what you can do about it. */
function CrisisCards({ game, me }: { game: GameState; me: NationId }) {
  const list = game.crises.filter((c) => c.stage >= 1)
  if (list.length === 0) return null
  return (
    <section className="space-y-2">
      <div className="label text-[#ffd60a]">The world is watching</div>
      {list.map((c) => {
        const nation = game.nations[c.nation]?.name
        const rival = c.rival ? game.nations[c.rival]?.name : null
        const mine = c.nation === me || c.rival === me
        return (
          <div key={c.id} className="inset-card p-3 space-y-2" style={{ borderLeft: '3px solid #ffd60a' }}>
            <div>
              <div className="label">{CRISIS_STAGE[c.stage]} · {c.area}</div>
              <div className="text-[15px] font-semibold">{c.kind === 'unrest' ? `Unrest in ${nation}` : `${rival} threatens ${nation}`}</div>
              <p className="text-[13px] text-white/70">{c.kind === 'unrest' ? 'It could end in uprisings. Friends can help.' : 'It could end in war. You can calm it, or take a side.'}</p>
            </div>
            {!mine && (
              <div className="flex flex-wrap gap-1.5">
                <OrderButton order={{ type: 'crisisAction', nationId: me, crisisId: c.id, action: 'aid' }} label="Send aid" cost={`${CRISIS.aidMoney} money, ${CRISIS.aidInfluence} influence`} effect={`Makes trouble less likely. ${nation} remembers it.`} />
                {c.kind === 'dispute' && <OrderButton order={{ type: 'crisisAction', nationId: me, crisisId: c.id, action: 'mediate' }} label="Mediate" cost={`${CRISIS.mediateInfluence} influence`} effect="Both sides listen. War is less likely." />}
                {c.kind === 'dispute' && <OrderButton order={{ type: 'crisisAction', nationId: me, crisisId: c.id, action: 'support' }} label={`Back ${nation}`} cost={`${CRISIS.supportInfluence} influence`} effect={`Gives you a reason to fight ${rival}. They resent it, and others are uneasy for a while.`} />}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

export function DiplomacyPanel() {
  const view = usePlayerView()
  const focus = useGame((s) => s.diploFocus)
  const [tab, setTab] = useState<'nations' | 'ledger'>('nations')
  const composeIntent = useGame((s) => s.diploCompose)
  // Coming from a war or the Relations desk, the row opens on its composer: a new key starts it fresh even when the panel was already open.
  const rowKey = (id: NationId) => (focus === id && composeIntent ? `${id}:${composeIntent}` : id)
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const game = view?.game
  const ctx = useMemo<RowContext | null>(() => {
    if (!game) return null
    const { map } = getWorld()
    return { neighbors: nationNeighbors(game, map, game.playerId), coalition: coalitionActive(game, map), myPower: militaryPower(game, game.playerId) }
  }, [game])
  if (!view || !ctx || !game) return null
  const { player } = view
  const me = player.id
  const { map } = getWorld()
  const inboxAll = game.proposals.filter((p) => p.to === me)
  const moot = new Set(inboxAll.filter((p) => offerIsMoot(game, map, p, view.orders)).map((p) => p.id))
  const inbox = inboxAll.filter((p) => !moot.has(p.id))
  const stale = inboxAll.filter((p) => moot.has(p.id))
  // Offers that stay in the game after a month ended are ones to another player, who has not answered yet.
  const sent = game.proposals.filter((p) => p.from === me)
  const deals = game.deals.filter((d) => d.from === me || d.to === me)
  const mine = game.dispatches.filter((d) => d.from === me || d.to === me)
  const world = game.dispatches.filter((d) => d.from !== me && d.to !== me)
  const blocs = blocsOf(game)

  const closeList = closeNations(game, me, ctx.neighbors, focus)
  const close = new Set<NationId>(closeList)
  const majors = Object.values(game.nations)
    .filter((n) => n.alive && n.id !== me && !close.has(n.id))
    .sort((a, b) => regionsOf(game, b.id).length - regionsOf(game, a.id).length || powerView(game, me, b.id).value - powerView(game, me, a.id).value)
    .slice(0, 6)

  return (
    <PanelShell title="Diplomacy" kicker={`${count(enemiesOf(game, me).length, 'war', 'wars')} · ${count(alliesOf(game, me).length, 'ally', 'allies')} · ${inbox.length} waiting on you. ${isLive(game) ? 'Rivals answer offers the same day.' : game.multiplayer ? 'AI nations answer when the month ends; players see offers when the next month begins.' : 'Offers are answered when the month ends.'}`} panel="diplomacy" wide={!focus && tab === 'ledger'} tabs={<Tabs value={focus ? 'nations' : tab} onChange={(t) => { if (focus) openDiplomacy(null); setTab(t) }} options={[['nations', 'Nations'], ['ledger', 'Ledger']] as const} />}>
      {!focus && tab === 'ledger' && <Ledger game={game} onOpen={(id) => { setTab('nations'); openDiplomacy(id) }} />}
      {(focus || tab === 'nations') && <>
      {ctx.coalition && (
        <div className="rounded-lg border border-[#ff453a]/50 bg-[#ff453a]/10 p-3 text-[13px] text-[#ff8a84]">
          Your growing power alarms the world. Neighbors now distrust you and are quicker to band together against you.
        </div>
      )}
      <AnimatePresence initial={false}>
        {inbox.length > 0 && (
          <motion.section key="inbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
            <div className="label text-[#ffd60a]">Awaiting your answer</div>
            <AnimatePresence initial={false}>
              {inbox.map((p) => (
                <InboxCard key={p.id} p={p} />
              ))}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>
      {stale.length > 0 && (
        <details className="details-card" data-stale-offers={stale.length}>
          <summary>
            {stale.length === 1 ? 'An offer that is no longer possible' : `${stale.length} offers that are no longer possible`}
          </summary>
          <div className="space-y-2 pt-2">
            {stale.map((p) => (
              <InboxCard key={p.id} p={p} moot />
            ))}
          </div>
        </details>
      )}
      <CrisisCards game={game} me={me} />
      {sent.length > 0 && (
        <section className="space-y-1.5" aria-label="Offers you sent">
          <div className="label">Waiting on other players</div>
          {sent.map((p) => (
            <div key={p.id} className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-[13px] flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{game.nations[p.to]?.name}</span> <span className="text-white/70">· {PROPOSAL_LABELS[p.kind]}</span>
              </span>
              <span className="text-white/55 whitespace-nowrap">{Math.max(0, p.expires - game.turn) + 1} months left</span>
            </div>
          ))}
        </section>
      )}
      <FactionNoticeLine game={game} me={me} />
      {blocs.length > 0 && (
        <details className="details-card">
          <summary>Alliance groups in the world ({blocs.length})</summary>
          <div className="space-y-2 pt-2">
          <p className="text-[12px] text-white/60">Nations tied together by alliances. These are not the blocs of the Bloc desk.</p>
          {blocs.slice(0, 6).map((b) => {
            const mineBloc = b.members.includes(me)
            return (
              <div key={b.leader} className={`rounded-lg border p-2.5 text-[13px] ${mineBloc ? 'border-[#0a84ff]/50 bg-[#0a84ff]/8' : 'border-white/12 bg-white/5'}`}>
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{allianceName(b.name)}{mineBloc ? ' (yours)' : ''}</span>
                  <span className="text-white/70 tabular-nums">strength {b.power.toFixed(0)}</span>
                </div>
                <div className="text-white/75 mt-0.5">{b.members.map((id) => game.nations[id]?.name).join(', ')}</div>
              </div>
            )
          })}
          </div>
        </details>
      )}
      {mine.length > 0 && (
        <section className="space-y-1.5">
          <div className="label">{isLive(game) ? 'This month' : 'Last month'}</div>
          {mine.map((d, i) => (
            <p key={i} className={`text-[13px] border-l-2 border-white/15 pl-2 ${DISPATCH_COLOR[d.kind]}`}>
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
          <NationRow key={rowKey(id)} id={id} ctx={ctx} focused={focus === id} />
        ))}
      </section>
      {majors.length > 0 && (
        <section className="space-y-2">
          <div className="label">The biggest powers elsewhere</div>
          {majors.map((n) => (
            <NationRow key={rowKey(n.id)} id={n.id} ctx={ctx} focused={focus === n.id} />
          ))}
        </section>
      )}
      {world.length > 0 && (
        <details className="details-card">
          <summary>Around the world ({Math.min(8, world.length)})</summary>
          <div className="space-y-1.5 pt-2">
            {world.slice(-8).map((d, i) => (
              <p key={i} className="text-[12px] text-white/70 border-l-2 border-white/8 pl-2">
                {d.text}
              </p>
            ))}
          </div>
        </details>
      )}
      </>}
    </PanelShell>
  )
}
