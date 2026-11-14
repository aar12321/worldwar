import { dayDate, isLive } from '../engine/calendar'
import { useState } from 'react'
import { turnDate } from '../engine/helpers'
import type { LogKind } from '../engine/types'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { PanelShell } from './panel'

/** One list of shortcuts, shown in Settings and in the help window. */
export const SHORTCUTS = 'Enter: next turn. Esc: close. B briefing, E economy, M military, W wars, D diplomacy, R research, N news, A War Room for the selected country, ? help.'

const KIND_COLOR: Record<LogKind, string> = {
  news: 'text-amber-200',
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
            <span className="text-[10px] text-slate-500 font-display mr-2">{l.day !== undefined ? dayDate(l.turn, l.day) : turnDate(l.turn)}</span>
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
  const live = useGame((s) => !!s.game && isLive(s.game))
  return (
    <PanelShell title="Settings" kicker="The game saves itself." panel="settings">
      {live && (
        <>
          <label className="flex items-center justify-between text-[15px] gap-3">
            <span>Pause and open the battle window for my battles</span>
            <input type="checkbox" checked={settings.pauseOnBattles} onChange={(e) => update({ pauseOnBattles: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-[15px] gap-3">
            <span>When a month ends</span>
            <select className="field px-3 py-2" value={settings.liveReport} onChange={(e) => update({ liveReport: e.target.value as 'note' | 'pause' })}>
              <option value="note">Show a short note</option>
              <option value="pause">Pause for the report</option>
            </select>
          </label>
        </>
      )}
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
      <p className="text-[14px] text-white/70">{live ? SHORTCUTS.replace('Enter: next turn. ', 'Space: play or pause. 1, 2, 3: speed. ') : SHORTCUTS}</p>
    </PanelShell>
  )
}
