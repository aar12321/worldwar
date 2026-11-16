import { useState } from 'react'
import { opinionLabel, opinionOf } from '../ai/opinion'
import { TERRITORY } from '../data/territories'
import { ALERT, ALERT_LEVELS } from '../data/presence'
import { MARKET, TRAIN_QUEUE_LIMIT, UNIT_SPECS } from '../data/unitTypes'
import { landBorders } from '../engine/deployment'
import { factionOf } from '../engine/factions'
import { formatDivisions, regionsOf, territoriesOf, totalUnits } from '../engine/helpers'
import { annexTerritoryCost, cutOf, forceTradeProblem } from '../engine/territories'
import { validateOrder } from '../engine/orders'
import { trainMonths } from '../engine/training'
import type { Nation, NationId, Order, TradeResource, UnitType } from '../engine/types'
import { TRADE_RESOURCES, UNIT_TYPES } from '../engine/types'
import { getWorld } from '../map/world'
import { DataList } from './DataList'
import { Card } from './economy/parts'
import { NationPicker } from './Faction'
import { usePlayerView } from './hooks'
import { UnitIcon } from './icons'
import { Pending, StatTile, Tiles } from './kit'
import { OrderButton } from './panel'
import { nationItems, type PickerChip } from './pickerItems'
import { useGame } from '../store'
import { useTerritoryPrefs } from './territoryPrefs'
import { ConfirmButton, EmptyState, NumberStepper } from './widgets'

const pctTxt = (v: number) => `${Math.round(v * 100)}%`
const money = (v: number) => (Math.round(v * 10) / 10).toLocaleString()

/** An order given as the territory: the master's order wrapping the territory's own. */
const commandOf = (master: NationId, territory: NationId, order: Order): Order => ({ type: 'commandTerritory', nationId: master, territory, order })

/** The Territories desk: every territory you hold, what it pays, its army, and what you may order it to do. */
export default function TerritoriesTab() {
  const view = usePlayerView()
  if (!view) return null
  const { game, player } = view
  const { map } = getWorld()
  const ids = territoriesOf(game, player.id)
  if (ids.length === 0) return <EmptyState title="No territories yet" body={`Win a war with a crushing score and ask for "Make them a territory" in the peace terms. It pays you ${pctTxt(TERRITORY.cut)} of everything it earns for ever, joins your faction and fights in your wars, and you command its army.`} />
  let cut = 0
  let taken = 0
  let army = 0
  for (const id of ids) {
    cut += cutOf(game, map, id).cut
    taken += game.territories?.[id]?.taken ?? 0
    army += totalUnits(game.nations[id].military.units)
  }
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-white/75">
        A territory is held for ever. You take <strong>{pctTxt(TERRITORY.cut)}</strong> of its revenue every month, and nothing it does can lower that. It sits in your faction and cannot leave, fights in every war you fight, and owes no war reparations. Its people are its own, not yours, but you <strong>command its army</strong> and may force it into trade deals. It still pays its own upkeep.
      </p>
      <Tiles>
        <StatTile label="Territories" value={ids.length} sub={`of ${TERRITORY.maxByTier[Math.max(0, Math.min(4, (player.tier ?? 1) - 1))]} your rank allows`} />
        <StatTile label="Your cut a month" value={money(cut)} sub={`${pctTxt(TERRITORY.cut)} of their revenue`} tone="good" />
        <StatTile label="Taken so far" value={money(taken)} sub="money, all territories" />
        <StatTile label="Their armies" value={formatDivisions(army)} sub="divisions you command" />
      </Tiles>
      <DataList
        label="Your territories"
        rows={ids.map((id) => game.nations[id])}
        rowKey={(n) => n.id}
        searchText={(n) => n.name}
        noun={['territory', 'territories']}
        minForToolbar={5}
        sorts={[
          { id: 'cut', label: 'Cut', dir: 'desc', value: (n) => cutOf(game, map, n.id).cut },
          { id: 'name', label: 'Name', dir: 'asc', value: (n) => n.name },
        ]}
        renderRow={(n) => <TerritoryCard key={n.id} territory={n} />}
      />
    </div>
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

function TerritoryCard({ territory }: { territory: Nation }) {
  const view = usePlayerView()!
  const { game, player, orders } = view
  const { map } = getWorld()
  const [open, setOpen] = useState<'' | 'army' | 'trade'>('')
  const rec = game.territories?.[territory.id]
  const { revenue, cut } = cutOf(game, map, territory.id)
  const countries = regionsOf(game, territory.id).length
  const served = game.turn - (rec?.since ?? game.turn)
  const f = factionOf(game, territory.id)
  const force = totalUnits(territory.military.units)
  const send = useTerritoryPrefs((s) => s.send[territory.id] ?? false)
  const setSend = useTerritoryPrefs((s) => s.setSend)
  const queued = orders.filter((o) => o.type === 'commandTerritory' && o.territory === territory.id).length
  const annexable = served >= TERRITORY.annexMonths
  const issueOrder = useGame((s) => s.issueOrder)
  return (
    <article className="inset-card p-3.5 space-y-3" aria-label={`${territory.name}, a territory of yours`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold truncate">{territory.name}</h3>
          <div className="text-[12px] text-white/65">
            {countries} {countries === 1 ? 'country' : 'countries'} · stability {Math.round(territory.stability)} · {served} {served === 1 ? 'month' : 'months'} held
          </div>
        </div>
        <span className="chip chip-green shrink-0" title="Loyal for ever: no meter, no rebels, no breaking free">
          Loyal for ever
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px]">
        <Mini k="Revenue a month" v={money(revenue)} />
        <Mini k={`Your cut (${pctTxt(TERRITORY.cut)})`} v={money(cut)} />
        <Mini k="Faction" v={f ? `${f.name} (cannot leave)` : 'none yet'} />
        <Mini k="Army" v={`${formatDivisions(force)} divisions`} />
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={send} onChange={(e) => setSend(territory.id, e.target.checked)} />
        <span>
          Send with my army
          <span className="text-white/60"> · in the War Room, an attack also sends {territory.name}'s forces</span>
        </span>
      </label>
      <Pending show={queued > 0} text={`${queued} order${queued === 1 ? '' : 's'} for ${territory.name} wait for the month's end`} />
      <div className="flex flex-wrap gap-1.5">
        <button className={`btn px-3 py-1 text-[13px] ${open === 'army' ? 'btn-primary' : 'btn-quiet'}`} aria-expanded={open === 'army'} onClick={() => setOpen((v) => (v === 'army' ? '' : 'army'))}>
          Command its army
        </button>
        <button className={`btn px-3 py-1 text-[13px] ${open === 'trade' ? 'btn-primary' : 'btn-quiet'}`} aria-expanded={open === 'trade'} onClick={() => setOpen((v) => (v === 'trade' ? '' : 'trade'))}>
          Force a trade deal
        </button>
        <OrderButton
          order={{ type: 'annexTerritory', nationId: player.id, target: territory.id }}
          label="Annex"
          cost={`${annexTerritoryCost(game, territory.id)} influence`}
          effect={annexable ? 'Its land, army and treasury become yours, half settled. You lose the faction seat and the cut, and gain its people.' : `Must be held ${TERRITORY.annexMonths} months first`}
        />
        <ConfirmButton
          label="Release"
          title={`Release ${territory.name}?`}
          text={`${territory.name} becomes independent and leaves your faction. You stop taking your ${pctTxt(TERRITORY.cut)}, and it is yours no more. It will remember it kindly.`}
          confirmLabel="Release it"
          danger
          className="btn-quiet px-3 py-1 text-[13px]"
          onConfirm={() => issueOrder({ type: 'releaseTerritory', nationId: player.id, target: territory.id })}
        />
      </div>
      {open === 'army' && <Army territory={territory} />}
      {open === 'trade' && <ForceTrade territory={territory} />}
    </article>
  )
}


/** Train, drill, post and set the alert of the territory's army: the master's commands, paid from the territory's treasury. */
function Army({ territory }: { territory: Nation }) {
  const view = usePlayerView()!
  const { game, player, orders } = view
  const { map } = getWorld()
  const me = player.id
  const t = territory.id
  const owned = UNIT_TYPES.filter((k) => territory.military.units[k] >= 0.05)
  const [unit, setUnit] = useState<UnitType>('infantry')
  const d = territory.military.deployment
  const front = [...landBorders(game, map, t).keys()].sort()
  const [coastal, setCoastal] = useState(Math.round((d?.coastal ?? 0) * 100))
  const [air, setAir] = useState(Math.round((d?.air ?? 0) * 100))
  const [border, setBorder] = useState<Record<NationId, number>>(() => Object.fromEntries(Object.entries(d?.border ?? {}).map(([k, v]) => [k, Math.round(v * 100)])))
  const posture: Order = { type: 'setDeployment', nationId: t, coastal: coastal / 100, subs: d?.subs ?? 0, air: air / 100, border: Object.fromEntries(Object.entries(border).filter(([, v]) => v > 0).map(([k, v]) => [k, v / 100])) }
  const cmd = (o: Order) => commandOf(me, t, o)
  const trainErr = validateOrder(game, map, cmd({ type: 'queueTrain', nationId: t, unit }), orders)
  const queue = (game.trainingQueue ?? []).filter((j) => j.nationId === t)
  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex flex-wrap gap-1.5 text-[13px]" aria-label="Its army">
        {owned.length === 0 && <span className="text-white/65">No army to speak of.</span>}
        {owned.map((k) => (
          <span key={k} className="chip inline-flex items-center gap-1" title={UNIT_SPECS[k].role}>
            <UnitIcon unit={k} size={14} />
            {formatDivisions(territory.military.units[k])} {UNIT_SPECS[k].name.toLowerCase()}
          </span>
        ))}
        {queue.length > 0 && <span className="chip">{queue.length} in training</span>}
      </div>
      <Card title="Train" hint={`Paid from ${territory.name}'s own treasury (${money(territory.resources.capital)}). It takes about ${trainMonths(unit)} month${trainMonths(unit) === 1 ? '' : 's'}; up to ${TRAIN_QUEUE_LIMIT} wait in the queue beyond its training slots.`}>
        <div className="flex flex-wrap items-center gap-2">
          <select className="field px-2 py-1.5" aria-label="Unit to train" value={unit} onChange={(e) => setUnit(e.target.value as UnitType)}>
            {UNIT_TYPES.filter((k) => k !== 'missile').map((k) => (
              <option key={k} value={k}>
                {UNIT_SPECS[k].name} ({UNIT_SPECS[k].capitalCost} money)
              </option>
            ))}
          </select>
          <OrderButton order={cmd({ type: 'queueTrain', nationId: t, unit })} label="Train a division" cost={`${UNIT_SPECS[unit].capitalCost} money`} effect={trainErr ? undefined : 'Joins its army when done'} />
          <OrderButton order={cmd({ type: 'train', nationId: t, unit })} label="Drill" effect="One more rank of drill for that kind" tone="btn-quiet" />
          <OrderButton order={cmd({ type: 'upgradeWeapons', nationId: t, unit })} label="Weapons" effect="A better weapon level for that kind" tone="btn-quiet" />
        </div>
      </Card>
      <Card title="Station" hint="Post its forces at the coast, in the air and along its land borders. Posted forces cannot be sent to attack until you free them.">
        <div className="grid gap-2 sm:grid-cols-2">
          <NumberStepper label="Coastal patrol" unit="%" value={coastal} min={0} max={100} step={5} onChange={setCoastal} slider={false} quick={[0, 50]} />
          <NumberStepper label="Air cover" unit="%" value={air} min={0} max={100} step={5} onChange={setAir} slider={false} quick={[0, 50]} />
          {front.map((x) => (
            <NumberStepper key={x} label={`On the border with ${game.nations[x].name}`} unit="%" value={border[x] ?? 0} min={0} max={100} step={5} onChange={(v) => setBorder((b) => ({ ...b, [x]: v }))} slider={false} quick={[0, 25]} />
          ))}
        </div>
        <OrderButton order={cmd(posture)} label="Set its posture" effect="Takes effect now" className="mt-2" />
      </Card>
      <Card title="Alert" hint="Higher alert answers an attack sooner and costs the territory more upkeep and oil.">
        <div className="flex flex-wrap gap-1.5">
          {ALERT_LEVELS.map((a) => (
            <OrderButton key={a} order={cmd({ type: 'setAlert', nationId: t, alert: a })} label={ALERT[a].name} effect={ALERT[a].hint} tone="btn-quiet" />
          ))}
        </div>
      </Card>
    </div>
  )
}

const RES: TradeResource[] = TRADE_RESOURCES.filter((r) => r !== 'tp')

/** A deal the territory cannot refuse: pick who with, what it gives and gets, and for how long. The other nation still has to agree unless it is you. */
function ForceTrade({ territory }: { territory: Nation }) {
  const view = usePlayerView()!
  const { game, player, orders } = view
  const { map } = getWorld()
  const [partner, setPartner] = useState<NationId | null>(null)
  const [giveR, setGiveR] = useState<TradeResource>('food')
  const [getR, setGetR] = useState<TradeResource>('capital')
  const [giveN, setGiveN] = useState(10)
  const [getN, setGetN] = useState(20)
  const [months, setMonths] = useState(6)
  const t = territory.id
  const partners = new Set<NationId>()
  for (const dl of game.deals) if (dl.kind === 'trade' && (dl.from === t || dl.to === t)) partners.add(dl.from === t ? dl.to : dl.from)
  const ids = Object.keys(game.nations).filter((id) => id !== t && game.nations[id].alive)
  const items = nationItems(game, [player.id, ...ids.filter((id) => id !== player.id)], (id) => {
    const chips: PickerChip[] = []
    if (id === player.id) chips.push({ text: 'Your master, no answer needed', tone: 'good' })
    if (partners.has(id)) chips.push({ text: 'Trades with it now', tone: 'good' })
    if (game.nations[id].isPlayer || game.humans.includes(id)) chips.push({ text: 'Player', tone: 'none' })
    return { chips, group: id === player.id ? 'You' : partners.has(id) ? 'Its partners' : 'Everyone else', note: id === player.id ? '' : opinionLabel(opinionOf(game, map, id, t, { coalition: false })) }
  }, { keepOrder: true })
  const order: Order | null = partner ? { type: 'forceTrade', nationId: player.id, territory: t, partner, terms: { give: { [giveR]: giveN }, receive: { [getR]: getN }, months } } : null
  const why = order ? forceTradeProblem(game, order, orders) : 'Choose who it trades with'
  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <p className="text-[13px] text-white/75">
        {territory.name} cannot refuse or cancel it. The other nation still has to agree (unless it is you). It must give {territory.name} at least {pctTxt(TERRITORY.forceFair)} of what it gives, at market prices, and a territory holds at most {TERRITORY.maxDeals} deals.
      </p>
      <NationPicker label="Who it trades with" items={items} value={partner} onChange={setPartner} placeholder="Search for a nation" max={200} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="label">{territory.name} gives</div>
          <select className="field px-2 py-1.5" aria-label="Resource it gives" value={giveR} onChange={(e) => setGiveR(e.target.value as TradeResource)}>
            {RES.map((r) => (
              <option key={r} value={r}>
                {MARKET[r].name}
              </option>
            ))}
          </select>
          <NumberStepper label="Amount it gives" value={giveN} min={1} max={200} step={1} onChange={setGiveN} slider={false} quick={[10, 25, 50]} />
        </div>
        <div className="space-y-1">
          <div className="label">{territory.name} gets</div>
          <select className="field px-2 py-1.5" aria-label="Resource it gets" value={getR} onChange={(e) => setGetR(e.target.value as TradeResource)}>
            {RES.map((r) => (
              <option key={r} value={r}>
                {MARKET[r].name}
              </option>
            ))}
          </select>
          <NumberStepper label="Amount it gets" value={getN} min={0} max={200} step={1} onChange={setGetN} slider={false} quick={[10, 25, 50]} />
        </div>
      </div>
      <NumberStepper label="Months (0 is a single exchange)" value={months} min={0} max={24} step={1} onChange={setMonths} slider={false} quick={[0, 6, 12]} />
      {order ? (
        <OrderButton order={order} label="Force the deal" effect={why ? undefined : 'Settled when the month ends'} tone="btn-primary" />
      ) : (
        <p className="text-[12px] text-white/60">{why}</p>
      )}
    </div>
  )
}

