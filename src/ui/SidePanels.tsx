import { dayDate, isLive } from '../engine/calendar'
import { Saves } from './Saves'
import { useEffect, useState, type ReactNode } from 'react'
import { turnDate } from '../engine/helpers'
import type { LogKind } from '../engine/types'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { DeskTabs, PanelShell } from './panel'
import { useDeskTab } from './deskTab'
import { KeysSheet } from './Help'
import { LevelPicker } from './kit'
import { EmptyState } from './widgets'
import { SCALES, SCALE_LABELS } from './prefs'
import { settingDef, type SettingsTab } from './settingsDefs'

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
        {groups.length === 0 && (q || kind !== 'all' ? <EmptyState compact title="Nothing matches" body="Try another word, or show all kinds of news." action={<button className="btn" onClick={() => { setQuery(''); setKind('all') }}>Clear search and filter</button>} /> : <EmptyState compact title="No news yet" body="Dispatches from your nation and the world appear here as the months pass." />)}
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

/** One setting: its name and what it does on the left (or above), its control under or beside it. Found by id when the jump window points at it. */
function SettingRow({ id, children, inline = false }: { id: string; children: ReactNode; inline?: boolean }) {
  const def = settingDef(id)
  const labelId = `set-${id}`
  return (
    <div data-setting={id} className={`setting-row ${inline ? 'inline' : ''}`}>
      <div className="min-w-0">
        <div id={labelId} className="text-[15px] font-medium">
          {def?.label ?? id}
        </div>
        {def && <p className="text-[13px] text-white/70 mt-0.5">{def.description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
      <span className="switch-text">{checked ? 'On' : 'Off'}</span>
    </button>
  )
}

/** Settings: how the game looks and behaves. Rows come from settingsDefs.ts; the jump window can open any of them. */
export function SettingsPanel() {
  const settings = useGame((s) => s.settings)
  const ui = settings.ui
  const update = useGame((s) => s.updateSettings)
  const updatePrefs = useGame((s) => s.updatePrefs)
  const resetPrefs = useGame((s) => s.resetPrefs)
  const askConfirm = useGame((s) => s.askConfirm)
  const quit = useGame((s) => s.quitToMenu)
  const setHelp = useGame((s) => s.setHelp)
  const setHelpTab = useGame((s) => s.setHelpTab)
  const live = useGame((s) => !!s.game && isLive(s.game))
  const tab = (useDeskTab('settings') ?? 'look') as SettingsTab
  const focus = useGame((s) => s.settingsFocus)
  // The jump window asked to show one setting: scroll to it, flash it once and put the keyboard on its control.
  useEffect(() => {
    if (!focus) return
    const row = document.querySelector<HTMLElement>(`[data-setting="${focus}"]`)
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'auto' })
      row.classList.remove('flash')
      void row.offsetWidth
      row.classList.add('flash')
      row.querySelector<HTMLElement>('button, input, select')?.focus({ preventScroll: true })
    }
    useGame.setState({ settingsFocus: null })
  }, [focus, tab])
  const scaleIndex = Math.max(0, SCALES.indexOf(ui.scale))
  return (
    <PanelShell title="Settings" kicker="The game saves itself." panel="settings" tabs={<DeskTabs desk="settings" />}>
      {tab === 'look' && (
        <div className="space-y-1">
          <SettingRow id="scale">
            <LevelPicker label="Text and interface size" levels={SCALES.map((s) => SCALE_LABELS[s])} value={scaleIndex} onChange={(i) => updatePrefs({ scale: SCALES[i] })} />
          </SettingRow>
          <SettingRow id="contrast" inline>
            <Switch label="High contrast" checked={ui.contrast === 'high'} onChange={(v) => updatePrefs({ contrast: v ? 'high' : 'normal' })} />
          </SettingRow>
          <SettingRow id="palette" inline>
            <Switch label="Color-blind safe colors" checked={ui.palette === 'colorblind'} onChange={(v) => updatePrefs({ palette: v ? 'colorblind' : 'standard' })} />
          </SettingRow>
          <SettingRow id="density">
            <LevelPicker label="Spacing" levels={['Comfortable', 'Compact']} value={ui.density === 'compact' ? 1 : 0} onChange={(i) => updatePrefs({ density: i === 1 ? 'compact' : 'comfortable' })} />
          </SettingRow>
          <SettingRow id="motion">
            <LevelPicker label="Motion" levels={['Follow the system', 'Reduce', 'Full']} value={['system', 'reduce', 'full'].indexOf(ui.motion)} onChange={(i) => updatePrefs({ motion: (['system', 'reduce', 'full'] as const)[i] })} />
          </SettingRow>
          <SettingRow id="widths" inline>
            <button className="btn" disabled={Object.keys(ui.panelWidths).length === 0} onClick={() => updatePrefs({ panelWidths: {} })}>
              Reset widths
            </button>
          </SettingRow>
          <SettingRow id="pins" inline>
            <span className="flex flex-wrap gap-2">
              <button className="btn" disabled={ui.pinned.length === 0} onClick={() => updatePrefs({ pinned: [] })}>
                Clear pins ({ui.pinned.length})
              </button>
              <button className="btn" disabled={ui.recents.length === 0} onClick={() => updatePrefs({ recents: [] })}>
                Clear recents ({ui.recents.length})
              </button>
            </span>
          </SettingRow>
          <SettingRow id="reset" inline>
            <button className="btn btn-red" onClick={() => askConfirm({ title: 'Reset look and feel?', text: 'Text size, contrast, colors, spacing and motion go back to the defaults. Your pins, saved games and game settings stay as they are.', label: 'Reset', danger: true, run: resetPrefs })}>
              Reset to defaults
            </button>
          </SettingRow>
        </div>
      )}
      {tab === 'play' && (
        <div className="space-y-1">
          {live && (
            <>
              <SettingRow id="pauseOnBattles" inline>
                <Switch label="Pause for my battles" checked={settings.pauseOnBattles} onChange={(v) => update({ pauseOnBattles: v })} />
              </SettingRow>
              <SettingRow id="liveReport">
                <select className="field px-3 py-2 w-full" aria-label="When a month ends" value={settings.liveReport} onChange={(e) => update({ liveReport: e.target.value as 'note' | 'pause' })}>
                  <option value="note">Show a short note</option>
                  <option value="pause">Pause for the report</option>
                </select>
              </SettingRow>
            </>
          )}
          <SettingRow id="battleScenes">
            <select className="field px-3 py-2 w-full" aria-label="Battle windows" value={settings.battleScenes} onChange={(e) => update({ battleScenes: e.target.value as 'all' | 'mine' | 'off' })}>
              <option value="all">Every battle I am in</option>
              <option value="mine">Only my attacks</option>
              <option value="off">Off</option>
            </select>
          </SettingRow>
          <SettingRow id="fxSpeed">
            <LevelPicker label="Battle speed" levels={['1×', '2×']} value={settings.fxSpeed === 2 ? 1 : 0} onChange={(i) => update({ fxSpeed: i === 1 ? 2 : 1 })} />
          </SettingRow>
          {!live && (
            <SettingRow id="monthlyReport" inline>
              <Switch label="Monthly report after each turn" checked={settings.monthlyReport} onChange={(v) => update({ monthlyReport: v })} />
            </SettingRow>
          )}
          <SettingRow id="showGuide" inline>
            <Switch label="First-steps checklist in the Briefing" checked={settings.showGuide} onChange={(v) => update({ showGuide: v })} />
          </SettingRow>
        </div>
      )}
      {tab === 'keys' && (
        <div data-setting="shortcuts">
          <KeysSheet live={live} />
        </div>
      )}
      {tab === 'saves' && (
        <div className="space-y-4" data-setting="saves">
          <Saves />
          <button className="btn w-full py-2.5 text-[14px]" onClick={() => { setHelpTab('guide'); setHelp(true) }}>
            How the game works
          </button>
          <button className="btn btn-red w-full py-2.5 text-[14px]" onClick={quit}>
            Leave game
          </button>
        </div>
      )}
    </PanelShell>
  )
}
