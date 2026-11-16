/**
 * How the interface looks and behaves for one person: text size, contrast, density, motion, color palette, the panels they pinned,
 * what they searched for last and how wide they like their desks. Kept next to the game settings (under `settings.ui`), never in a save,
 * and always read through `sanitizePrefs`, so an old, damaged or hand-edited value can never break the screen.
 */

export const PREFS_VERSION = 1

export type UiScale = 0.9 | 1 | 1.1 | 1.25
export type Contrast = 'normal' | 'high'
export type Density = 'comfortable' | 'compact'
/** `system` follows the operating system's "reduce motion" switch. */
export type MotionPref = 'system' | 'reduce' | 'full'
export type PaletteKind = 'standard' | 'colorblind'

export interface UiPrefs {
  v: number
  scale: UiScale
  contrast: Contrast
  density: Density
  motion: MotionPref
  palette: PaletteKind
  /** Ids of pinned desks and tabs, in the order they were pinned: `desk:research`, `tab:economy:bank`. */
  pinned: string[]
  /** Ids the jump window opened lately, newest first. */
  recents: string[]
  /** The tab each desk was last left on. */
  lastTabs: Record<string, string>
  /** Navigation groups folded away in the rail. */
  navCollapsed: string[]
  /** Desk widths the player dragged to, in pixels. */
  panelWidths: Record<string, number>
}

export const SCALES: readonly UiScale[] = [0.9, 1, 1.1, 1.25]
export const MAX_PINNED = 8
export const MAX_RECENTS = 8
export const PANEL_WIDTH = { min: 340, max: 1100 }

export function defaultPrefs(): UiPrefs {
  return { v: PREFS_VERSION, scale: 1, contrast: 'normal', density: 'comfortable', motion: 'system', palette: 'standard', pinned: [], recents: [], lastTabs: {}, navCollapsed: [], panelWidths: {} }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const oneOf = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
const strings = (x: unknown, max: number): string[] => (Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 80))].slice(0, max) : [])

/** Keeps only the parts of a stored value the interface understands; anything else falls back to the default. */
export function sanitizePrefs(raw: unknown): UiPrefs {
  const d = defaultPrefs()
  if (!isRecord(raw)) return d
  const lastTabs: Record<string, string> = {}
  if (isRecord(raw.lastTabs)) for (const [k, v] of Object.entries(raw.lastTabs).slice(0, 40)) if (typeof v === 'string' && v.length < 40) lastTabs[k.slice(0, 40)] = v
  const panelWidths: Record<string, number> = {}
  if (isRecord(raw.panelWidths)) for (const [k, v] of Object.entries(raw.panelWidths).slice(0, 40)) if (typeof v === 'number' && Number.isFinite(v)) panelWidths[k.slice(0, 40)] = clampWidth(v)
  return {
    v: PREFS_VERSION,
    scale: oneOf(raw.scale, SCALES, d.scale),
    contrast: oneOf(raw.contrast, ['normal', 'high'] as const, d.contrast),
    density: oneOf(raw.density, ['comfortable', 'compact'] as const, d.density),
    motion: oneOf(raw.motion, ['system', 'reduce', 'full'] as const, d.motion),
    palette: oneOf(raw.palette, ['standard', 'colorblind'] as const, d.palette),
    pinned: strings(raw.pinned, MAX_PINNED),
    recents: strings(raw.recents, MAX_RECENTS),
    lastTabs,
    navCollapsed: strings(raw.navCollapsed, 20),
    panelWidths,
  }
}

/** The preferences for a stored settings object. Settings saved before they existed keep their old "reduce motion" choice. */
export function migrateSettingsUi(raw: { ui?: unknown; reducedMotion?: unknown } | null | undefined): UiPrefs {
  if (raw && isRecord(raw.ui)) return sanitizePrefs(raw.ui)
  return sanitizePrefs({ motion: raw?.reducedMotion === true ? 'reduce' : 'system' })
}

export const clampWidth = (w: number) => Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, w)))

/** Puts an id at the front of a recents list, once, and drops the oldest past the limit. */
export function pushRecent(list: readonly string[], id: string, max = MAX_RECENTS): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max)
}

/** Adds an id to the pinned list, or removes it if it is already there. A full list refuses a new pin. */
export function togglePinned(list: readonly string[], id: string, max = MAX_PINNED): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id)
  return list.length >= max ? [...list] : [...list, id]
}

/** Whether motion is reduced: the player's choice, or the operating system's when they left it on `system`. */
export const motionReduced = (pref: MotionPref, systemReduces: boolean): boolean => (pref === 'reduce' ? true : pref === 'full' ? false : systemReduces)

/** The attributes the page root carries for these preferences, so the stylesheet can react to them. */
export function rootAttributes(p: UiPrefs, systemReduces: boolean): Record<string, string> {
  return {
    'data-scale': String(p.scale),
    'data-contrast': p.contrast,
    'data-density': p.density,
    'data-palette': p.palette,
    'data-motion': motionReduced(p.motion, systemReduces) ? 'reduced' : 'full',
  }
}

export const systemReducesMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Writes the preferences onto the page root. Safe to call anywhere: it does nothing without a document. */
export function applyPrefs(p: UiPrefs): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [k, v] of Object.entries(rootAttributes(p, systemReducesMotion()))) root.setAttribute(k, v)
  root.style.setProperty('--ui-scale', String(p.scale))
}

/** One-line names for the choices, shared by the settings screen and the jump window. */
export const SCALE_LABELS: Record<UiScale, string> = { 0.9: 'Small', 1: 'Normal', 1.1: 'Large', 1.25: 'Largest' }
