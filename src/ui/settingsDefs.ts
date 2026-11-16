/**
 * Every setting the player can change: its name, what it does in one sentence, and which Settings tab it lives on.
 * The Settings desk draws its rows from this list and the jump window (Ctrl+K) searches it, so a new setting is written once.
 */
export type SettingsTab = 'look' | 'play' | 'keys' | 'saves'

export interface SettingDef {
  id: string
  tab: SettingsTab
  label: string
  /** What it does, in plain words. Shown under the control and found by search. */
  description: string
  keywords?: string[]
  /** Only shown in live games or only in turn games. */
  only?: 'live' | 'turns'
}

export const SETTINGS_TABS: readonly (readonly [SettingsTab, string])[] = [
  ['look', 'Look and feel'],
  ['play', 'Gameplay'],
  ['keys', 'Keys'],
  ['saves', 'Saves'],
]

export const SETTING_DEFS: SettingDef[] = [
  { id: 'scale', tab: 'look', label: 'Text and interface size', description: 'Makes every desk, button and word bigger or smaller. The globe stays as it is.', keywords: ['font', 'zoom', 'bigger', 'larger', 'accessibility', 'readable'] },
  { id: 'contrast', tab: 'look', label: 'High contrast', description: 'Brighter text, solid panels and strong outlines, for bright rooms or tired eyes.', keywords: ['accessibility', 'contrast', 'dark', 'readable', 'outline'] },
  { id: 'palette', tab: 'look', label: 'Color-blind safe colors', description: 'Swaps the red and green of good and bad news, and the nation colors on the globe, for blues and oranges that stay apart.', keywords: ['colour', 'colorblind', 'deuteranopia', 'protanopia', 'red green', 'map colors'] },
  { id: 'density', tab: 'look', label: 'Spacing', description: 'Comfortable has room around everything. Compact fits more on each desk.', keywords: ['density', 'compact', 'padding', 'tight'] },
  { id: 'motion', tab: 'look', label: 'Motion', description: 'Fades, slides and counting numbers. Follow the system uses your device’s "reduce motion" switch.', keywords: ['animation', 'reduce motion', 'accessibility', 'animations'] },
  { id: 'widths', tab: 'look', label: 'Desk widths', description: 'Drag the right edge of a desk to resize it; the width is remembered. This puts them all back.', keywords: ['resize', 'panel width', 'drawer'] },
  { id: 'pins', tab: 'look', label: 'Pinned desks and recent searches', description: 'The star at the top of a desk pins it to the rail. Clear what you pinned and what you searched for.', keywords: ['favorites', 'favourites', 'pinned', 'recent', 'history'] },
  { id: 'pauseOnBattles', tab: 'play', label: 'Pause for my battles', description: 'The clock stops and the battle window opens for every battle you are in.', keywords: ['battle', 'pause', 'live'], only: 'live' },
  { id: 'liveReport', tab: 'play', label: 'When a month ends', description: 'Show a short note while the clock runs, or pause for the full report.', keywords: ['report', 'monthly', 'live'], only: 'live' },
  { id: 'battleScenes', tab: 'play', label: 'Battle windows', description: 'Which battles play round by round: every one you are in, only your attacks, or none.', keywords: ['battle', 'scenes', 'cutscene', 'animation'] },
  { id: 'fxSpeed', tab: 'play', label: 'Battle speed', description: 'How fast a battle plays out.', keywords: ['battle', 'fast', 'speed'] },
  { id: 'monthlyReport', tab: 'play', label: 'Monthly report after each turn', description: 'A summary of what changed, the news and what the advisor suggests.', keywords: ['report', 'summary', 'turn'], only: 'turns' },
  { id: 'showGuide', tab: 'play', label: 'First-steps checklist in the Briefing', description: 'Shows the short checklist for new players at the top of the Briefing.', keywords: ['tutorial', 'guide', 'beginner', 'checklist'] },
  { id: 'shortcuts', tab: 'keys', label: 'Keyboard shortcuts', description: 'Every key the game answers. Press ? anywhere to see them.', keywords: ['keys', 'hotkeys', 'keyboard', 'cheat sheet', 'bindings'] },
  { id: 'saves', tab: 'saves', label: 'Saved games', description: 'Save slots on this device, export and import a save file.', keywords: ['save', 'load', 'export', 'import', 'slot', 'file'] },
  { id: 'reset', tab: 'look', label: 'Reset look and feel to the defaults', description: 'Puts size, contrast, colors, spacing and motion back as they were. Your pins and saves are not touched.', keywords: ['defaults', 'restore', 'undo'] },
]

export const settingDef = (id: string): SettingDef | undefined => SETTING_DEFS.find((s) => s.id === id)

/** The settings that apply to this kind of game. */
export const settingsFor = (tab: SettingsTab, live: boolean): SettingDef[] => SETTING_DEFS.filter((s) => s.tab === tab && (!s.only || (s.only === 'live') === live))
