import { useMemo, useState } from 'react'
import { PUPPET, PUPPET_LAW_IDS, PUPPET_SPENDING_KEYS, TRIBUTE, TRIBUTE_FORMS } from '../data/puppets'
import { SPENDING } from '../data/people'
import { LAW_SPECS, DRAFT_LIMITS, TAX_LIMITS } from '../data/unitTypes'
import { EMPIRE } from '../data/war'
import { garrisonDivisions, landBorders } from '../engine/deployment'
import { annexCost, validateOrder } from '../engine/orders'
import { regionsOf, puppetsOf } from '../engine/helpers'
import { aidGain, countWeight, equilibrium, extraction, governProblem, pressureOf, previewGovern, tributeOf, yieldOf } from '../engine/puppets'
import type { Nation, NationId, Order, PuppetPatch, Spending, TributeForm } from '../engine/types'
import { getWorld } from '../map/world'
import { DataList } from './DataList'
import { Card, Line } from './economy/parts'
import { Bar, Pending, StatTile, Tiles } from './kit'
import { OrderButton } from './panel'
import { usePlayerView } from './hooks'
import { ConfirmButton, CostEffect, EmptyState, NumberStepper } from './widgets'
import { useGame } from '../store'

const pctTxt = (v: number) => `${Math.round(v * 100)}%`
const signed1 = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`
const loyaltyTone = (v: number) => (v >= PUPPET.high ? '#30d158' : v >= PUPPET.restive ? '#0a84ff' : v >= PUPPET.rebelBelow ? '#ffd60a' : '#ff453a')
const loyaltyWord = (v: number) => (v >= PUPPET.high ? 'Devoted' : v >= 50 ? 'Loyal' : v >= PUPPET.restive ? 'Wavering' : v >= PUPPET.freeBelow ? 'Restive' : 'On the brink')
const unitOf = (f: TributeForm) => (f === 'money' ? 'money' : f === 'levy' ? 'thousand soldiers' : f)

type Govern = Extract<Order, { type: 'governPuppet' }>

/** The Puppets desk: every puppet of yours, its loyalty and tribute, and a card to rule each one. */
export default function PuppetsTab() {
  const view = usePlayerView()
  if (!view) return null
  const { game, player, orders } = view
  const { map } = getWorld()
  const ids = puppetsOf(game, player.id)
  const ex = ids.length ? extraction(game, map, player.id) : { total: 0, cap: 0 }
  const mean = ids.length ? ids.reduce((t, id) => t + (game.nations[id].loyalty ?? PUPPET.start), 0) / ids.length : 0
  if (ids.length === 0) return <EmptyState title="No puppets yet" body="Win a war with a crushing score and ask for a puppet state in the peace terms. It will pay tribute and fight beside you, and you rule it from here." />
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-white/75">
        A puppet is yours to rule. Its <strong>loyalty</strong> moves each month with how hard you press it (taxes, draft, laws, the tribute you take) against what you give back (aid, investment, a garrison, decent spending), and settles where those balance. A loyal puppet pays more, fights beside you and counts for more in your empire; a restive one rebels, refuses your wars and may break free. You can change one puppet's rules once a month.
      </p>
      <Tiles>
        <StatTile label="Puppets" value={ids.length} sub={(() => { const n = ids.reduce((t, id) => t + regionsOf(game, id).length, 0); return `${n} ${n === 1 ? 'country' : 'countries'}` })()} />
        <StatTile label="Tribute a month" value={ex.total.toFixed(1)} sub={`cap ${ex.cap.toFixed(0)} (${pctTxt(PUPPET.extractionCap)} of your income)`} tone={ex.total > ex.cap ? 'warn' : undefined} />
        <StatTile label="Average loyalty" value={Math.round(mean)} sub={loyaltyWord(mean)} tone={mean < PUPPET.restive ? 'bad' : mean < 50 ? 'warn' : 'good'} />
      </Tiles>
      <DataList
        label="Your puppets"
        rows={ids.map((id) => game.nations[id])}
        rowKey={(n) => n.id}
        searchText={(n) => n.name}
        noun={['puppet', 'puppets']}
        minForToolbar={5}
        sorts={[
          { id: 'loyalty', label: 'Loyalty', dir: 'asc', value: (n) => n.loyalty ?? PUPPET.start },
          { id: 'size', label: 'Size', dir: 'desc', value: (n) => regionsOf(game, n.id).length },
          { id: 'name', label: 'Name', dir: 'asc', value: (n) => n.name },
        ]}
        renderRow={(n) => <PuppetCard key={n.id} puppet={n} pending={orders.some((o) => o.type === 'governPuppet' && o.target === n.id)} />}
      />
    </div>
  )
}

function PuppetCard({ puppet, pending }: { puppet: Nation; pending: boolean }) {
  const view = usePlayerView()!
  const { game, player } = view
  const { map } = getWorld()
  const [open, setOpen] = useState(false)
  const loyalty = puppet.loyalty
  const tr = tributeOf(puppet)
  const y = yieldOf(game, map, puppet, tr)
  const countries = regionsOf(game, puppet.id).length
  const served = game.turn - (puppet.overlordSince ?? 0)
  const annexable = served >= EMPIRE.annexMonths
  const human = game.humans.includes(puppet.id)
  const issueOrder = useGame((s) => s.issueOrder)
  return (
    <article className="inset-card p-3.5 space-y-3" aria-label={`${puppet.name}, a puppet of yours`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold truncate">{puppet.name}</h3>
          <div className="text-[12px] text-white/65">
            {countries} {countries === 1 ? 'country' : 'countries'} · counts {Math.floor(countries * countWeight(puppet) * 10) / 10} · stability {Math.round(puppet.stability)} · {served} {served === 1 ? 'month' : 'months'} in service
          </div>
        </div>
        <button className="btn btn-quiet px-3 py-1 text-[13px] shrink-0" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Rule it'}
        </button>
      </div>
      {loyalty !== undefined ? (
        <div className="space-y-1">
          <div className="flex justify-between text-[13px]">
            <span>
              Loyalty <strong className="tabular-nums">{Math.round(loyalty)}</strong> · {loyaltyWord(loyalty)}
            </span>
            <span className="text-white/65">{loyalty < PUPPET.rebelBelow ? 'rebels and revolt' : loyalty < PUPPET.warLoyalty ? 'will not follow you to war' : loyalty >= PUPPET.high ? 'pays more, counts more' : ''}</span>
          </div>
          <Bar value={loyalty / 100} color={loyaltyTone(loyalty)} label={`${puppet.name} loyalty`} />
        </div>
      ) : (
        <p className="text-[12px] text-[#ffd60a]">An older arrangement: it pays a flat {pctTxt(0.12)} of its income and its loyalty is not tracked. Ruling it for the first time takes it in hand.</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px]">
        <Mini k="Tribute" v={`${pctTxt(tr.share)} of ${TRIBUTE[tr.form].of}`} />
        <Mini k="A month" v={`${y.amount.toFixed(1)} ${unitOf(tr.form)}`} />
        <Mini k="Tax / draft" v={`${pctTxt(puppet.taxRate)} / ${pctTxt(puppet.draftRate)}`} />
        <Mini k="Laws" v={puppet.laws.length ? puppet.laws.map((l) => LAW_SPECS[l].name).join(', ') : 'none'} />
      </div>
      <Pending show={pending} text={`Your new rules for ${puppet.name} take effect when the month ends`} />
      {open && (human ? <p className="text-[13px] text-white/75">{puppet.name} is run by another player. Its tax, laws and spending are theirs; it still pays you tribute and its loyalty still moves.</p> : <Controls puppet={puppet} pending={pending} />)}
      <div className="flex flex-wrap gap-1.5">
        <OrderButton
          order={{ type: 'annexPuppet', nationId: player.id, target: puppet.id }}
          label="Annex"
          cost={`${annexCost(game, puppet.id)} influence`}
          effect={annexable ? (loyalty === undefined ? 'Its land, army and treasury join yours.' : loyalty >= 70 ? 'Loyal: it joins you cheaply and settles at once.' : loyalty < 40 ? 'Restive: it costs more and its land settles slowly.' : 'Its land, army and treasury join yours.') : `Must serve ${EMPIRE.annexMonths} months first`}
        />
        <ConfirmButton
          label="Set it free"
          title={`Set ${puppet.name} free?`}
          text={`${puppet.name} becomes independent. Its tribute stops, it no longer counts toward your empire, and it will not fight beside you. It will remember it kindly.`}
          confirmLabel="Set it free"
          danger
          className="btn-quiet px-3 py-1 text-[13px]"
          onConfirm={() => issueOrder({ type: 'releasePuppet', nationId: player.id, target: puppet.id })}
        />
      </div>
      {open && <Garrison puppet={puppet} />}
    </article>
  )
}

const Mini = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-lg bg-white/5 px-2.5 py-1.5 min-w-0">
    <div className="label">{k}</div>
    <div className="truncate" title={v}>
      {v}
    </div>
  </div>
)

/** What the master changes, as a draft; the preview and the order are worked out from it. */
function Controls({ puppet, pending }: { puppet: Nation; pending: boolean }) {
  const view = usePlayerView()!
  const { game, player, orders } = view
  const { map } = getWorld()
  const cur = tributeOf(puppet)
  const [tax, setTax] = useState(Math.round(puppet.taxRate * 100))
  const [draft, setDraft] = useState(Math.round(puppet.draftRate * 100))
  const [form, setForm] = useState<TributeForm>(cur.form)
  const [share, setShare] = useState(Math.round(cur.share * 100))
  const [spend, setSpend] = useState<Partial<Spending>>({})
  const [law, setLaw] = useState<{ id: (typeof PUPPET_LAW_IDS)[number]; on: boolean } | null>(null)
  const [aid, setAid] = useState(0)
  const spec = TRIBUTE[form]
  const pickForm = (f: TributeForm) => {
    setForm(f)
    setShare(Math.round((f === cur.form ? cur.share : TRIBUTE[f].easy) * 100))
  }
  const patch: PuppetPatch = {}
  if (Math.abs(tax / 100 - puppet.taxRate) > 1e-9) patch.taxRate = tax / 100
  if (Math.abs(draft / 100 - puppet.draftRate) > 1e-9) patch.draftRate = draft / 100
  if (form !== cur.form || Math.abs(share / 100 - cur.share) > 1e-9) patch.tribute = { form, share: share / 100 }
  const spendChanges = Object.fromEntries(Object.entries(spend).filter(([k, v]) => v !== puppet.spending[k as keyof Spending])) as Partial<Spending>
  if (Object.keys(spendChanges).length) patch.spending = spendChanges
  if (law) patch.law = law
  if (aid > 0) patch.aid = aid
  const any = Object.keys(patch).length > 0
  const order: Govern = { type: 'governPuppet', nationId: player.id, target: puppet.id, patch }
  const why = any ? governProblem(game, order, orders.filter((o) => !(o.type === 'governPuppet' && o.target === puppet.id))) : null
  // The patch is rebuilt every render; keying the preview on its text keeps it from being recomputed until something actually changes.
  const patchKey = JSON.stringify(patch)
  const stablePatch = useMemo(() => JSON.parse(patchKey) as PuppetPatch, [patchKey])
  const pv = useMemo(() => (any ? previewGovern(game, map, player.id, puppet.id, stablePatch) : null), [game, map, player.id, puppet.id, any, stablePatch])
  const base = useMemo(() => {
    const p = pressureOf(game, map, puppet)
    return { parts: p.parts, total: p.total, settles: equilibrium(p.total) }
  }, [game, map, puppet])
  const ex = useMemo(() => extraction(game, map, player.id), [game, map, player.id])
  const toggleLaw = (id: (typeof PUPPET_LAW_IDS)[number]) => setLaw((c) => (c?.id === id ? null : { id, on: !puppet.laws.includes(id) }))
  const reset = () => {
    setTax(Math.round(puppet.taxRate * 100))
    setDraft(Math.round(puppet.draftRate * 100))
    setForm(cur.form)
    setShare(Math.round(cur.share * 100))
    setSpend({})
    setLaw(null)
    setAid(0)
  }
  const aidNow = aid > 0 ? aidGain(game, map, puppet.id, aid) : 0
  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <div className="label">Tax rate</div>
          <NumberStepper label="Tax rate" unit="%" value={tax} min={Math.round(TAX_LIMITS.min * 100)} max={Math.round(PUPPET.maxTax * 100)} step={1} onChange={setTax} hint={`Neutral ${pctTxt(PUPPET.tax.neutral)}; above it loyalty falls each month. Up to ${pctTxt(PUPPET.maxTax)}.`} />
        </div>
        <div className="space-y-1">
          <div className="label">Draft rate</div>
          <NumberStepper label="Draft rate" unit="%" value={draft} min={Math.round(DRAFT_LIMITS.min * 100)} max={Math.round((puppet.laws.includes('conscription_act') || law?.id === 'conscription_act' ? PUPPET.maxDraft : DRAFT_LIMITS.max) * 100)} step={1} onChange={setDraft} hint={`Neutral ${pctTxt(PUPPET.draft.neutral)}. More than 20% needs the Conscription law.`} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="label">Tribute</div>
        <div role="radiogroup" aria-label="Form of tribute" className="flex flex-wrap gap-1">
          {TRIBUTE_FORMS.map((f) => (
            <button key={f} role="radio" aria-checked={form === f} className={`btn ${form === f ? 'btn-primary' : 'btn-quiet'} px-3 py-1 text-[13px]`} onClick={() => pickForm(f)}>
              {TRIBUTE[f].name}
            </button>
          ))}
        </div>
        <NumberStepper label={`Share of ${spec.of}`} unit="%" value={share} min={Math.round(spec.min * 100)} max={Math.round(spec.max * 100)} step={1} onChange={setShare} hint={`${pctTxt(spec.easy)} costs no loyalty; more is resented.`} />
      </div>
      <div className="space-y-2">
        <div className="label">Laws you may set (at most {PUPPET.maxLaws})</div>
        <div className="flex flex-wrap gap-1.5">
          {PUPPET_LAW_IDS.map((id) => {
            const inForce = puppet.laws.includes(id)
            const on = law?.id === id ? law.on : inForce
            return (
              <button key={id} className={`btn ${on ? 'btn-primary' : 'btn-quiet'} px-3 py-1 text-[13px]`} aria-pressed={on} title={`${PUPPET.laws[id]!.blurb} Loyalty ${signed1(PUPPET.laws[id]!.held)} a month.`} onClick={() => toggleLaw(id)}>
                {LAW_SPECS[id].name}
                {law?.id === id ? (law.on ? ' (enact)' : ' (repeal)') : ''}
              </button>
            )
          })}
        </div>
        <p className="text-[12px] text-white/65">{law ? `${law.on ? 'Enacting' : 'Repealing'} ${LAW_SPECS[law.id].name}: ${PUPPET.laws[law.id]!.blurb}` : 'One law a month. Each one costs loyalty every month it stands.'}</p>
      </div>
      <div className="space-y-2">
        <div className="label">Spending on its people</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PUPPET_SPENDING_KEYS.map((k) => {
            const v = spend[k] ?? puppet.spending[k]
            return (
              <label key={k} className="flex items-center justify-between gap-2 text-[13px]">
                <span>{SPENDING[k].name}</span>
                <select className="field px-2 py-1" aria-label={`${SPENDING[k].name} for ${puppet.name}`} value={v} onChange={(e) => setSpend((p) => ({ ...p, [k]: +e.target.value }))}>
                  {SPENDING[k].levels.map((name, i) => (
                    <option key={name} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </div>
      </div>
      <div className="label">Aid</div>
      <NumberStepper label="Aid" unit="money" value={aid} onChange={setAid} min={0} max={PUPPET.aid.max} step={10} quick={[0, 50, 100, 200]} slider={false} hint={`Half reaches its treasury. Buys about +${aidNow.toFixed(1)} loyalty now, with a falling return.`} />

      <CostEffect
        costs={[
          ...(pv && pv.cost.pp ? [{ label: 'influence', amount: pv.cost.pp, have: player.resources.pp }] : []),
          ...(pv && pv.cost.capital ? [{ label: 'money', amount: pv.cost.capital, have: player.resources.capital }] : []),
        ]}
        why={any ? why : 'Change something to see what it does.'}
        effects={
          pv
            ? [
                `Loyalty now ${Math.round(pv.loyalty)}, ${signed1(pv.shock)} at once.`,
                `It settles near ${Math.round(pv.settlesAfter)} (now ${Math.round(pv.settlesNow)}). Monthly pressure ${signed1(pv.pressureNow)} to ${signed1(pv.pressureAfter)}.`,
                `Tribute a month: ${pv.yieldNow.amount.toFixed(1)} ${unitOf(pv.yieldNow.form)} to ${pv.yieldAfter.amount.toFixed(1)} ${unitOf(pv.yieldAfter.form)}${pv.yieldAfter.form === pv.yieldNow.form ? '' : ' (a different form)'}.`,
                pv.yieldAfter.amount < 0.05 && pv.yieldAfter.form !== 'money' ? `${puppet.name} has almost no ${unitOf(pv.yieldAfter.form)} to give, so this tribute would bring you next to nothing.` : '',
                pv.settlesAfter < PUPPET.rebelBelow ? `At that loyalty it rebels, and may break free.` : pv.settlesAfter < PUPPET.warLoyalty ? 'At that loyalty it will not follow you to war.' : '',
              ].filter(Boolean)
            : []
        }
      />
      <details className="text-[12px] text-white/70">
        <summary className="cursor-pointer select-none">What presses on its loyalty today (settles near {Math.round(base.settles)})</summary>
        <div className="mt-1.5 space-y-1">
          {base.parts.length === 0 && <div>Nothing at all: it drifts toward {PUPPET.neutral}.</div>}
          {base.parts.map((p) => (
            <Line key={p.label} k={p.label} v={`${signed1(p.value)} a month`} warn={p.value < 0} />
          ))}
          <Line k="Total pressure" v={`${signed1(base.total)} a month`} strong />
          <div>
            Your tribute from all puppets is {ex.total.toFixed(1)} of a cap of {ex.cap.toFixed(0)}; above it is paid at half.
          </div>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <OrderButton order={order} label={pending ? 'Replace the queued rules' : 'Set these rules'} cost={pv ? `${pv.cost.pp} influence${pv.cost.capital ? `, ${pv.cost.capital} money` : ''}` : undefined} className={any ? '' : 'opacity-60'} onDone={reset} />
        <button className="btn btn-quiet" onClick={reset} disabled={!any}>
          Undo changes
        </button>
      </div>
    </div>
  )
}

/** Posts or takes back the master's border troops facing the puppet. Works only along a land border, through the same posture the Deployment tab sets. */
function Garrison({ puppet }: { puppet: Nation }) {
  const view = usePlayerView()!
  const { game, player, orders } = view
  const { map } = getWorld()
  const d = player.military.deployment
  const front = landBorders(game, map, player.id).get(puppet.id)
  const now = Math.round((d?.border[puppet.id] ?? 0) * 100)
  const [v, setV] = useState(now)
  if (!front) return <p className="text-[12px] text-white/60">No garrison can be posted: {puppet.name} does not share a land border with you.</p>
  const others = Object.entries(d?.border ?? {}).reduce((t, [k, x]) => (k === puppet.id ? t : t + x), 0)
  const room = Math.max(0, Math.floor((1 - others) * 100))
  const border: Record<NationId, number> = { ...(d?.border ?? {}) }
  if (v > 0) border[puppet.id] = v / 100
  else delete border[puppet.id]
  const order: Order = { type: 'setDeployment', nationId: player.id, coastal: d?.coastal ?? 0, subs: d?.subs ?? 0, air: d?.air ?? 0, border }
  const divisions = garrisonDivisions(game, player.id, puppet.id)
  const err = validateOrder(game, map, order, orders)
  return (
    <Card title="Garrison" hint={`Troops of yours on its border: +${PUPPET.garrison.pressure} loyalty a month at full cover, and half the chance it breaks free. They cannot attack while they stand there. Now ${divisions.toFixed(1)} divisions.`}>
      <NumberStepper label={`Share of your ground forces on ${puppet.name}'s border`} unit="%" value={v} min={0} max={Math.min(100, Math.max(room, now))} step={5} onChange={setV} slider />
      <OrderButton order={order} label={v === now ? 'Already posted' : 'Post the garrison'} effect={err ? undefined : 'Replaces your posture; the rest stays as it was.'} className={v === now ? 'opacity-60' : ''} />
    </Card>
  )
}
