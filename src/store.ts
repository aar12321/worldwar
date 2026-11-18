import { create } from 'zustand'
import { generateAllBotOrders } from './ai/bot'
import { createInitialState, type NewGameOptions } from './data/startingNations'
import type { AdviceTarget, PeopleSection } from './engine/advisor'
import { applyEventChoice } from './engine/events'
import { factionNews } from './engine/factions'
import { programNews } from './engine/missileProgram'
import { commandLevel, DEFAULT_AUTO, planMonth, type AutoSettings } from './engine/commander'
import { maxAttacks, turnDate } from './engine/helpers'
import { normalizeGame } from './engine/migrate'
import { markMonth, statsOf } from './engine/monthMark'
import { markSettled } from './engine/economy'
import { MONTH_END_ORDERS, innerType, isMonthEndOrder, undoable, validateOrder } from './engine/orders'
import { absDate, clockOf, dayDate, isLive } from './engine/calendar'
import { advanceDay } from './engine/live'
import type { Commit, Stance } from './data/war'
import { applyOrderNow, describeOrder, resolveTurn } from './engine/resolveTurn'
import type { BattleReport, Dispatch, GameState, MonthMark, MonthStats, NationId, Order, Programs, RegionId, Spending, UnitCounts } from './engine/types'
import { getWorld } from './map/world'
import { newClientId, newRoomCode, normalizeCode, validCode, type ChatMessage, type ClientId, type ClockView, type Lobby, type OpenSeat, type RoomSettings } from './net/protocol'
import { loadOnlineSave, writeOnlineSave } from './net/saves'
import { OnlineSession, type LiveStatus, type OrderEvent } from './net/session'
import type { LiveStep } from './engine/live'
import { openTransport, type TransportStatus } from './net/transport'
import { globeBridge, useFx } from './ui/globeBridge'
import { battleLine, scenesFor } from './ui/battleText'
import { presentLiveStep } from './ui/livePresent'
import { speak } from './ui/plain'
import type { PendingConfirm } from './ui/confirmRules'
import { applyPrefs, defaultPrefs, migrateSettingsUi, motionReduced, sanitizePrefs, systemReducesMotion, type UiPrefs } from './ui/prefs'

const SAVE_KEY = 'worlds-of-others-save-v4'
const ORDERS_KEY = 'worlds-of-others-orders-v4'
const SETTINGS_KEY = 'worlds-of-others-settings-v2'
const SLOT_KEY = (i: number) => `worlds-of-others-slot-${i}`
export const SLOT_COUNT = 3
/** Everything a crashed game may have left behind. */
export const SAVE_KEYS = [SAVE_KEY, ORDERS_KEY]

/**
 * The desks, plus News and Settings which open from the top bar. Any id in the desk registry (src/ui/registry.ts) is a panel too,
 * so a new desk needs no change here.
 */
export type Panel = 'none' | 'briefing' | 'economy' | 'military' | 'tech' | 'diplomacy' | 'faction' | 'empire' | 'log' | 'settings' | (string & {})
export type EmpireTab = 'overview' | 'provinces' | 'world' | 'reaction' | 'stats' | 'puppets' | 'territories'
export type { PeopleSection }
export type EconomyTab = 'country' | 'people' | 'budget' | 'bank' | 'business' | 'projects' | 'space' | 'market' | 'stocks' | 'government'
export type MilitaryTab = 'forces' | 'deploy' | 'theatres' | 'wars' | 'agencies' | 'systems' | 'armies' | 'missiles' | 'program'
/** What the globe's colors mean. */
export type MapMode = 'political' | 'relations' | 'fronts' | 'borders'

export interface PolicyPatch {
  taxRate?: number
  draftRate?: number
  corporateTax?: number
  /** Changes to spending levels; levels not named keep what is queued or set. */
  spending?: Partial<Spending>
}

export interface Settings {
  reducedMotion: boolean
  fxSpeed: 1 | 2
  /** Which battles play the round-by-round window: every battle you are in, only your attacks, or none. */
  battleScenes: 'all' | 'mine' | 'off'
  /** Whether the How to play window has been shown. */
  seenHelp: boolean
  /** Show the monthly report after every turn. */
  monthlyReport: boolean
  /** Show the first-steps checklist in the Briefing. */
  showGuide: boolean
  /** Live games: stop the clock and play the battle window for every battle you are in. */
  pauseOnBattles: boolean
  /** Live games: at the end of a month, stop for the report, or show it as a short note while the clock runs. */
  liveReport: 'note' | 'pause'
  /** Live games: how fast time runs. */
  liveSpeed: 1 | 2 | 4
  /** How the interface looks and behaves for this person: text size, contrast, density, pins, recents. */
  ui: UiPrefs
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error' | 'success'
  /** A button on the toast, such as Undo. */
  action?: { label: string; run: () => void }
}

export interface ReportDelta {
  label: string
  before: number
  after: number
  suffix?: string
  digits?: number
}

/** What happened while the month resolved, shown once the battles have played. */
export interface MonthReport {
  /** The month that just ended. */
  turn: number
  deltas: ReportDelta[]
  battles: { text: string; good: boolean }[]
  /** News about your own nation. */
  lines: string[]
  /** The biggest news from the rest of the world. */
  world: string[]
}

/** What the screen shows about an online room. */
export interface OnlineView {
  status: 'lobby' | 'playing'
  code: string
  clientId: ClientId
  name: string
  kind: 'supabase' | 'browser' | 'memory'
  host: boolean
  lobby: Lobby | null
  /** Nations whose players are done planning this month. */
  ready: NationId[]
  /** When the month ends by the clock of this screen, or null with no timer. */
  deadline: number | null
  peers: ClientId[]
  chat: ChatMessage[]
  unread: number
  error: string | null
  /** True until the room answers. */
  connecting: boolean
  /** Whether the line to the room is up. While it is down this screen is not sending or hearing anything. */
  connection: TransportStatus
  /** Joining a game under way: the seats this player may take. Null when there is nothing to choose. */
  seats: OpenSeat[] | null
  /** Live rooms: the shared clock, as the host last set it. */
  clock: ClockView | null
  /** Live rooms: how the line to the shared game is doing. */
  live: LiveStatus | null
}

const ONLINE_KEY = 'worlds-of-others-online'

/** The name this device used last time, to fill in the form. */
export const rememberedName = () => loadIdentity().name

const TAB_KEY = 'worlds-of-others-tab'

/** Each tab is its own player, so two tabs of one browser can play together. A reload keeps the same id. */
function tabClientId(): ClientId {
  try {
    let id = sessionStorage.getItem(TAB_KEY)
    if (!id) {
      id = newClientId()
      sessionStorage.setItem(TAB_KEY, id)
    }
    return id
  } catch {
    return newClientId()
  }
}

/** The last room joined on this device, and who this device was in it, so it can be rejoined in the same seat. */
function loadIdentity(): { clientId: ClientId | null; name: string; code: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(ONLINE_KEY) ?? 'null') as { clientId?: string; name?: string; code?: string | null } | null
    if (raw) return { clientId: raw.clientId ?? null, name: raw.name ?? '', code: raw.code ?? null }
  } catch {
    /* storage may be unavailable */
  }
  return { clientId: null, name: '', code: null }
}

function saveIdentity(id: { clientId: ClientId | null; name: string; code: string | null }) {
  try {
    localStorage.setItem(ONLINE_KEY, JSON.stringify(id))
  } catch {
    /* storage may be unavailable */
  }
}

export interface GameStore {
  online: OnlineView | null
  /** The last room this device was in, so it can be rejoined. */
  lastRoom: string | null
  createOnline(name: string, settings: RoomSettings): Promise<void>
  joinOnline(name: string, code: string, rejoin?: boolean): Promise<void>
  pickOnlineNation(nationId: NationId | null): void
  updateOnlineSettings(settings: RoomSettings): void
  startOnline(): Promise<void>
  leaveOnline(): void
  /** Opens a saved room again from this device, as the player of `seat`. The others join with the code and take their seats back. */
  resumeOnline(name: string, code: string, seat: NationId): Promise<void>
  takeOnlineSeat(nationId: NationId): void
  /** Host only. */
  kickOnlinePlayer(clientId: ClientId): void
  /** Host only: back to the lobby with the same players, for another game. */
  rematchOnline(): void
  /** Online: the player put the waiting decision off until later (this month), or asked for it back. */
  eventDismissedTurn: number | null
  dismissEvent(turn: number | null): void
  /** Online: opens the decision again, taking back the answer already given. */
  reopenEvent(): void
  sendChat(text: string): void
  markChatRead(): void
  /** Online: send the plan, and say whether the player is done. */
  setReady(ready: boolean): void

  game: GameState | null
  /** Orders that wait for Next Turn. */
  orders: Order[]
  selectedRegion: RegionId | null
  panel: Panel
  economyTab: EconomyTab
  peopleSection: PeopleSection
  setPeopleSection(section: PeopleSection): void
  /** Country shown in the Economy desk's upgrade list. Null means the capital. */
  economyRegion: RegionId | null
  militaryTab: MilitaryTab
  empireTab: EmpireTab
  setEmpireTab(tab: EmpireTab): void
  openEmpire(tab?: EmpireTab): void
  /** The nation the agencies are looking at. */
  agencyTarget: NationId | null
  setAgencyTarget(id: NationId | null): void
  /** Opens the agencies with a nation already chosen as the target. */
  openAgencies(target?: NationId): void
  mapMode: MapMode
  diploFocus: NationId | null
  /** A nation to pick in the Faction desk's invitation list, set when you come from its Diplomacy card. */
  factionFocus: NationId | null
  /** Opening Diplomacy from a war: the peace composer opens by itself on that nation. */
  diploPeace: boolean
  /** Battles waiting to play in the battle window. The first one is showing. */
  fxQueue: BattleReport[]
  /** How many battles this batch started with, for "Battle 2 of 4". */
  fxTotal: number
  summary: MonthReport | null
  helpOpen: boolean
  /** Country whose War Room is open, if any. */
  warRoom: RegionId | null
  /** The aircraft development screen (Military, Forces) is open. */
  aircraftOpen: boolean
  settings: Settings
  toasts: Toast[]
  hasSave: boolean
  /** Live games: whether the clock is running. A game starts, loads and leaves its menus paused. */
  running: boolean
  /** Live games: the army whose card is showing. */
  selectedArmy: string | null
  /** Live games: the last battles the player was in, newest first. */
  recentBattles: BattleReport[]
  /** Live games: the month's report, waiting to be opened. */
  liveNote: MonthReport | null
  /** When the game was last written to this device, and whether the last try failed. */
  savedAt: number | null
  saveFailed: boolean
  paletteOpen: boolean
  setPalette(open: boolean): void
  /** The tab each registry desk other than Economy, Military and Empire is on. */
  deskTabs: Record<string, string>
  /** Opens a desk on one of its tabs (any registered desk or tab), remembering it. */
  openTab(desk: string, tab?: string): void
  /** Changes the tab of the open desk without opening anything. */
  setDeskTab(desk: string, tab: string): void
  /** Which tab of the help window is showing. */
  helpTab: 'guide' | 'keys'
  setHelpTab(tab: 'guide' | 'keys'): void
  /** A setting the jump window asked to show: the Settings desk scrolls to it and flashes it once. */
  settingsFocus: string | null
  /** Changes how the interface looks and behaves; saved with the settings. */
  updatePrefs(patch: Partial<UiPrefs>): void
  /** Puts every look-and-feel choice back to its default (pins and recents stay). */
  resetPrefs(): void
  /** Save slots, on this device. Each keeps a whole game and the month's waiting orders. */
  saveSlot(slot: number): boolean
  loadSlot(slot: number): boolean
  /** The game as a file's text, to keep or to move to another device. */
  exportSave(): string | null
  importSave(text: string): boolean
  /** A question waiting for yes or no before a big order goes through. */
  confirm: PendingConfirm | null
  askConfirm(c: PendingConfirm): void
  closeConfirm(): void
  /** What can be taken back: the games before each order that happened at once, newest last. */
  undoStack: { game: GameState; label: string }[]
  undo(): void

  newGame(opts: NewGameOptions): void
  loadGame(): void
  quitToMenu(): void
  /** Leaves a finished or unwanted game and deletes its save. */
  abandonGame(): void
  selectRegion(id: RegionId | null): void
  setPanel(panel: Panel): void
  setEconomyTab(tab: EconomyTab): void
  setEconomyRegion(id: RegionId | null): void
  openEconomy(tab: EconomyTab, region?: RegionId): void
  setMilitaryTab(tab: MilitaryTab): void
  openMilitary(tab: MilitaryTab): void
  setMapMode(mode: MapMode): void
  /** Follows an advisor button to the desk, tab, country or window it points at. */
  goTo(target: AdviceTarget): void
  openDiplomacy(nationId: NationId | null, opts?: { peace?: boolean }): void
  /** Opens the Faction desk. */
  openFaction(nation?: NationId | null): void
  /** Opens the Relations desk, on a partner if one is given. */
  openRelations(nation?: NationId | null): void
  /** Closes the open desk, selects the nation's country, turns the globe to it with a pulse ring, and offers a way back to the desk. */
  locateNation(id: NationId): void
  /** The nation the Relations desk has open. */
  relFocus: NationId | null
  issueOrder(order: Order): boolean
  /** Issues several orders at once, one save and one summary. Returns how many went through. */
  issueBatch(orders: Order[]): { done: number; failed: number }
  removeOrder(index: number): void
  /** Queues new tax, draft, business tax or spending settings for the end of the month. */
  setPolicy(patch: PolicyPatch): void
  /** Queues changes to the nation's programs (schools, immigration, occupation...) and interest rate for the end of the month. */
  setPrograms(programs: Partial<Programs>, rate?: number): void
  attack(target: RegionId, commit?: Commit, stance?: Stance, missiles?: number, share?: number, units?: Partial<UnitCounts>): boolean
  /** AI Battle Command's standing auto-command (level 3): the limits the player set. Saved on this device. */
  autoCommand: AutoSettings
  /** Changes the limits. Turning it on plans the month at once; turning it off takes the planned attacks out of the tray. */
  setAutoCommand(patch: Partial<AutoSettings>): void
  /** Plans (or re-plans) the month's attacks within the limits and puts them in the order tray, marked as auto-command. Returns how many. */
  planAutoCommand(): number
  openWarRoom(target: RegionId | null): void
  setAircraftOpen(open: boolean): void
  endTurn(): void
  /** Live games: start or stop the clock. */
  play(): void
  pause(): void
  togglePause(): void
  setSpeed(speed: 1 | 2 | 4): void
  /** Live games: moves the game on by one day, unless something holds the clock. */
  stepDay(): void
  selectArmy(id: string | null): void
  recallArmy(id: string): boolean
  /** Plays a battle from the recent list again in the battle window. */
  openBattle(id: string): void
  /** Opens the month's report that was waiting as a note. */
  openNote(): void
  chooseEventOption(index: number): void
  shiftFx(): void
  clearFx(): void
  dismissSummary(): void
  setHelp(open: boolean): void
  updateSettings(patch: Partial<Settings>): void
  toast(text: string, tone?: Toast['tone'], ms?: number, action?: Toast['action']): void
  dismissToast(id: number): void
  persist(): void
}

const defaultSettings: Settings = {
  reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  fxSpeed: 1,
  battleScenes: 'all',
  seenHelp: false,
  monthlyReport: true,
  showGuide: true,
  pauseOnBattles: false,
  liveReport: 'note',
  liveSpeed: 1,
  ui: defaultPrefs(),
}

/** Keeps a stored setting only if it has a value the game understands. */
function sanitizeSettings(raw: Partial<Settings>): Settings {
  const merged = { ...defaultSettings, ...raw }
  // Settings saved before the look-and-feel preferences existed keep their old motion choice.
  const ui = migrateSettingsUi(raw)
  const oneOf = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
  return {
    reducedMotion: motionReduced(ui.motion, systemReducesMotion()),
    fxSpeed: oneOf(merged.fxSpeed, [1, 2], 1),
    battleScenes: oneOf(merged.battleScenes, ['all', 'mine', 'off'], 'all'),
    seenHelp: merged.seenHelp === true,
    monthlyReport: merged.monthlyReport !== false,
    showGuide: merged.showGuide !== false,
    pauseOnBattles: merged.pauseOnBattles === true,
    liveReport: oneOf(merged.liveReport, ['note', 'pause'], 'note'),
    liveSpeed: oneOf(merged.liveSpeed, [1, 2, 4], 1),
    ui,
  }
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? sanitizeSettings(JSON.parse(raw) as Partial<Settings>) : defaultSettings
  } catch {
    return defaultSettings
  }
}

const AUTO_KEY = 'worlds-of-others-auto-command-v1'

function loadAutoCommand(): AutoSettings {
  try {
    const raw = localStorage.getItem(AUTO_KEY)
    if (!raw) return { ...DEFAULT_AUTO }
    return sanitizeAuto(JSON.parse(raw) as Partial<AutoSettings>)
  } catch {
    return { ...DEFAULT_AUTO }
  }
}

/** The player's limits, kept to what the planner accepts. */
export function sanitizeAuto(a: Partial<AutoSettings>): AutoSettings {
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d)
  const objective = a.objective === 'losses' || a.objective === 'fast' || a.objective === 'defend' ? a.objective : 'win'
  return { on: a.on === true, objective, maxAttacks: Math.round(num(a.maxAttacks, 1, 9, DEFAULT_AUTO.maxAttacks)), reserve: num(a.reserve, 0, 0.9, DEFAULT_AUTO.reserve), minWin: num(a.minWin, 0.3, 0.95, DEFAULT_AUTO.minWin) }
}

function writeOrders(orders: Order[]) {
  if (session) {
    sendPlan(orders)
    return
  }
  try {
    if (orders.length) localStorage.setItem(ORDERS_KEY, JSON.stringify(orders))
    else localStorage.removeItem(ORDERS_KEY)
  } catch {
    /* storage may be unavailable */
  }
}

/** A one-line description of the saved game, for the Continue button. */
export function peekSave(): { nation: string; date: string; live: boolean } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as GameState
    const nation = saved.nations?.[saved.playerId]?.name
    const live = saved.settings?.mode === 'live'
    return nation ? { nation, date: live ? dayDate(saved.turn, saved.day ?? 0) : turnDate(saved.turn), live } : null
  } catch {
    return null
  }
}

export interface SlotInfo {
  slot: number
  nation: string
  date: string
  live: boolean
  savedAt: number
}

/** What a save slot holds, or null when it is empty or damaged. */
export function peekSlot(slot: number): SlotInfo | null {
  try {
    const raw = localStorage.getItem(SLOT_KEY(slot))
    if (!raw) return null
    const saved = JSON.parse(raw) as { savedAt: number; game: GameState }
    const g = saved.game
    const nation = g?.nations?.[g.playerId]?.name
    if (!nation) return null
    const live = g.settings?.mode === 'live'
    return { slot, nation, live, date: live ? dayDate(g.turn, g.day ?? 0) : turnDate(g.turn), savedAt: saved.savedAt ?? 0 }
  } catch {
    return null
  }
}

function hasStoredSave(): boolean {
  try {
    return !!localStorage.getItem(SAVE_KEY)
  } catch {
    return false
  }
}

/** The live online session, if any. Online games are never saved to this device: the host holds the game. */
let session: OnlineSession | null = null

/** Writes the game to this device now. Returns false when storage refused it (full, or private browsing). */
function writeGame(game: GameState | null): boolean {
  try {
    // A finished game is not worth resuming, so it never stays as the save.
    if (game && game.outcome === 'playing') localStorage.setItem(SAVE_KEY, JSON.stringify(game))
    else {
      localStorage.removeItem(SAVE_KEY)
      localStorage.removeItem(ORDERS_KEY)
    }
    return true
  } catch {
    return false
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let queuedSave: { game: GameState | null } | null = null
/** Only one warning about a failed save until saving works again. */
let saveWarned = false

/** Writes a save that is waiting, at once. The page calls this when it is hidden or closed. */
export function flushSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const q = queuedSave
  queuedSave = null
  if (!q) return
  const ok = writeGame(q.game)
  const st = useGame.getState()
  if (ok) {
    saveWarned = false
    useGame.setState({ savedAt: Date.now(), saveFailed: false })
  } else {
    if (!saveWarned) st.toast('The game could not be saved on this device: storage is full or blocked. Export the save from Settings to keep it.', 'error', 9000)
    saveWarned = true
    useGame.setState({ saveFailed: true })
  }
}

/**
 * Saves the game. A save writes half a megabyte, so a burst of clicks is written once, a moment after the last one.
 * `now` writes at once: leaving a game, or a game that ended.
 */
function save(game: GameState | null, orders?: Order[], now = false) {
  if (session) return
  if (orders) writeOrders(orders)
  queuedSave = { game }
  if (now || !game || game.outcome !== 'playing') {
    flushSave()
    return
  }
  if (!saveTimer) saveTimer = setTimeout(flushSave, SAVE_DELAY_MS)
}

const SAVE_DELAY_MS = 400

function loadOrders(playerId: string): Order[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Order => keptOrder(item, playerId))
  } catch {
    return []
  }
}

export function keptOrder(item: unknown, playerId: string): item is Order {
  if (!item || typeof item !== 'object') return false
  const order = item as Order
  // An attack planned by auto-command waits in the tray for the month's end, so it is kept too: it survives a reload.
  const planned = order.type === 'attack' && order.auto === true && !!order.units && typeof order.target === 'string'
  if (typeof order.type !== 'string' || order.nationId !== playerId || !(MONTH_END_ORDERS.has(order.type) || planned)) return false
  if (planned) return true
  if (order.type === 'setPolicy') return Number.isFinite(order.taxRate) && Number.isFinite(order.draftRate) && (order.corporateTax === undefined || Number.isFinite(order.corporateTax))
  if (order.type === 'setPrograms') return !!order.programs && typeof order.programs === 'object' && (order.rate === undefined || Number.isFinite(order.rate))
  if (order.type === 'moveCapital') return typeof order.regionId === 'string'
  if (order.type === 'researchProgram') return ['productivity', 'medicine', 'weapons'].includes(order.track)
  if (order.type === 'resolution') return ['sanctions', 'ceasefire', 'recognition', 'accord'].includes(order.kind)
  if (order.type === 'propose') return typeof order.target === 'string' && !!order.proposal && typeof order.proposal.kind === 'string'
  if (order.type === 'respond') return typeof order.proposalId === 'string' && typeof order.accept === 'boolean'
  if (order.type === 'research') return typeof order.techId === 'string'
  if (order.type === 'cancelDeal') return typeof order.dealId === 'string'
  if (order.type === 'leaveAlliance' || order.type === 'breakPact') return typeof order.target === 'string'
  if (order.type === 'buildCase' || order.type === 'annexPuppet') return typeof order.target === 'string'
  if (order.type === 'governPuppet') return typeof order.target === 'string' && !!order.patch && typeof order.patch === 'object' && !Array.isArray(order.patch)
  if (order.type === 'releaseTerritory' || order.type === 'annexTerritory') return typeof order.target === 'string'
  if (order.type === 'forceTrade') return typeof order.territory === 'string' && typeof order.partner === 'string' && !!order.terms && typeof order.terms === 'object'
  if (order.type === 'strike') return typeof order.target === 'string' && (order.weapon === 'missile' || order.weapon === 'orbital') && (order.count === undefined || Number.isInteger(order.count)) && (order.aim === undefined || order.aim === 'country' || order.aim === 'site')
  if (order.type === 'raid') return typeof order.target === 'string' && (order.aim === undefined || order.aim === 'country' || order.aim === 'site') && (order.share === undefined || Number.isFinite(order.share))
  if (order.type === 'nuke') return typeof order.target === 'string'
  if (order.type === 'buyShares' || order.type === 'sellShares') return typeof order.company === 'string' && Number.isFinite(order.shares)
  if (order.type === 'setDirective') return typeof order.company === 'string' && ['payout', 'expand', 'focus'].includes(order.directive)
  if (order.type === 'operation') return typeof order.target === 'string' && typeof order.op === 'string'
  if (order.type === 'domestic') return typeof order.op === 'string'
  if (order.type === 'fundAgency') return order.agency === 'foreign' || order.agency === 'domestic'
  if (order.type === 'crisisAction') return typeof order.crisisId === 'string' && ['aid', 'mediate', 'support'].includes(order.action)
  if (order.type === 'eventChoice') return Number.isInteger(order.index)
  if (order.type === 'factionFound') return typeof order.name === 'string'
  if (order.type === 'factionJoin') return typeof order.factionId === 'string'
  if (order.type === 'factionInvite') return typeof order.target === 'string'
  if (order.type === 'factionRequest') return typeof order.factionId === 'string'
  if (order.type === 'factionLeave') return true
  if (order.type === 'factionContribute' || order.type === 'factionWithdraw') return !!order.gift && typeof order.gift === 'object'
  if (order.type === 'factionPropose') return !!order.proposal && (order.proposal.kind === 'war' ? typeof order.proposal.target === 'string' : order.proposal.kind === 'contract' && !!order.proposal.terms)
  if (order.type === 'factionVote') return typeof order.proposalId === 'string' && (order.vote === 'yes' || order.vote === 'no')
  return false
}

let toastId = 1

const DISPATCH_TONE: Record<Dispatch['kind'], Toast['tone']> = {
  proposal: 'info',
  accepted: 'success',
  joined: 'success',
  completed: 'success',
  rejected: 'error',
  ignored: 'error',
  broken: 'error',
  expired: 'error',
}

/** Rings and a shake on the globe where land changed hands. */
function flashCapture(regionId: RegionId, loss: boolean, color: string) {
  const region = getWorld().map.regions[regionId]
  if (!region) return
  useFx.getState().addRing({ lat: region.lat, lng: region.lng, color: loss ? '#ff453a' : color, maxRadius: 3.2 }, 1800)
  useFx.getState().shake(loss ? 1.15 : 0.7)
}

/** The monthly report: what changed for the player between how the month began and now, from the numbers and the log. */
function buildReport(a: MonthStats, after: GameState, player: NationId, battles: { text: string; good: boolean }[]): MonthReport {
  const b = statsOf(after, player)
  const month = after.turn - 1
  const mine = after.log.filter((e) => e.turn === month && e.nations.includes(player) && e.kind !== 'battle').map((e) => e.text)
  const world = after.log.filter((e) => e.turn === month && !e.nations.includes(player) && (e.kind === 'war' || e.kind === 'news')).map((e) => e.text)
  return {
    turn: month,
    deltas: [
      { label: 'Money', before: a.money, after: b.money },
      { label: 'Food', before: a.food, after: b.food },
      { label: 'Influence', before: a.influence, after: b.influence },
      { label: 'Research', before: a.research, after: b.research },
      { label: 'Oil', before: a.oil, after: b.oil },
      { label: 'Steel', before: a.steel, after: b.steel },
      { label: 'Goods', before: a.goods, after: b.goods },
      { label: 'Soldiers', before: a.soldiers, after: b.soldiers, suffix: 'k' },
      { label: 'Divisions', before: a.divisions, after: b.divisions, digits: 1 },
      { label: 'Stability', before: a.stability, after: b.stability, suffix: '%' },
    ],
    battles,
    lines: mine.slice(-10),
    world: world.slice(-4),
  }
}

// ---- live games ----

/** Why a live game's clock is held other than the player's own pause, or null when nothing holds it. */
export type Hold = 'online' | 'over' | 'event' | 'battle' | 'report' | 'planning' | 'help'

/**
 * The reason is the one the player sees, in the order the windows are drawn: the end of the game when no battle is playing, then
 * the jump-to box and a question being asked, then help, a battle, the report, a decision, and last the War Room.
 */
export function liveHold(st: Pick<GameStore, 'game' | 'fxQueue' | 'summary' | 'warRoom' | 'helpOpen' | 'online'> & Partial<Pick<GameStore, 'paletteOpen' | 'confirm' | 'aircraftOpen'>>): Hold | null {
  if (st.online) return 'online'
  if (!st.game) return 'over'
  const battle = st.fxQueue.length > 0
  if (st.game.outcome !== 'playing' && !battle) return 'over'
  if (st.paletteOpen || st.confirm || st.aircraftOpen) return 'planning'
  if (st.helpOpen) return 'help'
  if (battle) return 'battle'
  if (st.summary) return 'report'
  if (st.game.pendingEvent) return 'event'
  if (st.warRoom) return 'planning'
  return null
}

/** The month a live game is in as it began, with the player's battles in it so far. It lives in the game, so a save keeps it. */
function monthOf(game: GameState): MonthMark {
  return game.monthStart && game.monthStart.turn === game.turn ? game.monthStart : markMonth(game, game.playerId)
}

/** A live game with its month's starting point in place, so the report is right however the game was opened. */
function withMonth(game: GameState): GameState {
  if (isLive(game) && (!game.monthStart || game.monthStart.turn !== game.turn)) game.monthStart = markMonth(game, game.playerId)
  return game
}

const UNDO_LIMIT = 10
const botPlanner = (s: GameState, m: ReturnType<typeof getWorld>['map']) => generateAllBotOrders(s, m)

// ---- online play ----

/** The host's game as last received, with `playerId` set to this screen's nation. The screen's own `game` is this plus orders already applied. */
let base: GameState | null = null
/** Orders that took effect on the screen the moment they were given (builds, trades, training). They still go to the host with the plan. */
let immediate: Order[] = []

/** The whole plan for the month: what already happened on screen, then what waits for month end. */
function planOf(waiting: Order[]): Order[] {
  return [...immediate, ...waiting]
}

/** Sends the plan to the host. Changing a plan means the player is not done any more. */
function sendPlan(waiting: Order[], ready = false) {
  const st = useGame.getState()
  if (!session || !st.game || st.online?.status !== 'playing' || isLive(st.game)) return
  session.submitOrders(st.game.turn, planOf(waiting), ready)
  const me = session.me
  if (me && st.online.ready.includes(me) !== ready) useGame.setState({ online: { ...st.online, ready: ready ? [...st.online.ready, me] : st.online.ready.filter((x) => x !== me) } })
}

/** The fx and report for a month that just resolved, whether it was resolved here or by the host. */
function presentMonth(before: GameState, next: GameState, player: NationId) {
  const { settings, toast } = useGame.getState()
  // Attacks on you play first, then the rebel uprisings.
  const mine = next.battles
    .filter((b) => b.attacker.nationId === player || b.defender.nationId === player)
    .sort((a, b) => Number(b.defender.nationId === player && b.attacker.nationId !== 'rebels') - Number(a.defender.nationId === player && a.attacker.nationId !== 'rebels'))
  const fx = scenesFor(settings.battleScenes, player, mine)
  for (const b of mine) if (b.captured) flashCapture(b.regionId, b.defender.nationId === player, next.nations[player]?.color ?? '#fff')
  // A faction vote that needs you, an invitation, a contract that began or ended: said once, whether the report is on or not.
  for (const text of factionNews(before === next ? null : before, next, player).slice(0, 3)) toast(text, 'info', 7000)
  // The missile program's month: what opened, what is ready to test, how the tests went.
  for (const n of programNews(before === next ? null : before, next, player)) toast(n.text, n.tone, 6500)
  // With the report off, the turn's big moments still get a line.
  if (!settings.monthlyReport) {
    const mineNews = next.dispatches.filter((d) => d.to === player || d.from === player)
    for (const d of mineNews.slice(-3)) toast(d.text, DISPATCH_TONE[d.kind], 6000)
    if (!fx.length) for (const b of mine) if (b.captured) toast(battleLine(b, next, player).text, b.defender.nationId === player ? 'error' : 'success', 6000)
  }
  return { fxQueue: fx, fxTotal: fx.length, summary: settings.monthlyReport ? buildReport(statsOf(before, player), next, player, mine.map((b) => battleLine(b, next, player))) : null }
}

/** Keeps this room on this device, so if every player closes their tab one of them can open it again. */
function persistOnline() {
  const lobby = session?.lobby
  if (!lobby || !base) return
  void writeOnlineSave(lobby, base).catch(() => undefined)
}

/** The host resolved a month. Show it the way a single-player turn is shown. */
function receiveMonth(prev: GameState | null, next: GameState) {
  const st = useGame.getState()
  const player = next.playerId
  const wasOut = !!base && base.eliminated.includes(player)
  base = next
  immediate = []
  const shown = presentMonth(prev ?? next, next, player)
  // Offers other players sent this month wait in the inbox; say so, since nobody is looking at the Diplomacy desk.
  const offers = next.proposals.filter((p) => p.to === player).length - (prev?.proposals.filter((p) => p.to === player).length ?? 0)
  if (offers > 0) st.toast(offers === 1 ? 'You have a new offer waiting in Diplomacy.' : `You have ${offers} new offers waiting in Diplomacy.`, 'info', 6000)
  useGame.setState({ game: next, orders: [], undoStack: [], eventDismissedTurn: null, ...shown, warRoom: null, aircraftOpen: false })
  persistOnline()
  if (!wasOut && next.eliminated.includes(player) && next.outcome === 'playing') st.toast('Your nation has fallen. You can keep watching the game.', 'error', 9000)
}

// ---- live online ----

/** The speed this device had chosen before the room's clock took over the speed display. */
let ownSpeed: Settings['liveSpeed'] | null = null

/** Whether the screen is in a live game with friends. */
const liveOnline = (st: Pick<GameStore, 'game' | 'online'>) => !!session && st.online?.status === 'playing' && !!st.game && isLive(st.game)

/** What this player has told the host to do on the 1st, as the tray shows it. */
const waitingOf = (g: GameState): Order[] => g.liveOrders?.[g.playerId] ?? []

/** The shared game as this screen shows it: the month's report starting point is this screen's own. */
function withOwnMonth(next: GameState, shown: GameState | null): GameState {
  next.monthStart = shown?.monthStart && shown.monthStart.turn === next.turn ? shown.monthStart : markMonth(next, next.playerId)
  return next
}

/** The room's game arrived (the start, a seat taken, a reconnect, a new host): show it, and keep the player's place on screen if there is one. */
function liveStart(state: GameState) {
  const st = useGame.getState()
  const first = !st.game || !isLive(st.game)
  const game = withOwnMonth(state, st.game)
  if (first) {
    useGame.setState({ game, orders: waitingOf(game), running: false, undoStack: [], eventDismissedTurn: null, selectedRegion: game.playerId, selectedArmy: null, recentBattles: [], liveNote: null, panel: 'briefing', economyTab: 'country', economyRegion: null, militaryTab: 'forces', mapMode: 'political', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, aircraftOpen: false, helpOpen: false })
  } else useGame.setState({ game, orders: waitingOf(game) })
  if (useGame.getState().online?.status !== 'playing') useGame.setState((o) => (o.online ? { online: { ...o.online, status: 'playing', connecting: false, seats: null } } : {}))
  persistLive()
}

/** A day passed in the shared game. Shown the way a single-player day is, except that nothing here can stop the clock. */
function liveDay(prev: GameState, step: LiveStep) {
  const st = useGame.getState()
  const shown = st.game
  const player = step.state.playerId
  const lineOf = (b: BattleReport) => battleLine(b, step.state, player)
  const month = shown ? monthOf(shown) : markMonth(prev, player)
  // The battle window is the player's own: it plays over the game, and nothing on this screen can hold the shared clock. The month's report is always the quiet note.
  const presented = presentLiveStep({ step, player, before: prev, fxQueue: st.fxQueue, recentBattles: st.recentBattles, settings: st.settings, toast: st.toast })
  const patch: Partial<GameStore> = { recentBattles: presented.recentBattles, fxQueue: presented.fxQueue, fxTotal: presented.fxQueue.length, undoStack: [] }
  let game = step.state
  if (st.selectedArmy && !game.armies?.some((a) => a.id === st.selectedArmy)) patch.selectedArmy = null
  if (step.monthEnded) {
    const risings = game.battles.filter((b) => b.attacker.nationId === 'rebels' && b.defender.nationId === player).map(lineOf)
    patch.liveNote = buildReport(month.stats, game, player, [...month.battles, ...risings])
    game.monthStart = markMonth(game, player, presented.mine.filter((b) => b.attacker.nationId !== 'rebels').map(lineOf))
    for (const d of game.dispatches.filter((x) => x.to === player || x.from === player).slice(-3)) st.toast(d.text, DISPATCH_TONE[d.kind], 6500)
    for (const text of factionNews(prev, game, player).slice(0, 3)) st.toast(text, 'info', 7000)
    const failed = game.log.filter((e) => e.turn === prev.turn && e.text.startsWith('Order failed') && e.nations.includes(player))
    if (failed.length) st.toast(failed.length === 1 ? failed[0].text : `${failed.length} orders failed at the month's end. See the report.`, 'error', 7000)
    patch.orders = waitingOf(game)
    persistLive()
  } else {
    game.monthStart = presented.mine.length ? { ...month, battles: [...month.battles, ...presented.mine.map(lineOf)] } : month
    // Every ten days as well, so a tab closed without warning loses little.
    if (clockOf(game) % 10 === 0) persistLive()
  }
  patch.game = game
  useGame.setState(patch)
}

/** Someone's order went into the game. Say what it was, if it matters to this player. */
function liveOrder(e: OrderEvent) {
  const st = useGame.getState()
  const { map } = getWorld()
  const game = withOwnMonth(e.state, st.game)
  useGame.setState({ game, orders: waitingOf(game) })
  if (e.own) {
    if (e.order.type === 'attack') {
      const a = game.armies?.filter((x) => x.nationId === game.playerId).at(-1)
      if (a) st.toast(`An army left for ${map.regions[a.target]?.name ?? a.target}. It arrives ${absDate(a.end)}.`, 'info', 5000)
    } else if (e.queued) st.toast(`${describeOrder(st.game ?? game, map, e.order)}: waiting for the 1st.`, 'success', 3000)
    return
  }
  // What a friend does, once, in a line. Only the acts that change the war are worth interrupting for.
  const loud = new Set<Order['type']>(['attack', 'strike', 'nuke', 'declareWar', 'raid', 'recall'])
  if (!loud.has(e.order.type)) return
  const who = e.state.nations[e.nation]?.name ?? e.nation
  try {
    st.toast(`${who}: ${describeOrder(st.game ?? game, map, e.order)}`, 'info', 4500)
  } catch {
    st.toast(`${who} gave an order.`, 'info', 3000)
  }
}

/** The clock changed: the screen's own Play button and the armies' glide follow it. */
function liveClockChanged(clock: ClockView) {
  const st = useGame.getState()
  if (ownSpeed === null) ownSpeed = st.settings.liveSpeed
  // The speed is the room's, not this device's choice: it is shown without being remembered.
  useGame.setState({ running: clock.running, settings: { ...st.settings, liveSpeed: clock.speed }, ...(st.online ? { online: { ...st.online, clock } } : {}) })
  if (!clock.running) persistLive()
}

/** A live game is saved from the shared game, as a turn game is. A day is too often: every ten days, the start of a month, a pause and a hidden tab are the moments. */
function persistLive() {
  const lobby = session?.lobby
  const game = session?.game
  if (!lobby || !game) return
  void writeOnlineSave(lobby, game).catch(() => undefined)
}

function leaveSession() {
  const s = session
  session = null
  base = null
  immediate = []
  if (ownSpeed !== null) {
    useGame.setState((st) => ({ settings: { ...st.settings, liveSpeed: ownSpeed! }, running: false }))
    ownSpeed = null
  }
  s?.leave()
}

/** The day's fraction on the shared clock, for the globe to glide armies between days. */
export const onlineDayFraction = () => session?.dayFraction() ?? 0

if (typeof document !== 'undefined') {
  // A hidden host tab runs its timers slowly; its friends are told, and the game is saved while the page can still do it.
  document.addEventListener('visibilitychange', () => {
    session?.setHidden(document.hidden)
    if (document.hidden) persistLive()
  })
}

const ROOM_ERRORS = {
  notSetUp: 'Online play is not set up on this server yet. See the README to add a Supabase project.',
  noRoom: 'No game answered to that code. Check the code, and that your friend has the lobby open.',
}

/** Opens the connection and wires the session to the store. */
async function connect(name: string, code: string, role: 'create' | 'join' | 'resume', settings?: RoomSettings, rejoin = false, resume?: { lobby: Lobby; game: GameState; seat: NationId }) {
  leaveSession()
  const stored = loadIdentity()
  const id = { clientId: rejoin && stored.code === code && stored.clientId ? stored.clientId : tabClientId() }
  const clean = name.trim().slice(0, 20) || 'Player'
  useGame.setState({ online: { status: 'lobby', code, clientId: id.clientId, name: clean, kind: 'browser', host: role !== 'join', lobby: null, ready: [], deadline: null, peers: [], chat: [], unread: 0, error: null, connecting: true, connection: 'connected', seats: null, clock: null, live: null } })
  let transport
  try {
    transport = await openTransport(code, id.clientId)
  } catch (e) {
    useGame.setState({ online: null })
    useGame.getState().toast(e instanceof Error ? e.message : ROOM_ERRORS.notSetUp, 'error', 9000)
    return
  }
  const patch = (p: Partial<OnlineView>) => useGame.setState((st) => (st.online ? { online: { ...st.online, ...p } } : {}))
  const s = new OnlineSession({
    transport,
    clientId: id.clientId,
    name: clean,
    map: getWorld().map,
    events: {
      onLobby: (lobby) => patch({ lobby, host: lobby.host === id.clientId, status: lobby.phase === 'playing' ? 'playing' : 'lobby', connecting: false, error: null }),
      onHost: (host) => patch({ host }),
      onStart: (state) => {
        if (isLive(state)) return liveStart(state)
        // The host sends the current game again to anyone who joins late. This month's plan is not lost to that.
        if (base && base.turn === state.turn) return
        base = state
        immediate = []
        useGame.setState({ game: state, orders: [], undoStack: [], eventDismissedTurn: null, selectedRegion: state.playerId, panel: 'briefing', economyTab: 'country', economyRegion: null, militaryTab: 'forces', mapMode: 'political', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, aircraftOpen: false, helpOpen: false })
        patch({ status: 'playing', connecting: false, seats: null })
        persistOnline()
      },
      onConnection: (connection) => patch({ connection }),
      onSeats: (seats) => patch({ seats, connecting: false }),
      onKicked: () => {
        leaveSession()
        useGame.setState({ online: null, game: null, orders: [], undoStack: [], selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, aircraftOpen: false, hasSave: hasStoredSave() })
        useGame.getState().toast('The host removed you from the game.', 'error', 9000)
      },
      onRematch: () => {
        base = null
        immediate = []
        useGame.setState({ game: null, orders: [], running: false, liveNote: null, selectedArmy: null, undoStack: [], eventDismissedTurn: null, selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, aircraftOpen: false })
        patch({ status: 'lobby', ready: [], deadline: null, clock: null })
      },
      onState: receiveMonth,
      onDay: liveDay,
      onOrder: liveOrder,
      onClock: liveClockChanged,
      onLive: (live) => patch({ live }),
      onAck: (_cid, ok, reason) => {
        if (!ok) useGame.getState().toast(reason ?? 'The host could not do that.', 'error', 6000)
      },
      onClockRequest: (who, req) => {
        const text = req.kind === 'pause' ? 'to pause' : req.kind === 'resume' ? 'to start the clock' : `for ${req.speed}× speed`
        useGame.getState().toast(`${who} asks ${text}.`, 'info', 6000)
      },
      onReady: (ready, remaining) => patch({ ready, deadline: remaining === null ? null : Date.now() + remaining }),
      onPeers: (peers) => patch({ peers }),
      onChat: (msg) => {
        useGame.setState((st) => (st.online ? { online: { ...st.online, chat: [...st.online.chat.slice(-60), msg], unread: msg.from === id.clientId ? st.online.unread : st.online.unread + 1 } } : {}))
        // Nobody is looking at a chat window while the clock runs, so a friend's words come up as a note.
        const st = useGame.getState()
        if (msg.from !== id.clientId && st.game && isLive(st.game)) st.toast(`${msg.name}: ${msg.text}`, 'info', 5000)
      },
      onResubmit: () => {
        const st = useGame.getState()
        sendPlan(st.orders, !!(s.me && st.online?.ready.includes(s.me)))
      },
      onError: (text) => useGame.getState().toast(text, 'error', 7000),
    },
  })
  session = s
  saveIdentity({ clientId: id.clientId, name: clean, code })
  patch({ kind: transport.kind })
  useGame.setState({ lastRoom: code })
  if (role === 'create' && settings) s.createRoom(code, settings)
  else if (role === 'resume' && resume) {
    const err = s.resumeRoom(resume.lobby, resume.game, resume.seat)
    if (err) {
      leaveSession()
      useGame.setState({ online: null })
      useGame.getState().toast(err, 'error', 7000)
    }
  } else {
    s.joinRoom()
    // The host answers with the lobby, or with the free seats of a game under way. No answer means no such room.
    setTimeout(() => {
      const st = useGame.getState()
      if (session === s && st.online && !st.online.lobby && !st.online.seats) {
        leaveSession()
        useGame.setState({ online: null })
        st.toast(ROOM_ERRORS.noRoom, 'error', 9000)
      }
    }, 6000)
  }
}

/** Makes a loaded game the one being played: slots and imports go through here. Waiting orders must be ones that wait for the month's end. */
function enterGame(game: GameState, orders: Order[] | undefined): boolean {
  if (session || useGame.getState().online) return false
  withMonth(game)
  const kept = (orders ?? []).filter((o): o is Order => keptOrder(o, game.playerId))
  save(game, kept, true)
  useGame.setState({ running: false, undoStack: [], confirm: null, selectedArmy: null, recentBattles: [], liveNote: null, game, orders: kept, selectedRegion: game.playerId, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, aircraftOpen: false, hasSave: true })
  useGame.getState().toast('Game loaded.', 'success', 2500)
  return true
}

export const useGame = create<GameStore>((set, get) => ({
  game: null,
  orders: [],
  selectedRegion: null,
  panel: 'none',
  economyTab: 'country',
  peopleSection: 'overview',
  economyRegion: null,
  militaryTab: 'forces',
  empireTab: 'overview',
  agencyTarget: null,
  mapMode: 'political',
  diploFocus: null,
  factionFocus: null,
  relFocus: null,
  diploPeace: false,
  fxQueue: [],
  fxTotal: 0,
  summary: null,
  helpOpen: false,
  warRoom: null,
  aircraftOpen: false,
  settings: loadSettings(),
  autoCommand: loadAutoCommand(),
  toasts: [],
  hasSave: hasStoredSave(),
  running: false,
  selectedArmy: null,
  recentBattles: [],
  liveNote: null,
  savedAt: null,
  saveFailed: false,
  confirm: null,
  paletteOpen: false,
  deskTabs: {},
  helpTab: 'guide',
  settingsFocus: null,
  undoStack: [],
  online: null,
  eventDismissedTurn: null,
  lastRoom: loadIdentity().code,

  newGame(opts) {
    const { map } = getWorld()
    const game = withMonth(createInitialState(map, opts))
    save(game, [], true)
    set({
      running: false,
      undoStack: [],
      confirm: null,
      selectedArmy: null,
      recentBattles: [],
      liveNote: null,
      game,
      orders: [],
      selectedRegion: game.playerId,
      // A new game opens on the Briefing: the first steps and what the advisor would do.
      panel: 'briefing',
      economyTab: 'country',
      economyRegion: null,
      militaryTab: 'forces',
      mapMode: 'political',
      fxQueue: [],
      fxTotal: 0,
      summary: null,
      warRoom: null,
      aircraftOpen: false,
      hasSave: true,
      helpOpen: false,
    })
  },

  loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return
      const game = withMonth(normalizeGame(JSON.parse(raw) as GameState, getWorld().map))
      set({ running: false, undoStack: [], selectedArmy: null, recentBattles: [], liveNote: null, game, orders: loadOrders(game.playerId), selectedRegion: game.playerId, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, aircraftOpen: false })
    } catch {
      get().toast('Save file is corrupted.', 'error')
    }
  },

  quitToMenu() {
    if (session || get().online) {
      get().leaveOnline()
      return
    }
    const { game, orders } = get()
    if (game) save(game, orders, true)
    set({ running: false, selectedArmy: null, liveNote: null, game: null, orders: [], selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, aircraftOpen: false, hasSave: hasStoredSave() })
  },

  abandonGame() {
    if (session || get().online) {
      get().leaveOnline()
      return
    }
    save(null)
    set({ running: false, selectedArmy: null, liveNote: null, game: null, orders: [], selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, aircraftOpen: false, hasSave: false })
  },

  setPalette(open) {
    set({ paletteOpen: open })
  },

  saveSlot(slot) {
    const { game, orders } = get()
    if (!game || session) return false
    try {
      localStorage.setItem(SLOT_KEY(slot), JSON.stringify({ savedAt: Date.now(), game, orders }))
      get().toast(`Saved to slot ${slot}.`, 'success', 2500)
      return true
    } catch {
      get().toast('Could not save: storage is full or blocked. Export the save instead.', 'error')
      return false
    }
  },

  loadSlot(slot) {
    try {
      const raw = localStorage.getItem(SLOT_KEY(slot))
      if (!raw) return false
      const saved = JSON.parse(raw) as { game: GameState; orders?: Order[] }
      return enterGame(normalizeGame(saved.game, getWorld().map), saved.orders)
    } catch {
      get().toast('That save is damaged and could not be opened.', 'error')
      return false
    }
  },

  exportSave() {
    const { game, orders } = get()
    if (!game || session) return null
    return JSON.stringify({ app: 'worlds-of-others', version: 1, exportedAt: Date.now(), game, orders })
  },

  importSave(text) {
    try {
      const data = JSON.parse(text) as { app?: string; game?: GameState; orders?: Order[] } & Partial<GameState>
      // A file made by Export holds the game under `game`; a bare game is accepted too.
      const raw = data.game ?? (data.nations ? (data as GameState) : null)
      if (!raw) throw new Error('not a save')
      return enterGame(normalizeGame(raw, getWorld().map), data.game ? data.orders : [])
    } catch {
      get().toast('That file is not a save of this game.', 'error')
      return false
    }
  },

  askConfirm(c) {
    set({ confirm: c })
  },

  closeConfirm() {
    set({ confirm: null })
  },

  undo() {
    // Online, an order is already on its way to the host, and the others are playing the same month: nothing can be taken back.
    if (session) return
    const { undoStack, game } = get()
    const last = undoStack[undoStack.length - 1]
    if (!last || !game) return
    set({ game: last.game, undoStack: undoStack.slice(0, -1) })
    save(last.game)
    get().toast(`Undone: ${last.label}`, 'info', 2500)
  },

  selectRegion(id) {
    set(id ? { selectedRegion: id, selectedArmy: null } : { selectedRegion: id })
  },

  setPanel(panel) {
    set((st) => ({ panel: st.panel === panel ? 'none' : panel, diploFocus: null }))
  },

  setEconomyTab(tab) {
    set({ economyTab: tab })
  },

  setPeopleSection(section) {
    set({ peopleSection: section })
  },

  setEconomyRegion(id) {
    set({ economyRegion: id })
  },

  openEconomy(tab, region) {
    set((st) => ({ panel: 'economy', economyTab: tab, economyRegion: region ?? st.economyRegion, diploFocus: null }))
  },

  setAgencyTarget(id) {
    set({ agencyTarget: id })
  },

  openAgencies(target) {
    set({ panel: 'military', militaryTab: 'agencies', agencyTarget: target ?? get().agencyTarget, diploFocus: null })
  },

  setMilitaryTab(tab) {
    set({ militaryTab: tab })
  },

  setEmpireTab(tab) {
    set({ empireTab: tab })
  },

  openEmpire(tab) {
    set((st) => ({ panel: 'empire', empireTab: tab ?? st.empireTab, diploFocus: null }))
  },

  openMilitary(tab) {
    set({ panel: 'military', militaryTab: tab, diploFocus: null })
  },

  setMapMode(mode) {
    set({ mapMode: mode })
  },

  goTo(target) {
    set({ summary: null })
    switch (target.desk) {
      case 'economy':
        get().openEconomy(target.tab, target.region)
        if (target.section) set({ peopleSection: target.section })
        break
      case 'military':
        get().openMilitary(target.tab)
        break
      case 'research':
        set({ panel: 'tech', diploFocus: null })
        break
      case 'empire':
        get().openEmpire(target.tab)
        break
      case 'diplomacy':
        get().openDiplomacy(target.nation ?? null)
        break
      case 'faction':
        get().openFaction(target.nation)
        break
      case 'warRoom':
        set({ selectedRegion: target.region, warRoom: target.region })
        break
      case 'map': {
        // Close the desk so the country's own card shows, and turn the globe to it.
        set({ selectedRegion: target.region, panel: 'none' })
        const r = getWorld().map.regions[target.region]
        if (r) globeBridge.api?.pointOfView({ lat: r.lat, lng: r.lng, altitude: 1.6 }, get().settings.reducedMotion ? 0 : 700)
        break
      }
    }
  },

  openDiplomacy(nationId, opts) {
    set({ panel: 'diplomacy', diploFocus: nationId, diploPeace: !!opts?.peace })
  },

  openRelations(nation) {
    set({ panel: 'relations', diploFocus: null, relFocus: nation ?? null })
  },

  locateNation(id) {
    const st = get()
    const game = st.game
    const n = game?.nations[id]
    if (!game || !n) return
    const { map } = getWorld()
    const regionId = game.regions[n.capital]?.owner === id ? n.capital : Object.values(game.regions).find((r) => r.owner === id)?.id
    const r = regionId ? map.regions[regionId] : undefined
    if (!regionId || !r) return
    const back = st.panel !== 'none' ? { panel: st.panel, tab: st.deskTabs[st.panel], nation: id } : null
    set({ selectedRegion: regionId, selectedArmy: null, panel: 'none', diploFocus: null })
    globeBridge.api?.pointOfView({ lat: r.lat, lng: r.lng, altitude: 1.5 }, st.settings.reducedMotion ? 0 : 900)
    // A pulse ring that opens three times, so the eye finds the country.
    const fx = useFx.getState()
    for (let i = 0; i < 3; i++) setTimeout(() => useFx.getState().addRing({ lat: r.lat, lng: r.lng, color: n.color || '#64d2ff', maxRadius: 9 }, 2200), (st.settings.reducedMotion ? 0 : 900) + i * 650)
    void fx
    get().toast(`${n.name} on the map.`, 'info', 6000, back ? { label: 'Back to desk', run: () => (back.panel === 'relations' ? get().openRelations(back.nation) : get().openTab(back.panel, back.tab)) } : undefined)
  },

  openFaction(nation) {
    set({ panel: 'faction', diploFocus: null, factionFocus: nation ?? null })
  },

  issueOrder(order) {
    const { game, orders, online } = get()
    if (!game) return false
    const { map } = getWorld()
    const playing = !!session && online?.status === 'playing'
    if (playing && game.eliminated.includes(game.playerId)) {
      get().toast('Your nation has fallen. You are watching now.', 'error')
      return false
    }
    // A live game with friends: the host takes every order, whatever it is, and answers.
    if (playing && isLive(game)) {
      const sent = session!.sendCommand(order)
      if (sent.error) {
        get().toast(sent.error, 'error')
        return false
      }
      if (!online.host) get().toast('Sent to the host…', 'info', 1200)
      return true
    }
    // Online, an attack waits for the month to end like every other country's, so nobody wins by clicking fast.
    if (!isMonthEndOrder(game, order.type, order) && !(playing && innerType(order) === 'attack')) {
      const next = structuredClone(game)
      const seen = game.dispatches.length
      const result = applyOrderNow(next, map, order, orders)
      if (result.error) {
        get().toast(result.error, 'error')
        return false
      }
      // An order that cannot be taken back also cuts off everything done before it: undoing an earlier step would carry it away too.
      const takeBack = !playing && undoable(game, order)
      set({ game: next, undoStack: takeBack ? [...get().undoStack, { game, label: describeOrder(game, map, order) }].slice(-UNDO_LIMIT) : [] })
      if (!playing && !takeBack) get().toast(`${describeOrder(game, map, order)}: done. This cannot be taken back.`, 'info', 5000)
      // An offer a rival answered on the spot (live games) says how it went.
      for (const d of next.dispatches.slice(seen)) if (d.to === game.playerId || d.from === game.playerId) get().toast(d.text, DISPATCH_TONE[d.kind], 6000)
      if (playing) {
        immediate = [...immediate, order]
        sendPlan(orders)
      } else save(next)
      return true
    }
    let rest = orders
    if (order.type === 'respond') rest = orders.filter((o) => !(o.type === 'respond' && o.proposalId === order.proposalId))
    // A player can change their mind about a decision until the month ends.
    else if (order.type === 'eventChoice') rest = orders.filter((o) => o.type !== 'eventChoice')
    // The rules of a puppet can be changed until the month ends: the last order for it counts.
    else if (order.type === 'governPuppet') rest = orders.filter((o) => !(o.type === 'governPuppet' && o.target === order.target))
    // A vote can be changed until the month ends: the last one counts.
    else if (order.type === 'factionVote') rest = orders.filter((o) => !(o.type === 'factionVote' && o.proposalId === order.proposalId))
    const err = validateOrder(game, map, order, rest)
    if (err) {
      get().toast(err, 'error')
      return false
    }
    const next = [...rest, order]
    set({ orders: next })
    writeOrders(next)
    return true
  },

  issueBatch(batch) {
    const { game, orders, online } = get()
    if (!game || batch.length === 0) return { done: 0, failed: 0 }
    const { map } = getWorld()
    const playing = !!session && online?.status === 'playing'
    let done = 0
    let failed = 0
    let firstError = ''
    if (playing || batch.some((o) => isMonthEndOrder(game, o.type, o))) {
      // Online, or with orders that wait for the month end, each goes through the usual single path.
      for (const o of batch) {
        if (get().issueOrder(o)) done++
        else failed++
      }
      return { done, failed }
    }
    const next = structuredClone(game)
    for (const o of batch) {
      const result = applyOrderNow(next, map, o, orders)
      if (result.error) {
        failed++
        firstError ||= result.error
      } else done++
    }
    set({ game: next, undoStack: batch.some((o) => !undoable(game, o)) ? [] : done > 0 ? [...get().undoStack, { game, label: `${done} orders` }].slice(-UNDO_LIMIT) : get().undoStack })
    save(next)
    if (failed > 0) get().toast(`${done} done, ${failed} could not be made: ${firstError}`, 'error')
    return { done, failed }
  },

  removeOrder(index) {
    if (liveOnline(get())) {
      get().toast('That order is already with the host. A later order of the same kind replaces it.', 'info', 4500)
      return
    }
    const next = get().orders.filter((_, i) => i !== index)
    set({ orders: next })
    writeOrders(next)
  },

  setPolicy(patch) {
    const { game, orders } = get()
    if (!game) return
    const rest = orders.filter((o) => o.type !== 'setPolicy')
    const n = game.nations[game.playerId]
    const queued = orders.find((o) => o.type === 'setPolicy')
    const was = queued && queued.type === 'setPolicy' ? queued : null
    const taxRate = patch.taxRate ?? was?.taxRate ?? n.taxRate
    const draftRate = patch.draftRate ?? was?.draftRate ?? n.draftRate
    const corporateTax = patch.corporateTax ?? was?.corporateTax ?? n.corporateTax
    const spending: Spending = { ...n.spending, ...(was?.spending ?? {}), ...(patch.spending ?? {}) }
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-6
    const unchanged = same(n.taxRate, taxRate) && same(n.draftRate, draftRate) && same(n.corporateTax, corporateTax) && (Object.keys(spending) as (keyof Spending)[]).every((k) => spending[k] === n.spending[k])
    const next: Order[] = unchanged ? rest : [...rest, { type: 'setPolicy', nationId: game.playerId, taxRate, draftRate, corporateTax, spending }]
    if (liveOnline(get())) {
      if (!unchanged) get().issueOrder(next[next.length - 1])
      return
    }
    set({ orders: next })
    writeOrders(next)
  },

  setPrograms(programs, rate) {
    const { game, orders } = get()
    if (!game) return
    // One waiting order holds every change; choosing the current value again drops that change.
    const was = orders.find((o) => o.type === 'setPrograms')
    const merged: Partial<Programs> = { ...(was?.type === 'setPrograms' ? was.programs : {}), ...programs }
    const n = game.nations[game.playerId]
    for (const k of Object.keys(merged) as (keyof Programs)[]) if (merged[k] === n.programs[k]) delete merged[k]
    let r = rate ?? (was?.type === 'setPrograms' ? was.rate : undefined)
    if (r !== undefined && Math.abs(r - n.bank.rate) < 1e-9) r = undefined
    const rest = orders.filter((o) => o.type !== 'setPrograms')
    const order: Order = { type: 'setPrograms', nationId: game.playerId, programs: merged, ...(r !== undefined ? { rate: r } : {}) }
    if (liveOnline(get())) {
      if (Object.keys(merged).length > 0 || r !== undefined) get().issueOrder(order)
      return
    }
    if (Object.keys(merged).length === 0 && r === undefined) {
      set({ orders: rest })
      writeOrders(rest)
      return
    }
    const err = validateOrder(game, getWorld().map, order, rest)
    if (err) {
      get().toast(err, 'error')
      return
    }
    const next = [...rest, order]
    set({ orders: next })
    writeOrders(next)
  },

  /** Your military attacks a country now. The battle window plays it round by round. */
  openWarRoom(target) {
    set({ warRoom: target })
  },

  setAircraftOpen(open) {
    set({ aircraftOpen: open })
  },

  attack(target, commit = 'main', stance = 'assault', missiles, share, units) {
    const { game, settings, online } = get()
    if (!game) return false
    const { map } = getWorld()
    if (session && online?.status === 'playing' && isLive(game)) {
      const ok = get().issueOrder({ type: 'attack', nationId: game.playerId, target, commit, stance, missiles, ...(share !== undefined ? { share } : {}), ...(units ? { units } : {}) })
      if (ok) set({ warRoom: null, aircraftOpen: false })
      return ok
    }
    if (session && online?.status === 'playing') {
      const queued = get().orders.filter((o) => o.type === 'attack').length
      if (queued >= maxAttacks(game, game.playerId)) {
        get().toast(`Your military can plan ${maxAttacks(game, game.playerId)} attacks a month`, 'error')
        return false
      }
      const ok = get().issueOrder({ type: 'attack', nationId: game.playerId, target, commit, stance, missiles, ...(share !== undefined ? { share } : {}), ...(units ? { units } : {}) })
      if (ok) {
        set({ warRoom: null, aircraftOpen: false })
        get().toast(`Attack on ${map.regions[target].name} planned. It plays out when the month ends.`, 'info', 4500)
      }
      return ok
    }
    const next = structuredClone(game)
    const result = applyOrderNow(next, map, { type: 'attack', nationId: game.playerId, target, commit, stance, missiles, ...(share !== undefined ? { share } : {}), ...(units ? { units } : {}) }, get().orders)
    // In a live game the army sets out and fights when it arrives.
    if (result.army) {
      const a = result.army
      set({ warRoom: null, aircraftOpen: false, game: next })
      save(next)
      get().toast(`An army left for ${map.regions[target].name}. It arrives ${absDate(a.end)}.`, 'info', 5000)
      return true
    }
    if (result.error || !result.battle) {
      get().toast(result.error ?? 'The attack could not be made', 'error')
      return false
    }
    set({ warRoom: null, aircraftOpen: false })
    const queue = settings.battleScenes === 'off' ? [] : [result.battle]
    if (result.battle.captured) flashCapture(target, false, next.nations[game.playerId].color)
    if (result.battle.intercept) get().toast(`Their patrols met your landing at sea and sank ${result.battle.intercept.sunk.toFixed(1)} divisions of it.`, 'error', 5000)
    set({ game: next, fxQueue: [...get().fxQueue, ...queue], fxTotal: get().fxQueue.length + queue.length })
    if (!queue.length) {
      const name = map.regions[target].name
      const b = result.battle
      get().toast(b.captured ? `${name} captured` : b.winner === 'attacker' ? `The defense of ${name} was pushed back` : `The attack on ${name} was repulsed`, b.winner === 'attacker' ? 'success' : 'error', 5000)
    }
    save(next)
    return true
  },

  setAutoCommand(patch) {
    const { game, autoCommand } = get()
    const next = sanitizeAuto({ ...autoCommand, ...patch })
    if (game && next.on && (commandLevel(game, game.playerId) < 3 || isLive(game) || (session && get().online?.status === 'playing'))) {
      get().toast(isLive(game) ? 'Auto-command plans a month at a time: it is for turn games' : commandLevel(game, game.playerId) < 3 ? 'Auto-command needs AI Battle Command level 3' : 'Auto-command is not available in an online game', 'error')
      next.on = false
    }
    set({ autoCommand: next })
    try {
      localStorage.setItem(AUTO_KEY, JSON.stringify(next))
    } catch {
      /* the limits are only a convenience; the game works without saving them */
    }
    if (!game) return
    if (!next.on) {
      // Off: the attacks it planned are taken out; anything the player queued by hand stays.
      const kept = get().orders.filter((o) => !(o.type === 'attack' && o.auto))
      if (kept.length !== get().orders.length) {
        set({ orders: kept })
        writeOrders(kept)
      }
    } else {
      const n = get().planAutoCommand()
      get().toast(n > 0 ? `Auto-command queued ${n} attack${n === 1 ? '' : 's'}. They are in the tray: click one to cancel it.` : 'Auto-command found no attack that meets your limits this month', 'info', 5000)
    }
  },

  planAutoCommand() {
    const { game, orders, autoCommand } = get()
    if (!game || isLive(game) || game.outcome !== 'playing' || commandLevel(game, game.playerId) < 3) return 0
    const { map } = getWorld()
    const kept = orders.filter((o) => !(o.type === 'attack' && o.auto))
    const plans = planMonth(game, map, game.playerId, autoCommand, kept, false)
    const next = [...kept, ...plans.map((p) => ({ ...p.order, auto: true as const }))]
    set({ orders: next })
    writeOrders(next)
    return plans.length
  },

  endTurn() {
    const { game, orders, fxQueue, online } = get()
    if (!game || isLive(game) || game.pendingEvent || game.outcome !== 'playing' || fxQueue.length > 0) return
    // Online, the month ends when everyone is ready, so this only says this player is done.
    if (session && online?.status === 'playing') {
      get().setReady(true)
      return
    }
    const { map } = getWorld()
    const botOrders = generateAllBotOrders(game, map)
    const next = resolveTurn(game, map, [...orders, ...botOrders])
    const shown = presentMonth(game, next, game.playerId)
    save(next, [])
    set({ game: next, orders: [], undoStack: [], ...shown })
    // A standing auto-command plans the new month at once, so its attacks are in the tray to look over (and take out) before the month ends.
    if (get().autoCommand.on) get().planAutoCommand()
  },

  play() {
    const { game } = get()
    if (!game || !isLive(game) || game.outcome !== 'playing') return
    if (session) return session.controlClock({ kind: 'resume' })
    set({ running: true })
  },

  pause() {
    if (!get().running) return
    if (session) return session.controlClock({ kind: 'pause' })
    set({ running: false })
    get().persist()
  },

  togglePause() {
    if (get().running) get().pause()
    else get().play()
  },

  setSpeed(speed) {
    if (session && get().game && isLive(get().game!)) return session.controlClock({ kind: 'speed', speed })
    // Choosing a speed does not start a paused clock.
    get().updateSettings({ liveSpeed: speed })
  },

  stepDay() {
    const st = get()
    const { game, orders } = st
    if (!game || !isLive(game) || session || liveHold(st)) return
    const { map } = getWorld()
    const step = advanceDay(game, map, { monthOrders: orders, planner: botPlanner })
    if (step.state === game) return
    const shown = presentLiveStep({ step, player: game.playerId, before: game, fxQueue: st.fxQueue, recentBattles: st.recentBattles, settings: st.settings, toast: st.toast })
    // A day that moved the world on cannot be taken back.
    const player = game.playerId
    const lineOf = (b: BattleReport) => battleLine(b, step.state, player)
    const month = monthOf(game)
    const patch: Partial<GameStore> = { game: step.state, recentBattles: shown.recentBattles, fxQueue: shown.fxQueue, fxTotal: shown.fxQueue.length, undoStack: [] }
    // An army that has gone home or been lost no longer has a card.
    if (st.selectedArmy && !step.state.armies?.some((a) => a.id === st.selectedArmy)) patch.selectedArmy = null
    if (step.monthEnded) {
      // Uprisings are fought as the month turns over and belong to the month that ended. Battles on the 1st belong to the new one.
      const risings = step.state.battles.filter((b) => b.attacker.nationId === 'rebels' && b.defender.nationId === player).map(lineOf)
      const report = buildReport(month.stats, step.state, player, [...month.battles, ...risings])
      // The new month's starting point goes into the game, so a save made on any day of it keeps the month's report right.
      patch.game = { ...step.state, monthStart: markMonth(step.state, player, shown.mine.filter((b) => b.attacker.nationId !== 'rebels').map(lineOf)) }
      patch.orders = []
      if (st.settings.liveReport === 'pause') patch.summary = report
      else patch.liveNote = report
      // The month's diplomacy still gets a line while the clock runs: wars declared on you, offers, answers.
      const news = step.state.dispatches.filter((d) => d.to === game.playerId || d.from === game.playerId)
      for (const d of news.slice(-3)) st.toast(d.text, DISPATCH_TONE[d.kind], 6500)
      for (const text of factionNews(game, step.state, game.playerId).slice(0, 3)) st.toast(text, 'info', 7000)
      const failed = step.state.log.filter((e) => e.turn === game.turn && e.text.startsWith('Order failed') && e.nations.includes(game.playerId))
      if (failed.length) st.toast(failed.length === 1 ? failed[0].text : `${failed.length} orders failed at the month's end. See the report.`, 'error', 7000)
      save(patch.game!, [])
    } else if (shown.mine.length) patch.game = { ...step.state, monthStart: { ...month, battles: [...month.battles, ...shown.mine.map(lineOf)] } }
    set(patch)
  },

  selectArmy(id) {
    set({ selectedArmy: id })
  },

  recallArmy(id) {
    const { game } = get()
    if (!game) return false
    const ok = get().issueOrder({ type: 'recall', nationId: game.playerId, armyId: id })
    if (ok) get().toast('The army is coming home.', 'info', 3000)
    return ok
  },

  openBattle(id) {
    const b = get().recentBattles.find((x) => x.id === id)
    if (b) set({ fxQueue: [{ ...b, replay: true }], fxTotal: 1 })
  },

  openNote() {
    const note = get().liveNote
    if (note) set({ summary: note, liveNote: null })
  },

  async createOnline(name, settings) {
    await connect(name, newRoomCode(), 'create', settings)
  },

  async joinOnline(name, raw, rejoin = false) {
    const code = normalizeCode(raw)
    if (!validCode(code)) {
      get().toast('A room code is five letters and numbers, like K7Q2M', 'error')
      return
    }
    await connect(name, code, 'join', undefined, rejoin)
  },

  pickOnlineNation(nationId) {
    session?.pickNation(nationId)
  },

  updateOnlineSettings(settings) {
    session?.updateSettings(settings)
  },

  async startOnline() {
    if (!session) {
      get().toast('Not connected to the room', 'error')
      return
    }
    const err = await session.startGame()
    if (err) get().toast(err, 'error')
  },

  async resumeOnline(name, raw, seat) {
    const code = normalizeCode(raw)
    const saved = await loadOnlineSave(code)
    if (!saved) {
      get().toast('That saved game could not be opened. It may have been cleared from this device.', 'error', 7000)
      return
    }
    await connect(name, code, 'resume', undefined, false, { ...saved, seat })
  },

  takeOnlineSeat(nationId) {
    session?.takeSeat(nationId)
  },

  kickOnlinePlayer(clientId) {
    session?.kick(clientId)
  },

  rematchOnline() {
    session?.rematch()
  },

  dismissEvent(turn) {
    set({ eventDismissedTurn: turn })
  },

  reopenEvent() {
    const orders = get().orders.filter((o) => o.type !== 'eventChoice')
    set({ orders, eventDismissedTurn: null })
    writeOrders(orders)
  },

  leaveOnline() {
    leaveSession()
    set({ online: null, undoStack: [], eventDismissedTurn: null, game: null, orders: [], selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, aircraftOpen: false, hasSave: hasStoredSave() })
  },

  sendChat(text) {
    const clean = text.trim()
    if (clean) session?.chat(clean)
  },

  markChatRead() {
    set((st) => (st.online && st.online.unread ? { online: { ...st.online, unread: 0 } } : {}))
  },

  setReady(ready) {
    const { game, orders, online } = get()
    if (!session || !game || online?.status !== 'playing' || game.outcome !== 'playing') return
    if (ready && game.eliminated.includes(game.playerId)) return
    sendPlan(orders, ready)
  },

  chooseEventOption(index) {
    const { game } = get()
    if (!game) return
    // Online, the answer travels with this player's plan, and nobody else waits for it.
    if (game.multiplayer) {
      if (session && get().issueOrder({ type: 'eventChoice', nationId: game.playerId, index })) get().toast('Your decision goes in with your plan.', 'success', 3000)
      return
    }
    const next = applyEventChoice(game, getWorld().map, index)
    save(next)
    set({ game: next })
  },

  shiftFx() {
    set((st) => ({ fxQueue: st.fxQueue.slice(1) }))
  },

  clearFx() {
    set({ fxQueue: [], fxTotal: 0 })
  },

  dismissSummary() {
    set({ summary: null })
  },

  openTab(desk, tab) {
    if (desk === 'economy') get().openEconomy((tab ?? get().economyTab) as EconomyTab)
    else if (desk === 'military') get().openMilitary((tab ?? get().militaryTab) as MilitaryTab)
    else if (desk === 'empire') get().openEmpire(tab as EmpireTab | undefined)
    else if (desk === 'diplomacy') get().openDiplomacy(null)
    else set((st) => ({ panel: desk, deskTabs: tab ? { ...st.deskTabs, [desk]: tab } : st.deskTabs, diploFocus: null }))
  },

  setDeskTab(desk, tab) {
    if (desk === 'economy') get().setEconomyTab(tab as EconomyTab)
    else if (desk === 'military') get().setMilitaryTab(tab as MilitaryTab)
    else if (desk === 'empire') get().setEmpireTab(tab as EmpireTab)
    else set((st) => ({ deskTabs: { ...st.deskTabs, [desk]: tab } }))
  },

  setHelpTab(tab) {
    set({ helpTab: tab })
  },

  updatePrefs(patch) {
    const ui = sanitizePrefs({ ...get().settings.ui, ...patch })
    // The old "reduce motion" switch stays what the rest of the game reads; the preference decides it.
    const reducedMotion = motionReduced(ui.motion, systemReducesMotion())
    get().updateSettings({ ui, reducedMotion })
    applyPrefs(ui)
  },

  resetPrefs() {
    const keep = get().settings.ui
    const fresh = { ...defaultPrefs(), pinned: keep.pinned, recents: keep.recents }
    get().updatePrefs(fresh)
    get().toast('Look and feel put back to the defaults', 'success', 2500)
  },

  setHelp(open) {
    set({ helpOpen: open })
    if (!open && !get().settings.seenHelp) get().updateSettings({ seenHelp: true })
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* storage may be unavailable */
    }
    set({ settings })
  },

  toast(text, tone = 'info', ms = 3500, action) {
    const id = toastId++
    const shown = tone === 'error' ? speak(text) : text
    const life = tone === 'error' ? Math.max(ms, 8000) : action ? Math.max(ms, 6000) : ms
    set((st) => ({ toasts: [...st.toasts.slice(-3), { id, text: shown, tone, action }] }))
    setTimeout(() => get().dismissToast(id), life)
  },

  dismissToast(id) {
    set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }))
  },

  persist() {
    const { game, orders } = get()
    save(game, orders, true)
  },
}))

// Every game the screen shows is finished and never changed again, so the economy can be worked out once for it.
useGame.subscribe((st) => {
  if (st.game) markSettled(st.game)
})

// Text size, contrast, density and the rest are on the page before the first screen is drawn.
applyPrefs(useGame.getState().settings.ui)

// A handle for browser tests, in development only.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __store: typeof useGame }).__store = useGame
  // Dev only, for browser checks: the online session (its true game is on the host).
  ;(window as unknown as { __session: () => unknown }).__session = () => session
}
