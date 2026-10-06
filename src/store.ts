import { create } from 'zustand'
import { generateAllBotOrders } from './ai/bot'
import { createInitialState, type NewGameOptions } from './data/startingNations'
import { applyEventChoice } from './engine/events'
import { validateOrder } from './engine/orders'
import { resolveTurn } from './engine/resolveTurn'
import type { BattleReport, Dispatch, GameState, NationId, Order, RegionId } from './engine/types'
import { getWorld } from './map/world'

const SAVE_KEY = 'worlds-of-others-save-v2'
const SETTINGS_KEY = 'worlds-of-others-settings-v1'

export type Panel = 'none' | 'nation' | 'tech' | 'diplomacy' | 'log' | 'settings'

export interface March {
  armyId: string
  owner: string
  from: RegionId
  to: RegionId
}

export interface Settings {
  reducedMotion: boolean
  turnTimer: number
  fxSpeed: 1 | 2
  battleFx: boolean
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error' | 'success'
}

interface GameStore {
  game: GameState | null
  orders: Order[]
  selectedRegion: RegionId | null
  selectedArmy: string | null
  targetMode: 'move' | 'attack' | null
  panel: Panel
  diploFocus: NationId | null
  fxQueue: BattleReport[]
  marches: March[]
  marchStamp: number
  settings: Settings
  toasts: Toast[]
  hasSave: boolean

  newGame(opts: NewGameOptions): void
  loadGame(): void
  quitToMenu(): void
  selectRegion(id: RegionId | null): void
  selectArmy(id: string | null): void
  setTargetMode(mode: 'move' | 'attack' | null): void
  setPanel(panel: Panel): void
  openDiplomacy(nationId: NationId | null): void
  issueOrder(order: Order): boolean
  removeOrder(index: number): void
  setPolicy(taxRate: number, draftRate: number): void
  clickRegion(id: RegionId): void
  endTurn(): void
  chooseEventOption(index: number): void
  shiftFx(): void
  clearFx(): void
  updateSettings(patch: Partial<Settings>): void
  toast(text: string, tone?: Toast['tone'], ms?: number): void
  dismissToast(id: number): void
}

const defaultSettings: Settings = {
  reducedMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  turnTimer: 0,
  fxSpeed: 1,
  battleFx: true,
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

function save(game: GameState | null) {
  try {
    if (game) localStorage.setItem(SAVE_KEY, JSON.stringify(game))
    else localStorage.removeItem(SAVE_KEY)
  } catch {
    /* storage may be unavailable */
  }
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

export const useGame = create<GameStore>((set, get) => ({
  game: null,
  orders: [],
  selectedRegion: null,
  selectedArmy: null,
  targetMode: null,
  panel: 'none',
  diploFocus: null,
  fxQueue: [],
  marches: [],
  marchStamp: 0,
  settings: loadSettings(),
  toasts: [],
  hasSave: typeof localStorage !== 'undefined' && !!localStorage.getItem(SAVE_KEY),

  newGame(opts) {
    const { map } = getWorld()
    const game = createInitialState(map, opts)
    save(game)
    set({ game, orders: [], selectedRegion: game.playerId, selectedArmy: null, targetMode: null, panel: 'none', fxQueue: [], marches: [], hasSave: true })
  },

  loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return
      const game = JSON.parse(raw) as GameState
      set({ game, orders: [], selectedRegion: game.playerId, selectedArmy: null, targetMode: null, panel: 'none', fxQueue: [], marches: [] })
    } catch {
      get().toast('Save file is corrupted.', 'error')
    }
  },

  quitToMenu() {
    set({ game: null, orders: [], selectedRegion: null, selectedArmy: null, targetMode: null, panel: 'none', fxQueue: [] })
  },

  selectRegion(id) {
    set({ selectedRegion: id, targetMode: null })
  },

  selectArmy(id) {
    const game = get().game
    const army = id && game ? game.armies[id] : null
    set({ selectedArmy: id, targetMode: null, ...(army ? { selectedRegion: army.location } : {}) })
  },

  setTargetMode(mode) {
    set({ targetMode: mode })
  },

  setPanel(panel) {
    set((st) => ({ panel: st.panel === panel ? 'none' : panel, diploFocus: null }))
  },

  openDiplomacy(nationId) {
    set({ panel: 'diplomacy', diploFocus: nationId })
  },

  issueOrder(order) {
    const { game, orders } = get()
    if (!game) return false
    const { map } = getWorld()
    let rest = orders
    if (order.type === 'move' || order.type === 'attack')
      rest = orders.filter((o) => !((o.type === 'move' || o.type === 'attack') && o.armyId === order.armyId))
    else if (order.type === 'respond') rest = orders.filter((o) => !(o.type === 'respond' && o.proposalId === order.proposalId))
    const err = validateOrder(game, map, order, rest)
    if (err) {
      get().toast(err, 'error')
      return false
    }
    set({ orders: [...rest, order] })
    return true
  },

  removeOrder(index) {
    set((st) => ({ orders: st.orders.filter((_, i) => i !== index) }))
  },

  setPolicy(taxRate, draftRate) {
    const { game, orders } = get()
    if (!game) return
    const rest = orders.filter((o) => o.type !== 'setPolicy')
    const n = game.nations[game.playerId]
    const unchanged = Math.abs(n.taxRate - taxRate) < 1e-6 && Math.abs(n.draftRate - draftRate) < 1e-6
    set({ orders: unchanged ? rest : [...rest, { type: 'setPolicy', nationId: game.playerId, taxRate, draftRate }] })
  },

  clickRegion(id) {
    const { targetMode, selectedArmy, game } = get()
    if (targetMode && selectedArmy && game) {
      const ok =
        targetMode === 'move'
          ? get().issueOrder({ type: 'move', nationId: game.playerId, armyId: selectedArmy, to: id })
          : get().issueOrder({ type: 'attack', nationId: game.playerId, armyId: selectedArmy, target: id })
      if (ok) {
        const { map } = getWorld()
        get().toast(`${targetMode === 'move' ? 'Move' : 'Attack'} order issued: ${map.regions[id].name}`, 'success')
        set({ targetMode: null })
      }
      return
    }
    set({ selectedRegion: id, targetMode: null })
  },

  endTurn() {
    const { game, orders, settings, fxQueue } = get()
    if (!game || game.pendingEvent || game.outcome !== 'playing' || fxQueue.length > 0) return
    const { map } = getWorld()
    const botOrders = generateAllBotOrders(game, map)
    const next = resolveTurn(game, map, [...orders, ...botOrders])
    const player = game.playerId
    const fx = settings.battleFx
      ? next.battles.filter((b) => b.attacker.nationId === player || b.defender.nationId === player)
      : []
    const marches: March[] = []
    for (const a of Object.values(next.armies)) {
      const before = game.armies[a.id]
      if (before && before.location !== a.location) marches.push({ armyId: a.id, owner: a.owner, from: before.location, to: a.location })
    }
    save(next)
    set({ game: next, orders: [], fxQueue: fx, marches, marchStamp: performance.now(), targetMode: null, selectedArmy: next.armies[get().selectedArmy ?? ''] ? get().selectedArmy : null })
    const mine = next.dispatches.filter((d) => d.to === player || d.from === player)
    for (const d of mine.slice(-4)) get().toast(d.text, DISPATCH_TONE[d.kind], 6000)
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
    set({ fxQueue: [] })
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
    set((st) => ({ toasts: [...st.toasts.slice(-3), { id, text, tone }] }))
    setTimeout(() => get().dismissToast(id), ms)
  },

  dismissToast(id) {
    set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }))
  },
}))
