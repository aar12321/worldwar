import { useEffect, useState } from 'react'
import { GENERAL_TRAITS } from '../data/startingNations'
import { ARMS, DRAFT_LIMITS, LAW_SPECS, TAX_LIMITS, UNIT_SPECS, trainingRank } from '../data/unitTypes'
import { weaponTiers } from '../engine/arms'
import { armiesOf, formatDivisions, regionsOf, totalUnits, turnDate } from '../engine/helpers'
import { UNIT_TYPES } from '../engine/types'
import type { Army, LawId, LogKind, UnitType } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { signed, usePlayerView } from './hooks'
import { OrderButton, PanelShell } from './panel'

export function NationPanel() {
  const view = usePlayerView()
  const setPolicy = useGame((s) => s.setPolicy)
  const removeOrder = useGame((s) => s.removeOrder)
  const [tax, setTax] = useState(view?.pendingPolicy.taxRate ?? 0.25)
  const [draft, setDraft] = useState(view?.pendingPolicy.draftRate ?? 0.05)
  const [tab, setTab] = useState<'economy' | 'laws' | 'arms' | 'armies'>('economy')
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
    <PanelShell title="Your nation" kicker={`${player.name} · ${regionsOf(game, player.id).length} countries`} panel="nation">
      <div className="segmented">
        {([
          ['economy', 'Economy'],
          ['laws', 'Laws'],
          ['arms', 'Weapons'],
          ['armies', 'Armies'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'economy' && (
      <section className="space-y-3">
        <p className="text-[13px] text-white/55">Taxes and the draft take effect when the month ends.</p>
        <div>
          <div className="flex justify-between text-[14px]">
            <span>Tax rate</span>
            <span className="font-semibold tabular-nums">{Math.round(tax * 100)}%</span>
          </div>
          <input type="range" className="w-full" min={TAX_LIMITS.min} max={TAX_LIMITS.max} step={0.01} value={tax} onChange={(e) => setTax(+e.target.value)} onMouseUp={() => setPolicy(tax, draft)} onKeyUp={() => setPolicy(tax, draft)} onTouchEnd={() => setPolicy(tax, draft)} />
          <div className="text-[12px] text-white/45">Higher taxes bring in more money, and unsettle the country once they pass 20%.</div>
        </div>
        <div>
          <div className="flex justify-between text-[14px]">
            <span>Draft</span>
            <span className="font-semibold tabular-nums">{Math.round(draft * 100)}%</span>
          </div>
          <input type="range" className="w-full" min={DRAFT_LIMITS.min} max={maxDraft} step={0.01} value={draft} onChange={(e) => setDraft(+e.target.value)} onMouseUp={() => setPolicy(tax, draft)} onKeyUp={() => setPolicy(tax, draft)} onTouchEnd={() => setPolicy(tax, draft)} />
          <div className="text-[12px] text-white/45">Moves civilians into the army. Fewer workers means less money, food, and factory output.</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[13px] inset-card p-3">
          <span className="text-white/50">Money / month</span>
          <span className="text-right">{signed(econ.netCapital)}</span>
          <span className="text-white/50">Food / month</span>
          <span className={`text-right ${econ.netFood < 0 ? 'text-[#ff6961]' : ''}`}>{signed(econ.netFood)}</span>
          <span className="text-white/50">Soldiers / month</span>
          <span className="text-right">{signed(econ.militaryRegen, 0)}k</span>
          <span className="text-white/50">Stability heading to</span>
          <span className="text-right">{Math.round(econ.stabilityTarget)}%</span>
          <span className="text-white/50">People at work</span>
          <span className="text-right">{Math.round(econ.laborRatio * 100)}%</span>
        </div>
      </section>
      )}

      {tab === 'laws' && (
      <section className="space-y-2">
        <p className="text-[13px] text-white/55">Laws change how the country runs. Passing one costs influence.</p>
        {(Object.keys(LAW_SPECS) as LawId[]).map((law) => {
          const active = player.laws.includes(law)
          const queued = orders.findIndex((o) => (o.type === 'enactLaw' || o.type === 'repealLaw') && o.law === law)
          return (
            <div key={law} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold tracking-tight">{LAW_SPECS[law].name}</span>
                {queued >= 0 ? (
                  <button className="btn btn-quiet" onClick={() => removeOrder(queued)}>
                    Cancel
                  </button>
                ) : active ? (
                  <OrderButton order={{ type: 'repealLaw', nationId: player.id, law }} label="Repeal" tone="btn-quiet" />
                ) : (
                  <OrderButton order={{ type: 'enactLaw', nationId: player.id, law }} label={`Pass · ${LAW_SPECS[law].cost} influence`} tone="btn-quiet" />
                )}
              </div>
              <p className="text-[12px] text-white/50 mt-1">{active ? 'In force. ' : ''}{LAW_SPECS[law].description}</p>
            </div>
          )
        })}
      </section>
      )}

      {tab === 'arms' && (
      <section className="space-y-2">
        <p className="text-[13px] text-white/55">Each level adds 10% attack for eight months. One contract per unit type. Diplomacy can buy the same bonus from another nation.</p>
        {UNIT_TYPES.map((u) => (
          <ContractRow key={u} unit={u} />
        ))}
      </section>
      )}

      {tab === 'armies' && (
      <>
      <section className="space-y-2">
        <div className="text-[13px] font-semibold">Commanders</div>
        {player.generals.map((g) => {
          const assigned = armies.find((a) => a.generalId === g.id)
          return (
            <div key={g.id} className="flex justify-between gap-3 text-[13px] inset-card px-3 py-2">
              <div>
                <div className="font-semibold">{g.name}</div>
                <div className="text-[12px] text-white/50">
                  {GENERAL_TRAITS[g.trait].name}: {GENERAL_TRAITS[g.trait].description}
                </div>
              </div>
              <span className="text-[12px] text-white/45 whitespace-nowrap">{assigned ? getWorld().map.territories[assigned.homeTerritoryId]?.name ?? 'Assigned' : 'Free'}</span>
            </div>
          )
        })}
      </section>

      <section className="space-y-2 pt-2">
        <div className="text-[13px] font-semibold">Armies ({armies.length})</div>
        <p className="text-[12px] text-white/45">Select an army, then open its country on the globe to move or attack.</p>
        {armies.map((a) => (
          <ArmyRosterRow key={a.id} army={a} />
        ))}
      </section>
      </>
      )}
    </PanelShell>
  )
}

function ContractRow({ unit }: { unit: UnitType }) {
  const view = usePlayerView()!
  const { game, player } = view
  const active = (player.contracts ?? []).find((c) => c.unit === unit && c.until >= game.turn)
  const liveTier = weaponTiers(player, game.turn)[unit] ?? 0
  const initialTier = (liveTier === 2 || liveTier === 3 ? liveTier : 1) as 1 | 2 | 3
  const [tier, setTier] = useState<1 | 2 | 3>(initialTier)
  const bonus = Math.round(tier * ARMS.attackPerTier * 100)
  const supplier = active?.supplier ? game.nations[active.supplier]?.name ?? 'Foreign' : 'Domestic'
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold tracking-tight">{UNIT_SPECS[unit].name}</span>
        <span className={`text-[12px] font-medium ${active ? 'text-[#ffd60a]' : 'text-white/40'}`}>{active ? `Level ${liveTier} · ${supplier}` : 'No contract'}</span>
      </div>
      {active && (
        <p className="text-[11px] text-slate-400">
          +{Math.round(active.tier * ARMS.attackPerTier * 100)}% attack through {turnDate(active.until)}
          {active.payPerMonth > 0 ? ` · ${active.payPerMonth} money/month` : ''}.
        </p>
      )}
      <div className="flex items-center gap-2">
        <div className="segmented shrink-0">
          {([1, 2, 3] as const).map((level) => (
            <button key={level} type="button" aria-pressed={tier === level} className="!flex-none px-2.5" onClick={() => setTier(level)}>
              {level}
            </button>
          ))}
        </div>
        <OrderButton className="flex-1" showError order={{ type: 'signContract', nationId: player.id, unit, tier }} label={`${active ? 'Replace' : 'Sign'} · ${ARMS.domesticCost[tier - 1]} money`} sub={`+${bonus}% attack for ${ARMS.months} months`} />
      </div>
    </div>
  )
}

function ArmyRosterRow({ army }: { army: Army }) {
  const selected = useGame((s) => s.selectedArmy === army.id)
  const selectArmy = useGame((s) => s.selectArmy)
  const { map } = getWorld()
  const home = map.territories[army.homeTerritoryId]
  return (
    <button
      type="button"
      onClick={() => selectArmy(selected ? null : army.id)}
      className={`w-full text-left inset-card px-3 py-2 transition-colors ${selected ? 'ring-1 ring-white/40' : 'hover:bg-white/10'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold tracking-tight">{home?.name ?? 'Army'}</span>
        <span className="text-xs text-slate-400">{formatDivisions(totalUnits(army.units))} div</span>
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">
        {map.regions[army.location]?.name ?? 'In the field'} · {trainingRank(army.training ?? 0)}
        {home ? ` · ${home.name}` : ''}
      </div>
    </button>
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
    <PanelShell title="News" kicker="What happened this year" panel="log">
      <div className="segmented">
        <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
          Your nation
        </button>
        <button type="button" aria-pressed={scope === 'world'} onClick={() => setScope('world')}>
          The world
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
    <PanelShell title="Settings" kicker="The game saves itself at the end of every month." panel="settings">
      <label className="flex items-center justify-between text-[14px]">
        <span>Show tips</span>
        <input type="checkbox" checked={settings.showTips} onChange={(e) => update({ showTips: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-[14px]">
        <span>Battle cinematics</span>
        <input type="checkbox" checked={settings.battleFx} onChange={(e) => update({ battleFx: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-[14px]">
        <span>Reduce motion</span>
        <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => update({ reducedMotion: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-[14px]">
        <span>Battle speed</span>
        <select className="field px-2 py-1" value={settings.fxSpeed} onChange={(e) => update({ fxSpeed: +e.target.value as 1 | 2 })}>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
        </select>
      </label>
      <label className="flex items-center justify-between text-[14px]">
        <span>Turn clock</span>
        <select className="field px-2 py-1" value={settings.turnTimer} onChange={(e) => update({ turnTimer: +e.target.value })}>
          <option value={0}>Off</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
          <option value={120}>120s</option>
        </select>
      </label>
      <button className="btn btn-red" onClick={quit}>
        Leave game
      </button>
      <div className="text-[13px] text-white/55 pt-2 space-y-2">
        <div className="text-[13px] font-semibold text-white">How to play</div>
        <p>Click a country. If it is yours, raise an army in a district or open Build. If it is not, talk or declare war.</p>
        <p>Select an army, press Move or Attack, then click a highlighted country.</p>
        <p>Press End month. Every nation acts at the same time.</p>
        <p>Win by controlling the share of the world’s people you chose at the start.</p>
        <div className="label pt-2">Shortcuts</div>
        <p>Enter ends the month. Esc cancels or closes. N nation, T research, D diplomacy, L news.</p>
      </div>
    </PanelShell>
  )
}
