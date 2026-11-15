import { dayDate, isLive } from '../engine/calendar'
import { shortcutsFor } from './shortcuts'
import { Saves } from './Saves'
import { useState } from 'react'
import { turnDate } from '../engine/helpers'
import type { LogKind } from '../engine/types'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { PanelShell } from './panel'

/** One list of shortcuts, shown in Settings and in the help window. */

const KIND_COLOR: Record<LogKind, string> = {
  news: 'text-[#ffd60a]',
  info: 'text-white/80',
  war: 'text-[#ff8a84]',
  battle: 'text-[#ffd60a]',
  tech: 'text-[#64d2ff]',
  economy: 'text-[#6eeb8a]',
  event: 'text-[#f0a8ff]',
  spy: 'text-[#bf9bff]',
  diplomacy: 'text-[#6cb4ff]',
}

const NEWS_FILTERS: [string, string, LogKind[] | null][] = [
  ['all', 'All', null],
  ['war', 'War', ['war', 'battle']],
  ['diplomacy', 'Diplomacy', ['diplomacy']],
  ['economy', 'Economy', ['economy', 'tech']],
  ['events', 'Events', ['event', 'news', 'spy']],
]

/** The news: your nation's or the world's, by kind, searchable, grouped by month. */
export function LogPanel() {
  const view = usePlayerView()
  const [scope, setScope] = useState<'mine' | 'world'>('mine')
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')
  if (!view) return null
  const { game, player } = view
  const live = isLive(game)
  const kinds = NEWS_FILTERS.find((f) => f[0] === kind)?.[2] ?? null
  const q = query.trim().toLowerCase()
  const entries = game.log
    .filter((l) => (scope === 'world' || l.nations.includes(player.id)) && (!kinds || kinds.includes(l.kind)) && (!q || l.text.toLowerCase().includes(q)))
    .slice(-200)
    .reverse()
  const groups: { turn: number; items: typeof entries }[] = []
  for (const l of entries) {
    const g = groups[groups.length - 1]
    if (g && g.turn === l.turn) g.items.push(l)
    else groups.push({ turn: l.turn, items: [l] })
  }
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
      <div className="flex flex-wrap items-center gap-2">
        <input className="field px-3 py-2 text-[14px] flex-1 min-w-36" placeholder="Search the news" aria-label="Search the news" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Kind of news">
          {NEWS_FILTERS.map(([k, name]) => (
            <button key={k} role="radio" aria-checked={kind === k} className={`btn px-2.5 py-1.5 text-[13px] ${kind === k ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setKind(k)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {groups.length === 0 && <p className="text-sm text-white/55">{q || kind !== 'all' ? 'Nothing matches.' : 'No dispatches yet.'}</p>}
        {groups.map((g) => (
          <section key={g.turn} className="space-y-1.5">
            <h3 className="label sticky top-0 bg-[#1c1c20]/95 py-1 z-10">{turnDate(g.turn)}</h3>
            {g.items.map((l, i) => (
              <div key={i} className="text-sm border-l-2 border-white/15 pl-2">
                {live && l.day !== undefined && <span className="text-[11px] text-white/50 mr-2">{dayDate(l.turn, l.day).split(' ').slice(0, 2).join(' ')}</span>}
                <span className={KIND_COLOR[l.kind]}>{l.text}</span>
              </div>
            ))}
          </section>
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
      {!live && (
        <label className="flex items-center justify-between text-[15px]">
          <span>Monthly report after each turn</span>
          <input type="checkbox" checked={settings.monthlyReport} onChange={(e) => update({ monthlyReport: e.target.checked })} />
        </label>
      )}
      <label className="flex items-center justify-between text-[15px]">
        <span>First-steps checklist in the Briefing</span>
        <input type="checkbox" checked={settings.showGuide} onChange={(e) => update({ showGuide: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-[15px]">
        <span>Reduce motion</span>
        <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => update({ reducedMotion: e.target.checked })} />
      </label>
      <Saves />
      <button className="btn w-full py-2.5 text-[14px]" onClick={() => setHelp(true)}>
        How the game works
      </button>
      <button className="btn btn-red w-full py-2.5 text-[14px]" onClick={quit}>
        Leave game
      </button>
      <div className="label pt-2">Shortcuts</div>
      <p className="text-[14px] text-white/70">{shortcutsFor(live)}</p>
    </PanelShell>
  )
}
