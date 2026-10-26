import { useEffect, useState } from 'react'
import { BUILDING_SPECS, DRAFT_LIMITS, LAW_SPECS, TAX_LIMITS, buildingCost } from '../data/unitTypes'
import { buildingCap, regionWorkforce } from '../engine/economy'
import { regionsOf, turnDate } from '../engine/helpers'
import { BUILDING_TYPES } from '../engine/types'
import type { LawId, LogKind } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { Pips } from './bits'
import { signed, usePlayerView } from './hooks'
import { OrderButton, PanelShell } from './panel'

export function CountryDrawer() {
  const view = usePlayerView()
  const setPolicy = useGame((s) => s.setPolicy)
  const tab = useGame((s) => s.countryTab)
  const setTab = useGame((s) => s.setCountryTab)
  const [tax, setTax] = useState(view?.pendingPolicy.taxRate ?? 0.25)
  const [draft, setDraft] = useState(view?.pendingPolicy.draftRate ?? 0.05)
  const [picked, setPicked] = useState<string | null>(null)
  const pTax = view?.pendingPolicy.taxRate
  const pDraft = view?.pendingPolicy.draftRate
  useEffect(() => {
    if (pTax !== undefined && pDraft !== undefined) {
      setTax(pTax)
      setDraft(pDraft)
    }
  }, [pTax, pDraft])
  if (!view) return null
  const { game, player, econ } = view
  const { map } = getWorld()
  const maxDraft = player.laws.includes('conscription_act') ? DRAFT_LIMITS.maxWithConscription : DRAFT_LIMITS.max
  const owned = regionsOf(game, player.id)
  const regionId = picked && owned.includes(picked) ? picked : owned.includes(player.capital) ? player.capital : owned[0]
  const region = game.regions[regionId]

  return (
    <PanelShell title="Your country" kicker={`${player.name} · ${owned.length === 1 ? '1 country' : `${owned.length} countries`}`} panel="country">
      <div className="segmented">
        {([
          ['build', 'Upgrades'],
          ['economy', 'Economy'],
          ['laws', 'Laws'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'build' && region && (
        <section className="space-y-3">
          <p className="text-[14px] text-white/70">Each upgrade takes effect the moment you buy it. Bigger countries can reach higher levels.</p>
          {owned.length > 1 && (
            <label className="block text-[14px]">
              <span className="label block mb-1">Country</span>
              <select className="field w-full px-3 py-2" value={regionId} onChange={(e) => setPicked(e.target.value)}>
                {owned.map((id) => (
                  <option key={id} value={id}>
                    {map.regions[id].name}
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
                    <div className="text-[13px] text-white/70 mt-0.5">{spec.effect}</div>
                  </div>
                  <span className="text-[14px] font-semibold tabular-nums shrink-0">
                    {level}
                    <span className="text-white/60">/{cap}</span>
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <Pips value={Math.min(level, 10)} max={Math.min(cap, 10)} />
                  {level >= cap ? (
                    <span className="chip chip-green">Highest level</span>
                  ) : (
                    <OrderButton order={{ type: 'build', nationId: player.id, regionId, building: b }} label={`Upgrade · ${buildingCost(b, level)} money`} tone="btn-primary" />
                  )}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {tab === 'economy' && (
        <section className="space-y-4">
          <p className="text-[14px] text-white/70">Taxes and the draft take effect when you press Next turn.</p>
          <div>
            <div className="flex justify-between text-[15px]">
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
            <div className="text-[13px] text-white/65">Higher taxes bring in more money, and unsettle the country once they pass 20%.</div>
          </div>
          <div>
            <div className="flex justify-between text-[15px]">
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
            <div className="text-[13px] text-white/65">Moves civilians into the military. Fewer workers means less money, food, and factory output.</div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[14px] inset-card p-3.5">
            <span className="text-white/70">Money / turn</span>
            <span className="text-right">{signed(econ.netCapital)}</span>
            <span className="text-white/70">Food / turn</span>
            <span className={`text-right ${econ.netFood < 0 ? 'text-[#ff6961]' : ''}`}>{signed(econ.netFood)}</span>
            <span className="text-white/70">Soldiers / turn</span>
            <span className="text-right">{signed(econ.militaryRegen, 0)}k</span>
            <span className="text-white/70">Stability heading to</span>
            <span className="text-right">{Math.round(econ.stabilityTarget)}%</span>
            <span className="text-white/70">People at work</span>
            <span className="text-right">{Math.round(econ.laborRatio * 100)}%</span>
          </div>
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
                    <OrderButton order={{ type: 'enactLaw', nationId: player.id, law }} label={`Pass · ${LAW_SPECS[law].cost} influence`} tone="btn-primary" />
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
        <span>Reduce motion</span>
        <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => update({ reducedMotion: e.target.checked })} />
      </label>
      <button className="btn w-full py-2.5 text-[14px]" onClick={() => setHelp(true)}>
        How to play
      </button>
      <button className="btn btn-red w-full py-2.5 text-[14px]" onClick={quit}>
        Leave game
      </button>
      <div className="label pt-2">Shortcuts</div>
      <p className="text-[14px] text-white/70">Enter: next turn. Esc: close. C country, M military, T research, D diplomacy, L news. ?: how to play.</p>
    </PanelShell>
  )
}
