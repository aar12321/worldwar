import { create } from 'zustand'
import { generateAllBotOrders } from './ai/bot'
import { createInitialState, type NewGameOptions } from './data/startingNations'
import type { AdviceTarget } from './engine/advisor'
import { applyEventChoice } from './engine/events'
import { totalUnits, turnDate } from './engine/helpers'
import { normalizeGame } from './engine/migrate'
import { MONTH_END_ORDERS, validateOrder } from './engine/orders'
import { WAR, type Commit, type Stance } from './data/war'
import { applyOrderNow, resolveTurn } from './engine/resolveTurn'
import { BUDGET_KEYS } from './data/government'
import type { BattleReport, Budget, Dispatch, GameState, NationId, Order, RegionId } from './engine/types'
import { getWorld } from './map/world'
import { newClientId, newRoomCode, normalizeCode, validCode, type ChatMessage, type ClientId, type Lobby, type RoomSettings } from './net/protocol'
import { OnlineSession } from './net/session'
import { openTransport } from './net/transport'
import { globeBridge, useFx } from './ui/globeBridge'
import { speak } from './ui/plain'

const SAVE_KEY = 'worlds-of-others-save-v3'
const ORDERS_KEY = 'worlds-of-others-orders-v3'
const SETTINGS_KEY = 'worlds-of-others-settings-v2'
/** Everything a crashed game may have left behind. */
export const SAVE_KEYS = [SAVE_KEY, ORDERS_KEY]

/** The five desks, plus News and Settings which open from the top bar. */
export type Panel = 'none' | 'briefing' | 'economy' | 'military' | 'tech' | 'diplomacy' | 'log' | 'settings'
export type EconomyTab = 'country' | 'budget' | 'market' | 'business' | 'government' | 'people'
export type MilitaryTab = 'forces' | 'wars'
/** What the globe's colors mean. */
export type MapMode = 'political' | 'relations' | 'fronts'

export interface PolicyPatch {
  taxRate?: number
  draftRate?: number
  corporateTax?: number
  budget?: Budget
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
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error' | 'success'
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

interface GameStore {
  online: OnlineView | null
  /** The last room this device was in, so it can be rejoined. */
  lastRoom: string | null
  createOnline(name: string, settings: RoomSettings): Promise<void>
  joinOnline(name: string, code: string, rejoin?: boolean): Promise<void>
  pickOnlineNation(nationId: NationId | null): void
  updateOnlineSettings(settings: RoomSettings): void
  startOnline(): Promise<void>
  leaveOnline(): void
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
  /** Country shown in the Economy desk's upgrade list. Null means the capital. */
  economyRegion: RegionId | null
  militaryTab: MilitaryTab
  mapMode: MapMode
  diploFocus: NationId | null
  /** Battles waiting to play in the battle window. The first one is showing. */
  fxQueue: BattleReport[]
  /** How many battles this batch started with, for "Battle 2 of 4". */
  fxTotal: number
  summary: MonthReport | null
  helpOpen: boolean
  /** Country whose War Room is open, if any. */
  warRoom: RegionId | null
  settings: Settings
  toasts: Toast[]
  hasSave: boolean

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
  openDiplomacy(nationId: NationId | null): void
  issueOrder(order: Order): boolean
  removeOrder(index: number): void
  /** Queues new tax, draft, business tax or budget settings for the end of the month. */
  setPolicy(patch: PolicyPatch): void
  attack(target: RegionId, commit?: Commit, stance?: Stance): boolean
  openWarRoom(target: RegionId | null): void
  endTurn(): void
  chooseEventOption(index: number): void
  shiftFx(): void
  clearFx(): void
  dismissSummary(): void
  setHelp(open: boolean): void
  updateSettings(patch: Partial<Settings>): void
  toast(text: string, tone?: Toast['tone'], ms?: number): void
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
}

/** Keeps a stored setting only if it has a value the game understands. */
function sanitizeSettings(raw: Partial<Settings>): Settings {
  const merged = { ...defaultSettings, ...raw }
  const oneOf = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
  return {
    reducedMotion: typeof merged.reducedMotion === 'boolean' ? merged.reducedMotion : defaultSettings.reducedMotion,
    fxSpeed: oneOf(merged.fxSpeed, [1, 2], 1),
    battleScenes: oneOf(merged.battleScenes, ['all', 'mine', 'off'], 'all'),
    seenHelp: merged.seenHelp === true,
    monthlyReport: merged.monthlyReport !== false,
    showGuide: merged.showGuide !== false,
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
export function peekSave(): { nation: string; date: string } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as GameState
    const nation = saved.nations?.[saved.playerId]?.name
    return nation ? { nation, date: turnDate(saved.turn) } : null
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

function save(game: GameState | null, orders?: Order[]) {
  if (session) return
  try {
    // A finished game is not worth resuming, so it never stays as the save.
    if (game && game.outcome === 'playing') localStorage.setItem(SAVE_KEY, JSON.stringify(game))
    else {
      localStorage.removeItem(SAVE_KEY)
      localStorage.removeItem(ORDERS_KEY)
    }
  } catch {
    /* storage may be unavailable */
  }
  if (orders) writeOrders(orders)
}

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

function keptOrder(item: unknown, playerId: string): item is Order {
  if (!item || typeof item !== 'object') return false
  const order = item as Order
  if (typeof order.type !== 'string' || order.nationId !== playerId || !MONTH_END_ORDERS.has(order.type)) return false
  if (order.type === 'setPolicy') return Number.isFinite(order.taxRate) && Number.isFinite(order.draftRate) && (order.corporateTax === undefined || Number.isFinite(order.corporateTax))
  if (order.type === 'propose') return typeof order.target === 'string' && !!order.proposal && typeof order.proposal.kind === 'string'
  if (order.type === 'respond') return typeof order.proposalId === 'string' && typeof order.accept === 'boolean'
  if (order.type === 'research') return typeof order.techId === 'string'
  if (order.type === 'spy') return typeof order.target === 'string' && order.mission === 'sabotage'
  if (order.type === 'cancelDeal') return typeof order.dealId === 'string'
  if (order.type === 'leaveAlliance') return typeof order.target === 'string'
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

/** Which of these battles play in the window, by the player's setting. */
function scenesFor(settings: Settings, player: NationId, battles: BattleReport[]): BattleReport[] {
  if (settings.battleScenes === 'off') return []
  return battles.filter((b) => b.attacker.nationId === player || (settings.battleScenes === 'all' && b.defender.nationId === player))
}

const sumUnits = (game: GameState, id: NationId) => {
  const u = game.nations[id]?.military.units
  return u ? totalUnits(u) : 0
}

/** One line for a battle the player was in, and whether it went their way. */
function battleLine(b: BattleReport, game: GameState, player: NationId): { text: string; good: boolean } {
  const place = getWorld().map.regions[b.regionId]?.name ?? 'the front'
  const line = b.lineBefore !== undefined && b.lineAfter !== undefined ? ` (Defense Line ${b.lineBefore.toFixed(1)} → ${b.lineAfter.toFixed(1)})` : ''
  const won = b.winner === 'attacker'
  if (b.attacker.nationId === 'rebels') return won && b.captured ? { text: `Rebels took ${place}. It has broken away.`, good: false } : { text: `Your garrison beat back rebels in ${place}.`, good: true }
  if (b.attacker.nationId === player) {
    if (b.captured) return { text: `You captured ${place}.`, good: true }
    return won ? { text: `You pushed back the defense of ${place}${line}.`, good: true } : { text: `Your attack on ${place} was repulsed.`, good: false }
  }
  const who = game.nations[b.attacker.nationId]?.name ?? 'An enemy'
  if (b.captured) return { text: `${who} captured ${place} from you.`, good: false }
  return won ? { text: `${who} pushed back your defense of ${place}${line}.`, good: false } : { text: `${who} attacked ${place} and was repulsed.`, good: true }
}

/** The monthly report: what changed for the player between two states, from the numbers and the log. */
function buildReport(before: GameState, after: GameState, player: NationId, battles: BattleReport[]): MonthReport {
  const a = before.nations[player]
  const b = after.nations[player]
  const month = after.turn - 1
  const mine = after.log.filter((e) => e.turn === month && e.nations.includes(player) && e.kind !== 'battle').map((e) => e.text)
  const world = after.log.filter((e) => e.turn === month && !e.nations.includes(player) && e.kind === 'war').map((e) => e.text)
  return {
    turn: month,
    deltas: [
      { label: 'Money', before: a.resources.capital, after: b.resources.capital },
      { label: 'Food', before: a.resources.food, after: b.resources.food },
      { label: 'Influence', before: a.resources.pp, after: b.resources.pp },
      { label: 'Research', before: a.resources.tp, after: b.resources.tp },
      { label: 'Oil', before: a.resources.oil, after: b.resources.oil },
      { label: 'Steel', before: a.resources.steel, after: b.resources.steel },
      { label: 'Goods', before: a.resources.goods, after: b.resources.goods },
      { label: 'Soldiers', before: a.militaryPool, after: b.militaryPool, suffix: 'k' },
      { label: 'Divisions', before: sumUnits(before, player), after: sumUnits(after, player), digits: 1 },
      { label: 'Stability', before: a.stability, after: b.stability, suffix: '%' },
    ],
    battles: battles.map((x) => battleLine(x, after, player)),
    lines: mine.slice(-10),
    world: world.slice(-4),
  }
}

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
  if (!session || !st.game || st.online?.status !== 'playing') return
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
  const fx = scenesFor(settings, player, mine)
  for (const b of mine) if (b.captured) flashCapture(b.regionId, b.defender.nationId === player, next.nations[player]?.color ?? '#fff')
  // With the report off, the turn's big moments still get a line.
  if (!settings.monthlyReport) {
    const mineNews = next.dispatches.filter((d) => d.to === player || d.from === player)
    for (const d of mineNews.slice(-3)) toast(d.text, DISPATCH_TONE[d.kind], 6000)
    if (!fx.length) for (const b of mine) if (b.captured) toast(battleLine(b, next, player).text, b.defender.nationId === player ? 'error' : 'success', 6000)
  }
  return { fxQueue: fx, fxTotal: fx.length, summary: settings.monthlyReport ? buildReport(before, next, player, mine) : null }
}

/** The host resolved a month. Show it the way a single-player turn is shown. */
function receiveMonth(prev: GameState | null, next: GameState) {
  const st = useGame.getState()
  const player = next.playerId
  const wasOut = !!base && base.eliminated.includes(player)
  base = next
  immediate = []
  const shown = presentMonth(prev ?? next, next, player)
  useGame.setState({ game: next, orders: [], ...shown, warRoom: null })
  if (!wasOut && next.eliminated.includes(player) && next.outcome === 'playing') st.toast('Your nation has fallen. You can keep watching the game.', 'error', 9000)
}

function leaveSession() {
  const s = session
  session = null
  base = null
  immediate = []
  s?.leave()
}

const ROOM_ERRORS = {
  notSetUp: 'Online play is not set up on this server yet. See the README to add a Supabase project.',
  noRoom: 'No game answered to that code. Check the code, and that your friend has the lobby open.',
}

/** Opens the connection and wires the session to the store. */
async function connect(name: string, code: string, role: 'create' | 'join', settings?: RoomSettings, rejoin = false) {
  leaveSession()
  const stored = loadIdentity()
  const id = { clientId: rejoin && stored.code === code && stored.clientId ? stored.clientId : tabClientId() }
  const clean = name.trim().slice(0, 20) || 'Player'
  useGame.setState({ online: { status: 'lobby', code, clientId: id.clientId, name: clean, kind: 'browser', host: role === 'create', lobby: null, ready: [], deadline: null, peers: [], chat: [], unread: 0, error: null, connecting: true } })
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
        // The host sends the current game again to anyone who joins late. This month's plan is not lost to that.
        if (base && base.turn === state.turn) return
        base = state
        immediate = []
        useGame.setState({ game: state, orders: [], selectedRegion: state.playerId, panel: 'briefing', economyTab: 'country', economyRegion: null, militaryTab: 'forces', mapMode: 'political', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, helpOpen: false })
        patch({ status: 'playing', connecting: false })
      },
      onState: receiveMonth,
      onReady: (ready, remaining) => patch({ ready, deadline: remaining === null ? null : Date.now() + remaining }),
      onPeers: (peers) => patch({ peers }),
      onChat: (msg) => useGame.setState((st) => (st.online ? { online: { ...st.online, chat: [...st.online.chat.slice(-60), msg], unread: msg.from === id.clientId ? st.online.unread : st.online.unread + 1 } } : {})),
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
  else {
    s.joinRoom()
    // The host answers with the lobby. No answer means no such room.
    setTimeout(() => {
      const st = useGame.getState()
      if (session === s && st.online && !st.online.lobby) {
        leaveSession()
        useGame.setState({ online: null })
        st.toast(ROOM_ERRORS.noRoom, 'error', 9000)
      }
    }, 6000)
  }
}

export const useGame = create<GameStore>((set, get) => ({
  game: null,
  orders: [],
  selectedRegion: null,
  panel: 'none',
  economyTab: 'country',
  economyRegion: null,
  militaryTab: 'forces',
  mapMode: 'political',
  diploFocus: null,
  fxQueue: [],
  fxTotal: 0,
  summary: null,
  helpOpen: false,
  warRoom: null,
  settings: loadSettings(),
  toasts: [],
  hasSave: hasStoredSave(),
  online: null,
  lastRoom: loadIdentity().code,

  newGame(opts) {
    const { map } = getWorld()
    const game = createInitialState(map, opts)
    save(game, [])
    set({
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
      hasSave: true,
      helpOpen: false,
    })
  },

  loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return
      const game = normalizeGame(JSON.parse(raw) as GameState, getWorld().map)
      set({ game, orders: loadOrders(game.playerId), selectedRegion: game.playerId, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null })
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
    if (game) save(game, orders)
    set({ game: null, orders: [], selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, hasSave: hasStoredSave() })
  },

  abandonGame() {
    if (session || get().online) {
      get().leaveOnline()
      return
    }
    save(null)
    set({ game: null, orders: [], selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, hasSave: false })
  },

  selectRegion(id) {
    set({ selectedRegion: id })
  },

  setPanel(panel) {
    set((st) => ({ panel: st.panel === panel ? 'none' : panel, diploFocus: null }))
  },

  setEconomyTab(tab) {
    set({ economyTab: tab })
  },

  setEconomyRegion(id) {
    set({ economyRegion: id })
  },

  openEconomy(tab, region) {
    set((st) => ({ panel: 'economy', economyTab: tab, economyRegion: region ?? st.economyRegion, diploFocus: null }))
  },

  setMilitaryTab(tab) {
    set({ militaryTab: tab })
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
        break
      case 'military':
        get().openMilitary(target.tab)
        break
      case 'research':
        set({ panel: 'tech', diploFocus: null })
        break
      case 'diplomacy':
        get().openDiplomacy(target.nation ?? null)
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

  openDiplomacy(nationId) {
    set({ panel: 'diplomacy', diploFocus: nationId })
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
    // Online, an attack waits for the month to end like every other country's, so nobody wins by clicking fast.
    if (!MONTH_END_ORDERS.has(order.type) && !(playing && order.type === 'attack')) {
      const next = structuredClone(game)
      const result = applyOrderNow(next, map, order, orders)
      if (result.error) {
        get().toast(result.error, 'error')
        return false
      }
      set({ game: next })
      if (playing) {
        immediate = [...immediate, order]
        sendPlan(orders)
      } else save(next)
      return true
    }
    let rest = orders
    if (order.type === 'respond') rest = orders.filter((o) => !(o.type === 'respond' && o.proposalId === order.proposalId))
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

  removeOrder(index) {
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
    const budget = patch.budget ?? was?.budget ?? n.budget
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-6
    const unchanged = same(n.taxRate, taxRate) && same(n.draftRate, draftRate) && same(n.corporateTax, corporateTax) && BUDGET_KEYS.every((k) => same(n.budget[k], budget[k]))
    const next: Order[] = unchanged ? rest : [...rest, { type: 'setPolicy', nationId: game.playerId, taxRate, draftRate, corporateTax, budget }]
    set({ orders: next })
    writeOrders(next)
  },

  /** Your military attacks a country now. The battle window plays it round by round. */
  openWarRoom(target) {
    set({ warRoom: target })
  },

  attack(target, commit = 'main', stance = 'assault') {
    const { game, settings, online } = get()
    if (!game) return false
    const { map } = getWorld()
    if (session && online?.status === 'playing') {
      const queued = get().orders.filter((o) => o.type === 'attack').length
      if (queued >= WAR.maxAttacksPerTurn) {
        get().toast(`Your military can plan ${WAR.maxAttacksPerTurn} attacks a month`, 'error')
        return false
      }
      const ok = get().issueOrder({ type: 'attack', nationId: game.playerId, target, commit, stance })
      if (ok) {
        set({ warRoom: null })
        get().toast(`Attack on ${map.regions[target].name} planned. It plays out when the month ends.`, 'info', 4500)
      }
      return ok
    }
    const next = structuredClone(game)
    const result = applyOrderNow(next, map, { type: 'attack', nationId: game.playerId, target, commit, stance }, get().orders)
    if (result.error || !result.battle) {
      get().toast(result.error ?? 'The attack could not be made', 'error')
      return false
    }
    set({ warRoom: null })
    const queue = settings.battleScenes === 'off' ? [] : [result.battle]
    if (result.battle.captured) flashCapture(target, false, next.nations[game.playerId].color)
    set({ game: next, fxQueue: [...get().fxQueue, ...queue], fxTotal: get().fxQueue.length + queue.length })
    if (!queue.length) {
      const name = map.regions[target].name
      const b = result.battle
      get().toast(b.captured ? `${name} captured` : b.winner === 'attacker' ? `The defense of ${name} was pushed back` : `The attack on ${name} was repulsed`, b.winner === 'attacker' ? 'success' : 'error', 5000)
    }
    save(next)
    return true
  },

  endTurn() {
    const { game, orders, fxQueue, online } = get()
    if (!game || game.pendingEvent || game.outcome !== 'playing' || fxQueue.length > 0) return
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
    set({ game: next, orders: [], ...shown })
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

  leaveOnline() {
    leaveSession()
    set({ online: null, game: null, orders: [], selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, warRoom: null, hasSave: hasStoredSave() })
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

  toast(text, tone = 'info', ms = 3500) {
    const id = toastId++
    const shown = tone === 'error' ? speak(text) : text
    const life = tone === 'error' ? Math.max(ms, 8000) : ms
    set((st) => ({ toasts: [...st.toasts.slice(-3), { id, text: shown, tone }] }))
    setTimeout(() => get().dismissToast(id), life)
  },

  dismissToast(id) {
    set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }))
  },

  persist() {
    const { game, orders } = get()
    save(game, orders)
  },
}))
