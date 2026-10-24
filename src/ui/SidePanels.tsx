import { useEffect, useState } from 'react'
import { DRAFT_LIMITS, LAW_SPECS, TAX_LIMITS } from '../data/unitTypes'
import { armiesOf, regionsOf, turnDate } from '../engine/helpers'
import type { LawId, LogKind } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { ArmyManager } from './ArmyOrders'
import { signed, usePlayerView } from './hooks'
import { OrderButton, PanelShell } from './panel'

export function NationPanel() {
  const view = usePlayerView()
  const setPolicy = useGame((s) => s.setPolicy)
  const removeOrder = useGame((s) => s.removeOrder)
  const [tax, setTax] = useState(view?.pendingPolicy.taxRate ?? 0.25)
  const [draft, setDraft] = useState(view?.pendingPolicy.draftRate ?? 0.05)
  const tab = useGame((s) => (s.nationTab === 'arms' ? 'economy' : s.nationTab))
  const setNationTab = useGame((s) => s.setNationTab)
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
    <PanelShell title="Nation" kicker={`${player.name} · ${regionsOf(game, player.id).length} countries`} panel="nation">
      <div className="segmented">
        {([
          ['economy', 'Economy'],
          ['laws', 'Laws'],
          ['armies', 'Armies'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setNationTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'economy' && (
      <section className="space-y-3">
        <p className="text-[13px] text-white/55">Taxes and the draft take effect when you end the month.</p>
        <div>
          <div className="flex justify-between text-[14px]">
            <span>Tax rate</span>
            <span className="font-semibold tabular-nums">{Math.round(tax * 100)}%</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={TAX_LIMITS.min}
            max={TAX_LIMITS.max}
            step={0.01}
            value={tax}
            onChange={(e) => {
              const next = +e.target.value
              setTax(next)
              setPolicy(next, draft)
            }}
          />
          <div className="text-[12px] text-white/45">Higher taxes bring in more money, and unsettle the country once they pass 20%.</div>
        </div>
        <div>
          <div className="flex justify-between text-[14px]">
            <span>Draft</span>
            <span className="font-semibold tabular-nums">{Math.round(draft * 100)}%</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={DRAFT_LIMITS.min}
            max={maxDraft}
            step={0.01}
            value={draft}
            onChange={(e) => {
              const next = +e.target.value
              setDraft(next)
              setPolicy(tax, next)
            }}
          />
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

      {tab === 'armies' && (
      <section className="space-y-3">
        <div className="space-y-1 text-[13px] text-white/70">
          <p>Every army fights as one force. Infantry, armor, planes, and ships inside it train separately, and only in their city.</p>
          <p>Add a general and every unit trains for free each month. With no general, you pay for each unit. You have {player.generals.length} general{player.generals.length === 1 ? '' : 's'}, and each one can be added to a single army.</p>
        </div>
        {armies.length === 0 && <p className="text-[13px] text-white/45">No armies yet. Open one of your countries and raise one.</p>}
        {[...armies]
          .sort((a, b) => (getWorld().map.territories[a.homeTerritoryId]?.name ?? a.id).localeCompare(getWorld().map.territories[b.homeTerritoryId]?.name ?? b.id))
          .map((a) => (
            <ArmyManager key={a.id} army={a} />
          ))}
      </section>
      )}
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
    <PanelShell title="Settings" kicker="The game saves itself." panel="settings">
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
      <button className="btn" onClick={() => update({ showTips: true, tutorialStep: 0 })}>
        Replay introduction
      </button>
      <button className="btn btn-red" onClick={quit}>
        Leave game
      </button>
      <div className="text-[13px] text-white/55 pt-2 space-y-2">
        <div className="text-[13px] font-semibold text-white">How to play</div>
        <p>Click your country to open Land. Country buildings and district upgrades are on that same sheet. Click another country to talk or declare war.</p>
        <p>Open Nation, then Armies, to see every army. They fight as one force. Add a general and each unit trains for free every month. Without a general, you pay to train each unit in its city. Factories quietly improve every unit’s attack.</p>
        <p>Select an army, press Attack, then click a highlighted border territory. The march arrives when you end the month. Winning takes that territory.</p>
        <p>Nothing moves until you press End month. Buildings, training, income, and rival decisions all settle then.</p>
        <p>Win by taking the territories asked for at the start (3, 6, or 12), or by leading that share of the world’s people. You lose if your nation is wiped out.</p>
        <div className="label pt-2">Shortcuts</div>
        <p>Space ends the month. Esc cancels or closes. R territories, M military, N nation, T research, D diplomacy, L news.</p>
      </div>
    </PanelShell>
  )
}
