import { motion } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'
import { GENERAL_TRAITS } from '../data/startingNations'
import { COSTS, DRAFT_LIMITS, LAW_SPECS, TAX_LIMITS } from '../data/unitTypes'
import { militaryPower } from '../engine/economy'
import { armiesOf, atWar, enemiesOf, hasCasusBelli, hasPact, regionsOf, turnDate } from '../engine/helpers'
import { validateOrder } from '../engine/orders'
import type { LawId, LogKind, NationId, Order } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame, type Panel } from '../store'
import { ArmyCard } from './ArmyOrders'
import { signed, usePlayerView } from './hooks'

function PanelShell({ title, kicker, panel, children }: { title: string; kicker: string; panel: Panel; children: ReactNode }) {
  const setPanel = useGame((s) => s.setPanel)
  return (
    <motion.aside
      initial={{ x: -380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -380, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="glass absolute left-20 top-28 bottom-24 z-20 w-[380px] rounded-xl flex flex-col overflow-hidden"
    >
      <div className="p-4 border-b border-cyan-400/15 flex items-start justify-between">
        <div>
          <div className="label">{kicker}</div>
          <h2 className="font-display text-lg font-bold tracking-[0.18em] neon-text">{title}</h2>
        </div>
        <button className="text-slate-400 hover:text-white text-sm" onClick={() => setPanel(panel)}>
          close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-5">{children}</div>
    </motion.aside>
  )
}

function OrderButton({ order, label, sub, tone = '' }: { order: Order; label: string; sub?: string; tone?: string }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const err = validateOrder(view.game, getWorld().map, order, view.orders)
  return (
    <button className={`btn ${tone}`} disabled={!!err} title={err ?? sub ?? ''} onClick={() => issueOrder(order)}>
      {label}
    </button>
  )
}

export function NationPanel() {
  const view = usePlayerView()
  const setPolicy = useGame((s) => s.setPolicy)
  const removeOrder = useGame((s) => s.removeOrder)
  const [tax, setTax] = useState(view?.pendingPolicy.taxRate ?? 0.25)
  const [draft, setDraft] = useState(view?.pendingPolicy.draftRate ?? 0.05)
  const pTax = view?.pendingPolicy.taxRate
  const pDraft = view?.pendingPolicy.draftRate
  useEffect(() => {
    if (pTax !== undefined && pDraft !== undefined) {
      setTax(pTax)
      setDraft(pDraft)
    }
  }, [pTax, pDraft])
  if (!view) return null
  const { game, player, econ, orders } = view
  const maxDraft = player.laws.includes('conscription_act') ? DRAFT_LIMITS.maxWithConscription : DRAFT_LIMITS.max
  const armies = armiesOf(game, player.id)

  return (
    <PanelShell title="NATIONAL COMMAND" kicker={`${player.name} · ${regionsOf(game, player.id).length} regions`} panel="nation">
      <section className="space-y-3">
        <div className="label">Policy</div>
        <div>
          <div className="flex justify-between text-sm">
            <span>Tax rate</span>
            <span className="font-display text-amber-200">{Math.round(tax * 100)}%</span>
          </div>
          <input type="range" className="w-full" min={TAX_LIMITS.min} max={TAX_LIMITS.max} step={0.01} value={tax} onChange={(e) => setTax(+e.target.value)} onMouseUp={() => setPolicy(tax, draft)} onKeyUp={() => setPolicy(tax, draft)} onTouchEnd={() => setPolicy(tax, draft)} />
          <div className="text-xs text-slate-500">Higher taxes raise Capital but erode stability above 20%.</div>
        </div>
        <div>
          <div className="flex justify-between text-sm">
            <span>Draft rate</span>
            <span className="font-display text-cyan-200">{Math.round(draft * 100)}%</span>
          </div>
          <input type="range" className="w-full" min={DRAFT_LIMITS.min} max={maxDraft} step={0.01} value={draft} onChange={(e) => setDraft(+e.target.value)} onMouseUp={() => setPolicy(tax, draft)} onKeyUp={() => setPolicy(tax, draft)} onTouchEnd={() => setPolicy(tax, draft)} />
          <div className="text-xs text-slate-500">Moves civilians into the military pool. Fewer workers means less tax, food, and factory output.</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm rounded-lg bg-slate-900/50 p-3">
          <span className="text-slate-400">Capital / month</span>
          <span className="text-right">{signed(econ.netCapital)}</span>
          <span className="text-slate-400">Food / month</span>
          <span className={`text-right ${econ.netFood < 0 ? 'text-rose-300' : ''}`}>{signed(econ.netFood)}</span>
          <span className="text-slate-400">Manpower / month</span>
          <span className="text-right">{signed(econ.militaryRegen, 0)}k</span>
          <span className="text-slate-400">Stability trend</span>
          <span className="text-right">{Math.round(econ.stabilityTarget)}%</span>
          <span className="text-slate-400">Labor efficiency</span>
          <span className="text-right">{Math.round(econ.laborRatio * 100)}%</span>
        </div>
      </section>

      <section className="space-y-2">
        <div className="label">Laws</div>
        {(Object.keys(LAW_SPECS) as LawId[]).map((law) => {
          const active = player.laws.includes(law)
          const queued = orders.findIndex((o) => (o.type === 'enactLaw' || o.type === 'repealLaw') && o.law === law)
          return (
            <div key={law} className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-xs tracking-wider">{LAW_SPECS[law].name.toUpperCase()}</span>
                {active && <span className="text-[10px] font-display tracking-widest text-emerald-300">IN FORCE</span>}
              </div>
              <p className="text-xs text-slate-400 mt-1">{LAW_SPECS[law].description}</p>
              <div className="mt-2">
                {queued >= 0 ? (
                  <button className="btn" onClick={() => removeOrder(queued)}>
                    Cancel ({orders[queued].type === 'enactLaw' ? 'enacting' : 'repealing'})
                  </button>
                ) : active ? (
                  <OrderButton order={{ type: 'repealLaw', nationId: player.id, law }} label="Repeal" />
                ) : (
                  <OrderButton order={{ type: 'enactLaw', nationId: player.id, law }} label={`Enact (${LAW_SPECS[law].cost} PP)`} tone="btn-magenta" />
                )}
              </div>
            </div>
          )
        })}
      </section>

      <section className="space-y-2">
        <div className="label">General Staff</div>
        {player.generals.map((g) => {
          const assigned = armies.find((a) => a.generalId === g.id)
          return (
            <div key={g.id} className="flex justify-between text-sm rounded bg-slate-900/50 px-3 py-2">
              <div>
                <div className="font-semibold">{g.name}</div>
                <div className="text-xs text-slate-400">
                  {GENERAL_TRAITS[g.trait].name}: {GENERAL_TRAITS[g.trait].description}
                </div>
              </div>
              <span className="text-xs text-slate-400 whitespace-nowrap">{assigned ? `Army ${assigned.id.toUpperCase()}` : 'Unassigned'}</span>
            </div>
          )
        })}
      </section>

      <section className="space-y-2">
        <div className="label">Armies ({armies.length})</div>
        {armies.map((a) => (
          <div key={a.id}>
            <div className="text-xs text-slate-400 mb-1">{getWorld().map.regions[a.location].name}</div>
            <ArmyCard army={a} game={game} />
          </div>
        ))}
      </section>
    </PanelShell>
  )
}

export function DiplomacyPanel() {
  const view = usePlayerView()
  const selectRegion = useGame((s) => s.selectRegion)
  const issueOrder = useGame((s) => s.issueOrder)
  if (!view) return null
  const { game, player, orders } = view
  const { map } = getWorld()
  const neighbors = new Set<NationId>()
  for (const id of regionsOf(game, player.id))
    for (const nb of [...map.regions[id].neighbors, ...map.regions[id].seaLanes]) {
      const o = game.regions[nb]?.owner
      if (o && o !== player.id) neighbors.add(o)
    }
  for (const e of enemiesOf(game, player.id)) neighbors.add(e)
  const offers = game.peaceOffers.filter((o) => o.to === player.id)
  const majors = Object.values(game.nations)
    .filter((n) => n.alive && n.id !== player.id && !neighbors.has(n.id))
    .sort((a, b) => regionsOf(game, b.id).length - regionsOf(game, a.id).length || militaryPower(game, b.id) - militaryPower(game, a.id))
    .slice(0, 6)
  const myPower = militaryPower(game, player.id)

  const row = (id: NationId) => {
    const n = game.nations[id]
    const war = atWar(game, player.id, id)
    const pact = hasPact(game, player.id, id)
    const cb = hasCasusBelli(game, player.id, id)
    const theirCb = hasCasusBelli(game, id, player.id)
    const power = militaryPower(game, id)
    return (
      <div key={id} className={`rounded-lg border p-3 ${war ? 'border-rose-500/50 bg-rose-500/5' : 'border-slate-700/70 bg-slate-900/40'}`}>
        <div className="flex items-center justify-between">
          <button className="flex items-center gap-2 hover:underline" onClick={() => selectRegion(n.capital)}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: n.color }} />
            <span className="font-semibold">{n.name}</span>
          </button>
          <span className={`text-[10px] font-display tracking-widest ${war ? 'text-rose-400' : pact ? 'text-emerald-300' : 'text-slate-400'}`}>{war ? 'AT WAR' : pact ? `PACT to ${turnDate(game.pacts[[player.id, id].sort().join('|')])}` : 'PEACE'}</span>
        </div>
        <div className="text-xs text-slate-400 mt-1">
          {regionsOf(game, id).length} regions · power {power.toFixed(0)} ({power > myPower ? 'stronger' : 'weaker'} than you)
          {cb && <span className="text-amber-300"> · you hold a casus belli</span>}
          {theirCb && <span className="text-rose-300"> · they hold a casus belli on you</span>}
        </div>
        <div className="flex gap-2 mt-2">
          {war ? (
            <OrderButton order={{ type: 'offerPeace', nationId: player.id, target: id }} label={`Offer Peace (${COSTS.offerPeace})`} />
          ) : (
            <>
              <OrderButton order={{ type: 'declareWar', nationId: player.id, target: id }} label={`War (${cb ? COSTS.declareWarWithCasusBelli : COSTS.declareWar} PP)`} tone="btn-red" />
              <OrderButton order={{ type: 'offerPact', nationId: player.id, target: id }} label={`Pact (${COSTS.offerPact})`} />
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <PanelShell title="DIPLOMACY" kicker={`${enemiesOf(game, player.id).length} active wars`} panel="diplomacy">
      {offers.length > 0 && (
        <section className="space-y-2">
          <div className="label text-amber-300">Incoming peace offers</div>
          {offers.map((o) => {
            const queued = orders.some((x) => x.type === 'acceptPeace' && x.target === o.from)
            return (
              <div key={o.from} className="rounded-lg border border-amber-400/50 bg-amber-400/5 p-3 flex items-center justify-between">
                <span>{game.nations[o.from].name} sues for peace.</span>
                <button className="btn" disabled={queued} onClick={() => issueOrder({ type: 'acceptPeace', nationId: player.id, target: o.from })}>
                  {queued ? 'Accepting' : 'Accept'}
                </button>
              </div>
            )
          })}
        </section>
      )}
      <section className="space-y-2">
        <div className="label">Neighbors and belligerents</div>
        {[...neighbors].sort().map(row)}
      </section>
      <section className="space-y-2">
        <div className="label">Great powers</div>
        {majors.map((n) => row(n.id))}
      </section>
    </PanelShell>
  )
}

const KIND_COLOR: Record<LogKind, string> = {
  info: 'text-slate-300',
  war: 'text-rose-300',
  battle: 'text-amber-200',
  tech: 'text-cyan-200',
  economy: 'text-emerald-200',
  event: 'text-fuchsia-200',
  spy: 'text-violet-300',
  diplomacy: 'text-sky-200',
}

export function LogPanel() {
  const view = usePlayerView()
  const [scope, setScope] = useState<'mine' | 'world'>('mine')
  if (!view) return null
  const { game, player } = view
  const entries = game.log.filter((l) => scope === 'world' || l.nations.includes(player.id)).slice(-120).reverse()
  return (
    <PanelShell title="DISPATCHES" kicker="Intelligence feed" panel="log">
      <div className="flex gap-2">
        <button className={`btn ${scope === 'mine' ? 'bg-cyan-400/25' : ''}`} onClick={() => setScope('mine')}>
          My Nation
        </button>
        <button className={`btn ${scope === 'world' ? 'bg-cyan-400/25' : ''}`} onClick={() => setScope('world')}>
          World News
        </button>
      </div>
      <div className="space-y-1.5">
        {entries.length === 0 && <p className="text-sm text-slate-500">No dispatches yet.</p>}
        {entries.map((l, i) => (
          <div key={i} className="text-sm border-l-2 border-slate-700 pl-2">
            <span className="text-[10px] text-slate-500 font-display mr-2">{turnDate(l.turn)}</span>
            <span className={KIND_COLOR[l.kind]}>{l.text}</span>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}

export function SettingsPanel() {
  const settings = useGame((s) => s.settings)
  const update = useGame((s) => s.updateSettings)
  const quit = useGame((s) => s.quitToMenu)
  return (
    <PanelShell title="SETTINGS" kicker="Command console" panel="settings">
      <label className="flex items-center justify-between text-sm">
        <span>Battle cinematics</span>
        <input type="checkbox" checked={settings.battleFx} onChange={(e) => update({ battleFx: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-sm">
        <span>Reduced motion (no shake or slashes)</span>
        <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => update({ reducedMotion: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-sm">
        <span>Battle playback speed</span>
        <select className="bg-slate-900 border border-slate-700 rounded px-2 py-1" value={settings.fxSpeed} onChange={(e) => update({ fxSpeed: +e.target.value as 1 | 2 })}>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
        </select>
      </label>
      <label className="flex items-center justify-between text-sm">
        <span>Turn clock</span>
        <select className="bg-slate-900 border border-slate-700 rounded px-2 py-1" value={settings.turnTimer} onChange={(e) => update({ turnTimer: +e.target.value })}>
          <option value={0}>Off</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
          <option value={120}>120s</option>
        </select>
      </label>
      <p className="text-xs text-slate-500">The game autosaves at the end of every turn.</p>
      <button className="btn btn-red" onClick={quit}>
        Quit to Main Menu
      </button>
      <div className="text-xs text-slate-500 pt-4 space-y-1">
        <div className="label">Shortcuts</div>
        <div>Enter: next turn · Esc: cancel targeting / close panel</div>
        <div>T: tech tree · N: nation · D: diplomacy · L: dispatches</div>
      </div>
    </PanelShell>
  )
}
