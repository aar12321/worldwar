import { create } from 'zustand'
import { generateAllBotOrders } from './ai/bot'
import { createInitialState, type NewGameOptions } from './data/startingNations'
import { applyEventChoice } from './engine/events'
import { turnDate } from './engine/helpers'
import { normalizeGame } from './engine/migrate'
import { MONTH_END_ORDERS, validateOrder } from './engine/orders'
import { applyOrderNow, resolveTurn } from './engine/resolveTurn'
import type { BattleReport, Dispatch, GameState, NationId, Order, RegionId } from './engine/types'
import { getWorld } from './map/world'
import { useFx } from './ui/globeBridge'
import { speak } from './ui/plain'

const SAVE_KEY = 'worlds-of-others-save-v3'
const ORDERS_KEY = 'worlds-of-others-orders-v3'
const SETTINGS_KEY = 'worlds-of-others-settings-v2'
/** Everything a crashed game may have left behind. */
export const SAVE_KEYS = [SAVE_KEY, ORDERS_KEY]

export type Panel = 'none' | 'country' | 'military' | 'tech' | 'diplomacy' | 'log' | 'settings'
export type CountryTab = 'build' | 'economy' | 'laws'

export interface Settings {
  reducedMotion: boolean
  fxSpeed: 1 | 2
  /** Which battles play the round-by-round window: every battle you are in, only your attacks, or none. */
  battleScenes: 'all' | 'mine' | 'off'
  /** Whether the How to play window has been shown. */
  seenHelp: boolean
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error' | 'success'
}

/** What happened while the turn resolved, shown once the battles have played. */
export interface TurnSummary {
  turn: number
  lines: string[]
}

interface GameStore {
  game: GameState | null
  /** Orders that wait for Next Turn. */
  orders: Order[]
  selectedRegion: RegionId | null
  panel: Panel
  countryTab: CountryTab
  diploFocus: NationId | null
  /** Battles waiting to play in the battle window. The first one is showing. */
  fxQueue: BattleReport[]
  /** How many battles this batch started with, for "Battle 2 of 4". */
  fxTotal: number
  summary: TurnSummary | null
  helpOpen: boolean
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
  setCountryTab(tab: CountryTab): void
  openCountry(tab: CountryTab): void
  openDiplomacy(nationId: NationId | null): void
  issueOrder(order: Order): boolean
  removeOrder(index: number): void
  setPolicy(taxRate: number, draftRate: number): void
  attack(target: RegionId): boolean
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

function save(game: GameState | null, orders?: Order[]) {
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
  if (order.type === 'setPolicy') return Number.isFinite(order.taxRate) && Number.isFinite(order.draftRate)
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

/** Lines for the turn summary: what happened to the player this turn, from the log. */
function summaryLines(game: GameState, player: NationId): string[] {
  return game.log.filter((e) => e.turn === game.turn - 1 && e.nations.includes(player) && e.kind !== 'battle').map((e) => e.text)
}

export const useGame = create<GameStore>((set, get) => ({
  game: null,
  orders: [],
  selectedRegion: null,
  panel: 'none',
  countryTab: 'build',
  diploFocus: null,
  fxQueue: [],
  fxTotal: 0,
  summary: null,
  helpOpen: false,
  settings: loadSettings(),
  toasts: [],
  hasSave: hasStoredSave(),

  newGame(opts) {
    const { map } = getWorld()
    const game = createInitialState(map, opts)
    save(game, [])
    set({
      game,
      orders: [],
      selectedRegion: game.playerId,
      panel: 'none',
      fxQueue: [],
      fxTotal: 0,
      summary: null,
      hasSave: true,
      helpOpen: !get().settings.seenHelp,
    })
  },

  loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return
      const game = normalizeGame(JSON.parse(raw) as GameState, getWorld().map)
      set({ game, orders: loadOrders(game.playerId), selectedRegion: game.playerId, panel: 'none', fxQueue: [], fxTotal: 0, summary: null })
    } catch {
      get().toast('Save file is corrupted.', 'error')
    }
  },

  quitToMenu() {
    const { game, orders } = get()
    if (game) save(game, orders)
    set({ game: null, orders: [], selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, hasSave: hasStoredSave() })
  },

  abandonGame() {
    save(null)
    set({ game: null, orders: [], selectedRegion: null, panel: 'none', fxQueue: [], fxTotal: 0, summary: null, hasSave: false })
  },

  selectRegion(id) {
    set({ selectedRegion: id })
  },

  setPanel(panel) {
    set((st) => ({ panel: st.panel === panel ? 'none' : panel, diploFocus: null }))
  },

  setCountryTab(tab) {
    set({ countryTab: tab })
  },

  openCountry(tab) {
    set({ panel: 'country', countryTab: tab, diploFocus: null })
  },

  openDiplomacy(nationId) {
    set({ panel: 'diplomacy', diploFocus: nationId })
  },

  issueOrder(order) {
    const { game, orders } = get()
    if (!game) return false
    const { map } = getWorld()
    if (!MONTH_END_ORDERS.has(order.type)) {
      const next = structuredClone(game)
      const result = applyOrderNow(next, map, order)
      if (result.error) {
        get().toast(result.error, 'error')
        return false
      }
      set({ game: next })
      save(next)
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

  setPolicy(taxRate, draftRate) {
    const { game, orders } = get()
    if (!game) return
    const rest = orders.filter((o) => o.type !== 'setPolicy')
    const n = game.nations[game.playerId]
    const unchanged = Math.abs(n.taxRate - taxRate) < 1e-6 && Math.abs(n.draftRate - draftRate) < 1e-6
    const next: Order[] = unchanged ? rest : [...rest, { type: 'setPolicy', nationId: game.playerId, taxRate, draftRate }]
    set({ orders: next })
    writeOrders(next)
  },

  /** Your military attacks a country now. The battle window plays it round by round. */
  attack(target) {
    const { game, settings } = get()
    if (!game) return false
    const { map } = getWorld()
    const next = structuredClone(game)
    const result = applyOrderNow(next, map, { type: 'attack', nationId: game.playerId, target })
    if (result.error || !result.battle) {
      get().toast(result.error ?? 'The attack could not be made', 'error')
      return false
    }
    const queue = settings.battleScenes === 'off' ? [] : [result.battle]
    if (result.battle.captured) flashCapture(target, false, next.nations[game.playerId].color)
    set({ game: next, fxQueue: [...get().fxQueue, ...queue], fxTotal: get().fxQueue.length + queue.length })
    if (!queue.length) {
      const name = map.regions[target].name
      get().toast(result.battle.captured ? `${name} captured` : `The attack on ${name} was repulsed`, result.battle.captured ? 'success' : 'error', 5000)
    }
    save(next)
    return true
  },

  endTurn() {
    const { game, orders, settings, fxQueue } = get()
    if (!game || game.pendingEvent || game.outcome !== 'playing' || fxQueue.length > 0) return
    const { map } = getWorld()
    const botOrders = generateAllBotOrders(game, map)
    const next = resolveTurn(game, map, [...orders, ...botOrders])
    const player = game.playerId
    // Attacks on you play first, then the rebel uprisings.
    const mine = next.battles
      .filter((b) => b.attacker.nationId === player || b.defender.nationId === player)
      .sort((a, b) => Number(b.defender.nationId === player && b.attacker.nationId !== 'rebels') - Number(a.defender.nationId === player && a.attacker.nationId !== 'rebels'))
    const fx = scenesFor(settings, player, mine)
    for (const b of mine) if (b.captured) flashCapture(b.regionId, b.defender.nationId === player, next.nations[player]?.color ?? '#fff')
    save(next, [])
    const lines = summaryLines(next, player)
    set({
      game: next,
      orders: [],
      fxQueue: fx,
      fxTotal: fx.length,
      summary: lines.length ? { turn: next.turn - 1, lines } : null,
    })
    const mineNews = next.dispatches.filter((d) => d.to === player || d.from === player)
    for (const d of mineNews.slice(-4)) get().toast(d.text, DISPATCH_TONE[d.kind], 6000)
    if (!fx.length) {
      for (const b of mine) {
        const name = map.regions[b.regionId]?.name ?? 'the front'
        if (b.captured) get().toast(b.defender.nationId === player ? `${name} was taken from you` : `${name} captured`, b.defender.nationId === player ? 'error' : 'success', 6000)
      }
    }
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
