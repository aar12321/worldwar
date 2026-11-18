/**
 * THE one place that lists the desks and tabs of the game.
 *
 * The left rail, the phone bar and its More sheet, the jump window (Ctrl+K), the keyboard shortcuts and the help sheet,
 * the tab bars of the Economy, Military and Empire desks and the Pinned strip all read this list. To add a desk or a tab,
 * add an entry here (or drop a file in `src/ui/desks/`, see docs/UX.md). Nothing else needs to know about it.
 *
 * This file holds data only: no components and no store. Components are named by `load()` functions, so a desk is not
 * downloaded until somebody opens it, and so the tests can read the list without a browser.
 */
import type { ComponentType } from 'react'
import type { GameState } from '../engine/types'
import { SETTINGS_TABS } from './settingsDefs'

/** What a visibility check or a badge may look at. Cheap to build; narrowed so a live day does not rebuild it. */
export interface RegCtx {
  game: GameState | null
  live: boolean
  tier: number
  /** Offers waiting for your answer. */
  offers: number
  /** Advisor items marked "now". */
  urgent: number
  /** Faction votes and invitations waiting on you. */
  factionDue: number
  /** Wars you are in. */
  wars: number
  /** Armies you have in the field (live games). */
  armies: number
  /** Puppets you rule. */
  puppets: number
  /** Territories you hold. */
  territories?: number
}

export type Loader = () => Promise<{ default: ComponentType }>

/** Where a desk sits in the rail. Groups are shown in this order. */
export const NAV_GROUPS = [
  { id: 'home', label: 'Plan' },
  { id: 'nation', label: 'Nation' },
  { id: 'world', label: 'World' },
] as const
export type NavGroupId = (typeof NAV_GROUPS)[number]['id']

export interface TabDef {
  id: string
  label: string
  /** A few words on what the tab is for, shown in the jump window. */
  hint?: string
  /** Extra words that find this tab in the jump window. */
  keywords?: string[]
  /** A single key that opens this tab from anywhere (no modifier). */
  key?: string
  /** The tab's body, loaded when first opened. Not needed for a desk that draws its own tabs. */
  load?: Loader
  visible?: (ctx: RegCtx) => boolean
  /** A number shown on the tab ("Wars (2)"). Zero or null shows nothing. */
  badge?: (ctx: RegCtx) => number | null
}

export interface DeskDef {
  /** The id used by the store's `panel`. */
  id: string
  label: string
  /** One short line shown in the jump window and as a tooltip. */
  hint?: string
  /** Names an icon in `navIcons.tsx`. */
  icon: string
  /** The key that opens it. */
  key: string
  /** More keys that open it. */
  aliases?: string[]
  group: NavGroupId
  /** Sort order inside the rail. */
  order: number
  /** False for desks that open from the top bar (News, Settings) instead of the rail. */
  nav?: boolean
  keywords?: string[]
  /**
   * `custom`: `load` gives a whole desk that draws its own shell (the older desks do).
   * `auto` (the default for a desk with `tabs` or `body`): the game draws the shell, tab bar and loading state around your tab components.
   */
  shell?: 'custom' | 'auto'
  load?: Loader
  /** The body of an `auto` desk that has no tabs. */
  body?: Loader
  /** The line under the title of an `auto` desk. */
  kicker?: (ctx: RegCtx) => string
  tabs?: TabDef[]
  visible?: (ctx: RegCtx) => boolean
  badge?: (ctx: RegCtx) => number | null
}

const incomingCount = (g: GameState): number => (g.flights ?? []).filter((f) => f.nationId !== g.playerId && g.regions[f.target]?.owner === g.playerId).length

const lazyOf = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): Loader => () => load().then((m) => ({ default: m[name] }))

const economyTab = (id: string, label: string, hint: string, load: Loader, keywords: string[] = []): TabDef => ({ id, label, hint, keywords, load })

/** The built-in desks. Add yours here. */
export const DESKS: DeskDef[] = [
  { id: 'briefing', label: 'Briefing', hint: 'Your goal and what needs you this month', icon: 'briefing', key: 'b', group: 'home', order: 10, shell: 'custom', load: lazyOf(() => import('./Briefing'), 'Briefing'), keywords: ['advisor', 'goal', 'checklist', 'todo', 'tasks'], badge: (c) => c.urgent || null },

  {
    id: 'economy',
    label: 'Economy',
    hint: 'Cities, money, trade, people and government',
    icon: 'economy',
    key: 'e',
    aliases: ['c'],
    group: 'nation',
    order: 20,
    shell: 'custom',
    load: lazyOf(() => import('./EconomyDesk'), 'EconomyDesk'),
    keywords: ['money', 'budget', 'cities', 'taxes'],
    tabs: [
      economyTab('country', 'Country', 'Country and cities', lazyOf(() => import('./economy/CountryTab'), 'CountryTab'), ['cities', 'upgrades', 'governor', 'factory', 'farm', 'empire list']),
      economyTab('people', 'People', 'People: schools, health, welfare', lazyOf(() => import('./economy/PeopleTab'), 'PeopleTab'), ['schools', 'health', 'welfare', 'programs', 'campaign', 'epidemic', 'stability']),
      economyTab('budget', 'Budget', 'Budget and taxes', lazyOf(() => import('./economy/BudgetTab'), 'BudgetTab'), ['tax', 'income', 'draft', 'spending']),
      economyTab('bank', 'Bank', 'Bank: rates, printing, bonds', lazyOf(() => import('./economy/BankTab'), 'BankTab'), ['interest', 'print', 'bonds', 'debt', 'loan', 'currency']),
      economyTab('business', 'Business', 'Business and state enterprises', lazyOf(() => import('./economy/BusinessTab'), 'BusinessTab'), ['sectors', 'grants', 'subsidy', 'enterprise']),
      economyTab('projects', 'Projects', 'Projects and public works', lazyOf(() => import('./economy/ProjectsTab'), 'ProjectsTab'), ['rail', 'power', 'build', 'national', 'public works']),
      economyTab('space', 'Space', 'Space program: rockets, missions, labs, colonies', lazyOf(() => import('./economy/SpaceTab'), 'SpaceTab'), ['rocket', 'launch', 'mars', 'moon', 'satellite', 'colony', 'orbit']),
      economyTab('market', 'Market', 'Buy and sell food, oil, steel and goods', lazyOf(() => import('./economy/MarketTab'), 'MarketTab'), ['trade', 'oil', 'steel', 'food', 'goods', 'buy', 'sell']),
      economyTab('stocks', 'Stocks', 'The stock exchange and your companies', lazyOf(() => import('./economy/StocksTab'), 'StocksTab'), ['shares', 'dividend', 'company', 'exchange']),
      economyTab('government', 'Government', 'Cabinet, talent, jobs, policies and laws', lazyOf(() => import('./economy/GovernmentTab'), 'GovernmentTab'), ['laws', 'democracy', 'monarchy', 'junta', 'election', 'cabinet', 'ministers', 'talent', 'jobs', 'employment', 'civil service', 'policies', 'parliament', 'interest groups']),
    ],
  },

  {
    id: 'empire',
    label: 'Empire',
    hint: 'What your size opens up, officials, capitals, World Council',
    icon: 'empire',
    key: 'i',
    group: 'nation',
    order: 30,
    shell: 'custom',
    load: lazyOf(() => import('./EmpireDesk'), 'EmpireDesk'),
    keywords: ['tier', 'superpower', 'administration', 'council'],
    tabs: [
      { id: 'overview', label: 'Overview', hint: 'Tiers and what they open', keywords: ['tier', 'regional power', 'great power', 'superpower', 'hegemon'], load: lazyOf(() => import('./EmpireDesk'), 'EmpireOverview') },
      { id: 'provinces', label: 'Provinces', hint: 'Administration and capitals', keywords: ['occupation', 'capital', 'officials', 'settling'], load: lazyOf(() => import('./EmpireDesk'), 'EmpireProvinces') },
      { id: 'world', label: 'World', hint: 'World Council and reserve currency', keywords: ['council', 'resolution', 'vote', 'reserve currency'], load: lazyOf(() => import('./EmpireDesk'), 'EmpireWorld') },
      { id: 'reaction', label: 'World reaction', hint: 'How the world and its coalitions answer your growth', keywords: ['coalition', 'nukes', 'nuclear', 'sanctions', 'superpower'], load: lazyOf(() => import('./EmpireDesk'), 'EmpireReaction') },
      { id: 'stats', label: 'Statistics', hint: 'How your empire has grown', keywords: ['history', 'charts', 'graph'], load: lazyOf(() => import('./EmpireDesk'), 'EmpireStatistics') },
    ],
  },

  { id: 'tech', label: 'Research', hint: 'Technologies, Frontier programs and future programs', icon: 'research', key: 'r', aliases: ['t'], group: 'nation', order: 40, shell: 'custom', load: lazyOf(() => import('./TechTree'), 'TechTree'), keywords: ['technology', 'tech tree', 'science', 'frontier', 'medicine'] },

  {
    id: 'military',
    label: 'Military',
    hint: 'Forces, wars, agencies and Frontier systems',
    icon: 'military',
    key: 'm',
    group: 'world',
    order: 50,
    shell: 'custom',
    load: lazyOf(() => import('./MilitaryPanel'), 'MilitaryPanel'),
    keywords: ['army', 'units', 'war', 'train', 'weapons'],
    badge: (c) => c.wars || null,
    tabs: [
      { id: 'forces', label: 'Forces', hint: 'Forces and academy', keywords: ['infantry', 'tanks', 'train', 'weapons', 'drill', 'commander', 'aircraft', 'missiles', 'planes'], load: lazyOf(() => import('./MilitaryPanel'), 'MilitaryForces') },
      { id: 'deploy', label: 'Deployment', hint: 'Deployment: patrols, screens, border garrisons', keywords: ['station', 'garrison', 'border', 'patrol', 'reserve', 'navy', 'screen'], load: lazyOf(() => import('./DeploymentTab'), 'DeploymentTab') },
      { id: 'theatres', label: 'Theatres', hint: 'Theatres: where your forces stand, what is changing, what they achieve', keywords: ['theatre', 'theater', 'posture', 'alert', 'readiness', 'preset', 'strait', 'blockade', 'show of force', 'exercise', 'ledger', 'command'], load: lazyOf(() => import('./TheatresTab'), 'TheatresTab') },
      { id: 'armies', label: 'Armies', hint: 'Armies on the march (live games)', keywords: ['recall', 'march'], load: lazyOf(() => import('./ArmiesTab'), 'ArmiesTab'), visible: (c) => c.live, badge: (c) => c.armies || null },
      { id: 'wars', label: 'Wars', hint: 'Your wars, fronts and peace', key: 'w', keywords: ['peace', 'front', 'defense line', 'declare', 'attack'], load: lazyOf(() => import('./WarsPanel'), 'WarsTab'), badge: (c) => c.wars || null },
      { id: 'missiles', label: 'Missile War', hint: 'Missile war: radar, interceptors, counterforce, raids, doctrine, ceasefire', keywords: ['missile', 'radar', 'interceptor', 'salvo', 'decoy', 'counterforce', 'launch site', 'bomber', 'raid', 'scramble', 'doctrine', 'tension', 'ceasefire', 'silo'], load: lazyOf(() => import('./MissileWar'), 'MissileWarTab'), badge: (c) => (c.game ? incomingCount(c.game) || null : null) },
      { id: 'agencies', label: 'Agencies', hint: 'Intelligence and security services', keywords: ['spy', 'cia', 'fbi', 'sabotage', 'coup', 'rebels', 'intelligence'], load: lazyOf(() => import('./AgenciesTab'), 'AgenciesTab') },
      { id: 'systems', label: 'Systems', hint: 'Frontier systems: cyber, shield, AI, quantum, orbital', keywords: ['cyber', 'shield', 'interceptor', 'nano', 'orbital', 'quantum', 'missile defense'], load: lazyOf(() => import('./SystemsTab'), 'SystemsTab') },
    ],
  },

  { id: 'diplomacy', label: 'Diplomacy', hint: 'Offers, treaties and every nation’s opinion of you', icon: 'diplomacy', key: 'd', group: 'world', order: 60, shell: 'custom', load: lazyOf(() => import('./Diplomacy'), 'DiplomacyPanel'), keywords: ['treaty', 'alliance', 'pact', 'peace', 'offers', 'sanctions', 'trade', 'nations'], badge: (c) => c.offers || null },

  {
    id: 'relations',
    label: 'Relations',
    hint: 'Win nations over and keep them: visits, embassies, aid, ventures, joint war plans, favours',
    icon: 'relations',
    key: 'o',
    group: 'world',
    order: 62,
    shell: 'custom',
    load: lazyOf(() => import('./Relations'), 'RelationsPanel'),
    keywords: ['relationship', 'opinion', 'visit', 'embassy', 'aid', 'venture', 'locate', 'favour', 'war plan', 'trade', 'partners', 'attache'],
    badge: (c) => (c.game ? c.game.relations?.requests.filter((q) => q.to === c.game!.playerId).length || null : null),
  },

  { id: 'faction', label: 'Faction', hint: 'Votes, the common pool and contracts of your faction', icon: 'faction', key: 'f', group: 'world', order: 65, shell: 'custom', load: lazyOf(() => import('./Faction'), 'FactionPanel'), keywords: ['alliance', 'bloc', 'vote', 'pool', 'contracts', 'members'], badge: (c) => c.factionDue || null },

  { id: 'log', label: 'News', hint: 'What has happened lately', icon: 'news', key: 'n', aliases: ['l'], group: 'home', order: 90, nav: false, shell: 'custom', load: lazyOf(() => import('./SidePanels'), 'LogPanel'), keywords: ['log', 'dispatches', 'history', 'events'] },
  { id: 'settings', label: 'Settings', hint: 'Look and feel, controls, saves', icon: 'settings', key: '', group: 'home', order: 91, nav: false, shell: 'custom', load: lazyOf(() => import('./SidePanels'), 'SettingsPanel'), keywords: ['options', 'preferences', 'save', 'load', 'text size', 'contrast'], tabs: SETTINGS_TABS.map(([id, label]) => ({ id, label, hint: `Settings: ${label}` })) },
]

// ---------------------------------------------------------------------------------------------------------------------
// Anything dropped in src/ui/desks/ is picked up too: `export const desks: DeskDef[]` adds desks, `export const tabs` adds tabs
// to a desk that exists. See docs/UX.md ("Adding a new desk or tab in 5 minutes").
// ---------------------------------------------------------------------------------------------------------------------

export type ExtraTab = TabDef & { desk: string }
interface Extension {
  desks?: DeskDef[]
  tabs?: ExtraTab[]
}

const dropIns = (): Extension[] => {
  try {
    return Object.values(import.meta.glob<Extension>('./desks/*.ts', { eager: true }))
  } catch {
    return []
  }
}

/** Merges built-in desks with dropped-in ones. Pure, so it can be tested with made-up input. */
export function buildRegistry(base: readonly DeskDef[], extensions: readonly Extension[]): DeskDef[] {
  const out: DeskDef[] = base.map((d) => ({ ...d, tabs: d.tabs ? [...d.tabs] : undefined }))
  for (const ext of extensions) {
    for (const d of ext.desks ?? []) if (!out.some((x) => x.id === d.id)) out.push({ ...d })
    for (const { desk, ...tab } of ext.tabs ?? []) {
      const target = out.find((x) => x.id === desk)
      if (!target) continue
      target.tabs = target.tabs ?? []
      if (!target.tabs.some((t) => t.id === tab.id)) target.tabs.push(tab)
    }
  }
  return out.sort((a, b) => a.order - b.order)
}

let all: DeskDef[] | null = null
/** Every registered desk, in rail order. */
export function allDesks(): DeskDef[] {
  return (all ??= buildRegistry(DESKS, dropIns()))
}

export const findDesk = (id: string): DeskDef | undefined => allDesks().find((d) => d.id === id)
export const isVisible = (x: { visible?: (c: RegCtx) => boolean }, ctx: RegCtx) => !x.visible || x.visible(ctx)

/** The desks that show in the rail for this game. */
export const navDesks = (ctx: RegCtx): DeskDef[] => allDesks().filter((d) => d.nav !== false && isVisible(d, ctx))
/** The tabs of a desk that apply to this game. */
export const visibleTabs = (deskId: string, ctx: RegCtx): TabDef[] => (findDesk(deskId)?.tabs ?? []).filter((t) => isVisible(t, ctx))
export const findTab = (deskId: string, tabId: string): TabDef | undefined => findDesk(deskId)?.tabs?.find((t) => t.id === tabId)

/** The tab label with its badge: "Wars (2)". */
export function tabLabel(t: TabDef, ctx: RegCtx): string {
  const n = t.badge?.(ctx)
  return n ? `${t.label} (${n})` : t.label
}

/** The desks of the rail grouped for display, empty groups left out. */
export function groupedNav(ctx: RegCtx): { id: NavGroupId; label: string; desks: DeskDef[] }[] {
  const desks = navDesks(ctx)
  return NAV_GROUPS.map((g) => ({ ...g, desks: desks.filter((d) => d.group === g.id) })).filter((g) => g.desks.length > 0)
}

// --- Keys -----------------------------------------------------------------------------------------------------------

export interface KeyTarget {
  desk: string
  tab?: string
}

/** The desk or tab a single key opens, or null. Desk keys and their aliases first, then tab keys. */
export function targetForKey(key: string, ctx: RegCtx, desks: readonly DeskDef[] = allDesks()): KeyTarget | null {
  const k = key.toLowerCase()
  if (!k) return null
  for (const d of desks) if (isVisible(d, ctx) && (d.key === k || d.aliases?.includes(k))) return { desk: d.id }
  for (const d of desks) for (const t of d.tabs ?? []) if (t.key === k && isVisible(d, ctx) && isVisible(t, ctx)) return { desk: d.id, tab: t.id }
  return null
}

/** Keys in use, to catch two registrations asking for the same one. */
export function duplicateKeys(desks: readonly DeskDef[] = allDesks()): string[] {
  const seen = new Map<string, number>()
  for (const d of desks) {
    for (const k of [d.key, ...(d.aliases ?? [])]) if (k) seen.set(k, (seen.get(k) ?? 0) + 1)
    for (const t of d.tabs ?? []) if (t.key) seen.set(t.key, (seen.get(t.key) ?? 0) + 1)
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k)
}

// --- Pins -----------------------------------------------------------------------------------------------------------

export const pinId = (desk: string, tab?: string): string => (tab ? `tab:${desk}:${tab}` : `desk:${desk}`)

/** Turns a pin id back into something to open and show. Null when the desk or tab no longer exists. */
export function resolvePin(id: string, ctx: RegCtx): { desk: DeskDef; tab?: TabDef; label: string; icon: string } | null {
  const [kind, deskId, tabId] = id.split(':')
  const desk = deskId ? findDesk(deskId) : undefined
  if (!desk || !isVisible(desk, ctx)) return null
  if (kind === 'desk') return { desk, label: desk.label, icon: desk.icon }
  if (kind === 'tab' && tabId) {
    const tab = findTab(deskId, tabId)
    if (!tab || !isVisible(tab, ctx)) return null
    return { desk, tab, label: tab.label, icon: desk.icon }
  }
  return null
}

/** What the current place is called in a breadcrumb: "Economy", "Economy / Bank". */
export function crumbs(deskId: string, tabId: string | undefined): string[] {
  const desk = findDesk(deskId)
  if (!desk) return []
  const tab = tabId ? desk.tabs?.find((t) => t.id === tabId) : undefined
  return tab ? [desk.label, tab.label] : [desk.label]
}

/** The tab a desk is on, whichever of the store's fields keeps it. */
export interface TabMemory {
  economyTab: string
  militaryTab: string
  empireTab: string
  deskTabs: Record<string, string>
}
export function currentTab(st: TabMemory, deskId: string): string | undefined {
  if (deskId === 'economy') return st.economyTab
  if (deskId === 'military') return st.militaryTab
  if (deskId === 'empire') return st.empireTab
  return st.deskTabs[deskId] ?? findDesk(deskId)?.tabs?.[0]?.id
}
