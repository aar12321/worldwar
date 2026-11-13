import { useState } from 'react'
import { BUILDING_SPECS, DRAFT_LIMITS, LAW_SPECS, TAX_LIMITS, buildingCost } from '../data/unitTypes'
import { buildingCap, integrationFactor, regionWorkforce } from '../engine/economy'
import { enemiesOf, regionsOf, turnDate } from '../engine/helpers'
import { BUILDING_TYPES } from '../engine/types'
import type { LawId, LogKind } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { Pips } from './bits'
import { signed, usePlayerView } from './hooks'
import { OrderButton, PanelShell, Tabs } from './panel'

const ECONOMY_TABS = [
  ['build', 'Upgrades'],
  ['budget', 'Budget'],
  ['people', 'People'],
  ['laws', 'Laws'],
] as const

function Line({ k, v, warn, strong }: { k: string; v: string; warn?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold border-t border-white/10 pt-1.5 mt-1' : ''}`}>
      <span className={strong ? '' : 'text-white/70'}>{k}</span>
      <span className={`tabular-nums ${warn ? 'text-[#ff8a84]' : ''}`}>{v}</span>
    </div>
  )
}

/** The Economy desk: upgrade the country, set the budget, look after the people, pass laws. */
export function EconomyDesk() {
  const view = usePlayerView()
  const setPolicy = useGame((s) => s.setPolicy)
  const tab = useGame((s) => s.economyTab)
  const setTab = useGame((s) => s.setEconomyTab)
  const picked = useGame((s) => s.economyRegion)
  const setPicked = useGame((s) => s.setEconomyRegion)
  if (!view) return null
  const { game, player, econ } = view
  const { map } = getWorld()
  // The sliders show the policy that is queued, so they need no state of their own.
  const tax = view.pendingPolicy.taxRate
  const draft = view.pendingPolicy.draftRate
  const maxDraft = player.laws.includes('conscription_act') ? DRAFT_LIMITS.maxWithConscription : DRAFT_LIMITS.max
  const owned = regionsOf(game, player.id)
  const regionId = picked && owned.includes(picked) ? picked : owned.includes(player.capital) ? player.capital : owned[0]
  const region = game.regions[regionId]

  return (
    <PanelShell
      title="Economy"
      kicker={`${player.name} · ${signed(econ.netCapital)} money and ${signed(econ.netFood)} food a month`}
      panel="economy"
      tabs={<Tabs value={tab} onChange={setTab} options={ECONOMY_TABS} />}
    >
      {tab === 'build' && region && (
        <section className="space-y-3">
          <p className="text-[14px] text-white/70">Upgrades work the moment you buy them. Bigger countries can reach higher levels.</p>
          {owned.length > 1 && (
            <label className="block text-[14px]">
              <span className="label block mb-1">Country</span>
              <select className="field w-full px-3 py-2" value={regionId} onChange={(e) => setPicked(e.target.value)}>
                {owned.map((id) => (
                  <option key={id} value={id}>
                    {map.regions[id].name}
                    {game.regions[id].integration < 1 ? ` (settling, ${Math.round(integrationFactor(game.regions[id]) * 100)}% output)` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {BUILDING_TYPES.map((b) => {
            const spec = BUILDING_SPECS[b]
            const level = region.buildings[b]
            const cap = buildingCap(regionWorkforce(region, map.regions[regionId]), b)
            if (spec.requiresCoast && !map.regions[regionId].coastal) return null
            return (
              <div key={b} className="inset-card p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[16px] font-semibold tracking-tight">{spec.name}</div>
                    <div className="text-[13px] text-white/70 mt-0.5">{spec.description}</div>
                  </div>
                  <span className="text-[14px] font-semibold tabular-nums shrink-0">
                    Level {level}
                    <span className="text-white/60"> of {cap}</span>
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <Pips value={Math.min(level, 10)} max={Math.min(cap, 10)} />
                  {level >= cap ? (
                    <span className="chip chip-green">Highest level</span>
                  ) : (
                    <OrderButton order={{ type: 'build', nationId: player.id, regionId, building: b }} label="Upgrade" cost={`${buildingCost(b, level)} money`} effect={spec.effect} tone="btn-primary" />
                  )}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {tab === 'budget' && (
        <section className="space-y-4">
          <div className="inset-card p-3.5 text-[14px] space-y-1">
            <div className="text-[15px] font-semibold mb-1">Money each month</div>
            <Line k="Taxes" v={signed(econ.taxIncome)} />
            <Line k="Factories" v={signed(econ.factoryIncome)} />
            <Line k="Trade through ports" v={signed(econ.tradeIncome)} />
            <Line k="Upkeep of units and buildings" v={signed(-econ.upkeep)} warn />
            {econ.warBills.map((b) => (
              <Line key={b.enemy} k={`War with ${game.nations[b.enemy]?.name ?? b.enemy}`} v={signed(-b.amount)} warn />
            ))}
            <Line k="Left over" v={signed(econ.netCapital)} warn={econ.netCapital < 0} strong />
          </div>
          <p className="text-[14px] text-white/70">Taxes and the draft change when you press Next turn.</p>
          <div>
            <div className="flex justify-between text-[15px]">
              <span>Tax rate</span>
              <span className="font-semibold tabular-nums">{Math.round(tax * 100)}%</span>
            </div>
            <input
              type="range"
              className="w-full"
              aria-label="Tax rate"
              min={TAX_LIMITS.min}
              max={TAX_LIMITS.max}
              step={0.01}
              value={tax}
              onChange={(e) => {
                setPolicy(+e.target.value, draft)
              }}
            />
            <div className="text-[13px] text-white/65">More tax is more money. Above 20% people start to resent it.</div>
          </div>
          <div>
            <div className="flex justify-between text-[15px]">
              <span>Draft</span>
              <span className="font-semibold tabular-nums">{Math.round(draft * 100)}%</span>
            </div>
            <input
              type="range"
              className="w-full"
              aria-label="Draft rate"
              min={DRAFT_LIMITS.min}
              max={maxDraft}
              step={0.01}
              value={draft}
              onChange={(e) => {
                setPolicy(tax, +e.target.value)
              }}
            />
            <div className="text-[13px] text-white/65">Turns workers into soldiers you can train. Fewer workers means less money and food.</div>
          </div>
          <div className="inset-card p-3.5 text-[14px] space-y-1">
            <Line k="Food each month" v={signed(econ.netFood)} warn={econ.netFood < 0} />
            <Line k="New soldiers each month" v={`${signed(econ.militaryRegen, 0)}k`} />
            <Line k="Jobs filled" v={`${Math.round(econ.laborRatio * 100)}%`} warn={econ.laborRatio < 0.9} />
            <Line k="Stability is heading to" v={`${Math.round(econ.stabilityTarget)}%`} warn={econ.stabilityTarget < 40} />
          </div>
        </section>
      )}

      {tab === 'people' && (
        <section className="space-y-3">
          <p className="text-[14px] text-white/70">You rule these people. When their needs go unmet, they work less and fight less, and in the end they rise up.</p>
          {[
            {
              label: 'Food',
              value: econ.foodConsumption > 0 ? (econ.foodProduction / econ.foodConsumption) * 80 : 100,
              status: player.foodShortage ? 'Starving' : econ.netFood < 0 ? 'Running down' : 'Fed',
              tip: econ.netFood < 0 ? 'Build farms, lower the draft, or trade for food. Soldiers eat too.' : 'Enough to eat.',
            },
            {
              label: 'Work',
              value: econ.laborRatio * 100,
              status: `${Math.round(econ.laborRatio * 100)}% of jobs filled`,
              tip: econ.laborRatio < 0.9 ? 'Factories and farms need workers. A high draft or too many buildings leaves them empty.' : 'Your buildings are fully staffed.',
            },
            {
              label: 'Pay',
              value: 100 - player.taxRate * 250,
              status: `${Math.round(player.taxRate * 100)}% tax`,
              tip: player.taxRate > 0.2 ? 'Taxes above 20% anger people.' : 'Taxes are bearable.',
            },
            {
              label: 'Peace',
              value: 100 - (player.warWeariness / 60) * 100,
              status: player.warWeariness > 25 ? 'War-weary' : player.warWeariness > 8 ? 'Tired of war' : 'Calm',
              tip: enemiesOf(game, player.id).length > 0 ? 'Every war and every lost soldier adds to this. Peace lets it fade.' : 'No wars. Weariness is fading.',
            },
            {
              label: 'Order',
              value: player.stability,
              status: `${Math.round(player.stability)}% stable`,
              tip: econ.occupied > 0 ? `${econ.occupied} conquered ${econ.occupied === 1 ? 'country is' : 'countries are'} still settling in. Hold them with troops and time.` : 'Below 30%, rebels may rise.',
            },
          ].map((g) => (
            <div key={g.label} className="inset-card p-3.5 space-y-1.5">
              <div className="flex items-baseline justify-between text-[15px]">
                <span className="font-semibold">{g.label}</span>
                <span className="text-white/80">{g.status}</span>
              </div>
              <div className="h-2.5 rounded-full bg-white/12 overflow-hidden" role="img" aria-label={`${g.label} ${Math.round(Math.max(0, Math.min(100, g.value)))} out of 100`}>
                <div className="h-full" style={{ width: `${Math.max(2, Math.min(100, g.value))}%`, background: g.value < 35 ? '#ff453a' : g.value < 60 ? '#ffd60a' : '#30d158' }} />
              </div>
              <p className="text-[13px] text-white/70">{g.tip}</p>
            </div>
          ))}
        </section>
      )}

      {tab === 'laws' && (
        <section className="space-y-3">
          <p className="text-[14px] text-white/70">Laws change how the country runs. Passing one costs influence and takes effect at once.</p>
          {(Object.keys(LAW_SPECS) as LawId[]).map((law) => {
            const active = player.laws.includes(law)
            return (
              <div key={law} className="inset-card p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[16px] font-semibold tracking-tight">{LAW_SPECS[law].name}</span>
                  {active ? (
                    <OrderButton order={{ type: 'repealLaw', nationId: player.id, law }} label="Repeal" />
                  ) : (
                    <OrderButton order={{ type: 'enactLaw', nationId: player.id, law }} label="Pass" cost={`${LAW_SPECS[law].cost} influence`} tone="btn-primary" />
                  )}
                </div>
                <p className="text-[13px] text-white/70 mt-1.5">
                  {active ? 'In force. ' : ''}
                  {LAW_SPECS[law].description}
                </p>
              </div>
            )
          })}
        </section>
      )}
    </PanelShell>
  )
}

/** One list of shortcuts, shown in Settings and in the help window. */
export const SHORTCUTS = 'Enter: next turn. Esc: close. B briefing, E economy, M military, W wars, D diplomacy, R research, N news, A War Room for the selected country, ? help.'

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
    <PanelShell title="News" kicker="What has happened lately" panel="log">
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
  const setHelp = useGame((s) => s.setHelp)
  return (
    <PanelShell title="Settings" kicker="The game saves itself." panel="settings">
      <label className="flex items-center justify-between text-[15px]">
        <span>Battle windows</span>
        <select className="field px-3 py-2" value={settings.battleScenes} onChange={(e) => update({ battleScenes: e.target.value as 'all' | 'mine' | 'off' })}>
          <option value="all">Every battle I am in</option>
          <option value="mine">Only my attacks</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label className="flex items-center justify-between text-[15px]">
        <span>Battle speed</span>
        <select className="field px-3 py-2" value={settings.fxSpeed} onChange={(e) => update({ fxSpeed: +e.target.value as 1 | 2 })}>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
        </select>
      </label>
      <label className="flex items-center justify-between text-[15px]">
        <span>Monthly report after each turn</span>
        <input type="checkbox" checked={settings.monthlyReport} onChange={(e) => update({ monthlyReport: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-[15px]">
        <span>First-steps checklist in the Briefing</span>
        <input type="checkbox" checked={settings.showGuide} onChange={(e) => update({ showGuide: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-[15px]">
        <span>Reduce motion</span>
        <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => update({ reducedMotion: e.target.checked })} />
      </label>
      <button className="btn w-full py-2.5 text-[14px]" onClick={() => setHelp(true)}>
        How the game works
      </button>
      <button className="btn btn-red w-full py-2.5 text-[14px]" onClick={quit}>
        Leave game
      </button>
      <div className="label pt-2">Shortcuts</div>
      <p className="text-[14px] text-white/70">{SHORTCUTS}</p>
    </PanelShell>
  )
}
