import { create } from 'zustand'
import { normalizeGame } from './engine/migrate'
import { PLAYER_COLOR } from './data/mapColors'
import { createInitialState, type NewGameOptions } from './data/startingNations'
import { applyEventChoice } from './engine/events'
import { validateOrder } from './engine/orders'
import { QUEUED_ORDERS, advance, applyImmediate, cancelMarch, cancelProject, type SimNotice } from './engine/realtime'
import type { BattleReport, Dispatch, GameState, NationId, Order, RegionId } from './engine/types'
import { getWorld } from './map/world'
import { globeBridge, useFx } from './ui/globeBridge'
import { speak } from './ui/plain'

const SAVE_KEY = 'worlds-of-others-save-v2'
const ORDERS_KEY = 'worlds-of-others-orders-v1'
const SETTINGS_KEY = 'worlds-of-others-settings-v1'

export type Panel = 'none' | 'nation' | 'tech' | 'diplomacy' | 'log' | 'settings' | 'territories' | 'military'
export type NationTab = 'economy' | 'laws' | 'arms' | 'armies'

export interface March {
  armyId: string
  owner: string
  from: RegionId
  to: RegionId
}

export interface Settings {
  reducedMotion: boolean
  fxSpeed: 1 | 2
  /** How fast the live clock runs. */
  simSpeed: 1 | 2 | 4
  /** Which of your battles play the full-screen scene. The rest become a toast. */
  battleScenes: 'important' | 'all' | 'off'
  /** Quiet “what to do” prompt on the globe. */
  showTips: boolean
  /** 0–2 are the introduction cards. 3 means the introduction is finished. */
  tutorialStep: number
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error' | 'success'
}

export interface Banner {
  text: string
  tone: 'good' | 'bad'
  territoryId?: string
}

export interface Flash {
  id: string
  until: number
}

interface GameStore {
  game: GameState | null
  orders: Order[]
  selectedRegion: RegionId | null
  selectedTerritory: string | null
  selectedArmy: string | null
  targetMode: 'move' | 'attack' | null
  panel: Panel
  nationTab: NationTab
  diploFocus: NationId | null
  fxQueue: BattleReport[]
  marches: March[]
  marchStamp: number
  settings: Settings
  paused: boolean
  banner: Banner | null
  flashes: Flash[]
  toasts: Toast[]
  hasSave: boolean

  newGame(opts: NewGameOptions): void
  loadGame(): void
  quitToMenu(): void
  selectRegion(id: RegionId | null): void
  focusTerritory(id: string, look?: boolean): void
  openTerritory(id?: string): void
  openMilitary(id?: string): void
  selectArmy(id: string | null): void
  setTargetMode(mode: 'move' | 'attack' | null): void
  setPanel(panel: Panel): void
  setNationTab(tab: NationTab): void
  openNation(tab: NationTab): void
  openDiplomacy(nationId: NationId | null): void
  issueOrder(order: Order): boolean
  removeOrder(index: number): void
  setPolicy(taxRate: number, draftRate: number): void
  clickRegion(id: RegionId): void
  step(dt: number): void
  togglePause(): void
  setSpeed(speed: 1 | 2 | 4): void
  resume(): void
  cancelLiveProject(id: string): void
  cancelLiveMarch(armyId: string): void
  clickTerritory(id: string): void
  chooseEventOption(index: number): void
  shiftFx(): void
  clearFx(): void
  updateSettings(patch: Partial<Settings>): void
  toast(text: string, tone?: Toast['tone'], ms?: number): void
  dismissToast(id: number): void
  persist(): void
}

const defaultSettings: Settings = {
  reducedMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  fxSpeed: 1,
  simSpeed: 1,
  battleScenes: 'important',
  showTips: true,
  tutorialStep: 0,
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

/** The clock waits while the introduction cards are on screen. */
function introOpen(settings: Settings): boolean {
  return settings.showTips && (settings.tutorialStep ?? 0) < 3
}

function writeOrders(orders: Order[]) {
  try {
    if (orders.length) localStorage.setItem(ORDERS_KEY, JSON.stringify(orders))
    else localStorage.removeItem(ORDERS_KEY)
  } catch {
    /* storage may be unavailable */
  }
}

function save(game: GameState | null, orders?: Order[]) {
  try {
    if (game) localStorage.setItem(SAVE_KEY, JSON.stringify(game))
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
  if (typeof order.type !== 'string' || order.nationId !== playerId || !QUEUED_ORDERS.has(order.type)) return false
  if (order.type === 'setPolicy') return Number.isFinite(order.taxRate) && Number.isFinite(order.draftRate)
  if (order.type === 'propose') return typeof order.target === 'string' && !!order.proposal && typeof order.proposal.kind === 'string'
  if (order.type === 'respond') return typeof order.proposalId === 'string' && typeof order.accept === 'boolean'
  if (order.type === 'research') return typeof order.techId === 'string'
  if (order.type === 'spy') return typeof order.target === 'string' && (order.mission === 'sabotage' || order.mission === 'stealVision')
  if (order.type === 'cancelDeal') return typeof order.dealId === 'string'
  if (order.type === 'leaveAlliance') return typeof order.target === 'string'
  if (order.type === 'train') return typeof order.armyId === 'string' && typeof order.unit === 'string'
  return false
}

let toastId = 1

function absorb(state: GameState, notices: SimNotice[], flushOrders: boolean) {
  const store = useGame.getState()
  const player = state.playerId
  const seen = new Set(store.game?.battles.map((b) => b.id) ?? [])
  const mine = state.battles.filter((b) => !seen.has(b.id) && (b.attacker.nationId === player || b.defender.nationId === player))
  const mode = store.settings.battleScenes
  const fresh = mine.filter((b) => mode === 'all' || (mode === 'important' && b.captured))
  for (const b of mine) {
    if (b.captured || fresh.includes(b)) continue
    const won = (b.attacker.nationId === player) === (b.winner === 'attacker')
    store.toast(quietBattleText(b, player), won ? 'success' : 'error', 4200)
  }
  const now = performance.now()
  const flashes = store.flashes.filter((flash) => flash.until > now)
  let banner = store.banner
  let paused = store.paused
  let stops = 0
  for (const notice of notices) {
    if (notice.territoryId) {
      flashes.push({ id: notice.territoryId, until: now + 2600 })
      const territory = getWorld().map.territories[notice.territoryId]
      const color = state.nations[player]?.color ?? PLAYER_COLOR
      if (territory) useFx.getState().addRing({ lat: territory.lat, lng: territory.lng, color: notice.type === 'loss' ? '#ff453a' : color, maxRadius: 3.2 }, 1800)
    }
    if (notice.type === 'capture' || notice.type === 'loss') useFx.getState().shake(notice.type === 'loss' ? 1.15 : 0.7)
    if (notice.pause) {
      paused = true
      stops++
      // Several stops in one tick share one banner.
      banner = stops === 1 ? { text: notice.text, tone: notice.type === 'loss' ? 'bad' : 'good', territoryId: notice.territoryId } : { ...banner!, text: `${banner!.text} (+${stops - 1} more)` }
    } else store.toast(notice.text, notice.type === 'loss' ? 'error' : 'success', 4200)
  }
  if (flushOrders) {
    const mineNews = state.dispatches.filter((d) => d.to === player || d.from === player)
    for (const d of mineNews.slice(-4)) store.toast(d.text, DISPATCH_TONE[d.kind], 6000)
  }
  const selected = store.selectedArmy
  if (paused || flushOrders) save(state, flushOrders ? [] : store.orders)
  if (flashes.length) {
    window.setTimeout(() => {
      useGame.setState((current) => ({ flashes: current.flashes.filter((flash) => flash.until > performance.now()) }))
    }, 2700)
  }
  useGame.setState({
    game: state,
    orders: flushOrders ? [] : store.orders,
    fxQueue: [...store.fxQueue, ...fresh],
    paused,
    banner,
    flashes,
    selectedArmy: selected && state.armies[selected] ? selected : null,
  })
}

function quietBattleText(b: BattleReport, player: NationId): string {
  const where = getWorld().map.regions[b.regionId]?.name ?? 'the front'
  const attackerWon = b.winner === 'attacker'
  if (b.attacker.nationId === player) return attackerWon ? `Won the battle at ${where}` : `Your assault on ${where} was repulsed`
  return attackerWon ? `Lost the battle at ${where}` : `Held the line at ${where}`
}

function heartlandOf(state: { game: GameState | null; selectedRegion: RegionId | null }): string | null {
  const game = state.game
  if (!game) return null
  const regionId = state.selectedRegion && game.regions[state.selectedRegion]?.owner === game.playerId ? state.selectedRegion : game.playerId
  return getWorld().map.territoriesByRegion[regionId]?.[0] ?? null
}

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
  selectedTerritory: null,
  selectedArmy: null,
  targetMode: null,
  panel: 'none',
  nationTab: 'economy',
  diploFocus: null,
  fxQueue: [],
  marches: [],
  marchStamp: 0,
  settings: loadSettings(),
  paused: false,
  banner: null,
  flashes: [],
  toasts: [],
  hasSave: typeof localStorage !== 'undefined' && !!localStorage.getItem(SAVE_KEY),

  newGame(opts) {
    const { map } = getWorld()
    const game = createInitialState(map, opts)
    save(game, [])
    set({ game, orders: [], selectedRegion: game.playerId, selectedTerritory: null, selectedArmy: null, targetMode: null, panel: 'none', fxQueue: [], marches: [], hasSave: true, paused: introOpen(get().settings), banner: null, flashes: [] })
  },

  loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return
      const game = normalizeGame(JSON.parse(raw) as GameState, getWorld().map)
      set({ game, orders: loadOrders(game.playerId), selectedRegion: game.playerId, selectedTerritory: null, selectedArmy: null, targetMode: null, panel: 'none', fxQueue: [], marches: [], paused: false, banner: null, flashes: [] })
    } catch {
      get().toast('Save file is corrupted.', 'error')
    }
  },

  quitToMenu() {
    const { game, orders } = get()
    if (game) save(game, orders)
    set({ game: null, orders: [], selectedRegion: null, selectedTerritory: null, selectedArmy: null, targetMode: null, panel: 'none', fxQueue: [] })
  },

  selectRegion(id) {
    set({ selectedRegion: id, selectedTerritory: null, targetMode: null })
  },

  focusTerritory(id, look = false) {
    const territory = getWorld().map.territories[id]
    if (!territory) return
    set({ selectedTerritory: id, selectedRegion: territory.regionId, targetMode: null })
    const api = globeBridge.api
    if (!look || !api) return
    const current = api.pointOfView()
    const altitude = current && current.altitude >= 1.5 ? current.altitude : 1.8
    api.pointOfView({ lat: territory.lat, lng: territory.lng, altitude }, get().settings.reducedMotion ? 0 : 700)
  },

  openTerritory(id) {
    const territoryId = id ?? get().selectedTerritory ?? heartlandOf(get())
    const territory = territoryId ? getWorld().map.territories[territoryId] : null
    set({ panel: 'territories', diploFocus: null, selectedTerritory: territoryId, ...(territory ? { selectedRegion: territory.regionId } : {}) })
  },

  openMilitary(id) {
    const territoryId = id ?? get().selectedTerritory ?? heartlandOf(get())
    const territory = territoryId ? getWorld().map.territories[territoryId] : null
    set({ panel: 'military', diploFocus: null, selectedTerritory: territoryId, ...(territory ? { selectedRegion: territory.regionId } : {}) })
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

  setNationTab(tab) {
    set({ nationTab: tab })
  },

  openNation(tab) {
    set({ panel: 'nation', nationTab: tab, diploFocus: null })
  },

  openDiplomacy(nationId) {
    set({ panel: 'diplomacy', diploFocus: nationId })
  },

  issueOrder(order) {
    const { game, orders } = get()
    if (!game) return false
    const { map } = getWorld()
    if (!QUEUED_ORDERS.has(order.type)) {
      const result = applyImmediate(game, map, order)
      if (result.error) {
        get().toast(result.error, 'error')
        return false
      }
      absorb(result.state, result.notices, false)
      save(result.state)
      return true
    }
    let rest = orders
    if (order.type === 'move' || order.type === 'attack')
      rest = orders.filter((o) => !((o.type === 'move' || o.type === 'attack') && o.armyId === order.armyId))
    else if (order.type === 'respond') rest = orders.filter((o) => !(o.type === 'respond' && o.proposalId === order.proposalId))
    else if (order.type === 'train') rest = orders.filter((o) => !(o.type === 'train' && o.armyId === order.armyId && o.unit === order.unit))
    else if (order.type === 'assignGeneral') {
      rest = orders.filter((o) => !(o.type === 'assignGeneral' && (o.armyId === order.armyId || (!!order.generalId && o.generalId === order.generalId))))
      if (order.generalId) rest = rest.filter((o) => !(o.type === 'train' && o.armyId === order.armyId))
    }
    else if (order.type === 'rebase') rest = orders.filter((o) => !(o.type === 'rebase' && o.armyId === order.armyId))
    else if (order.type === 'develop') rest = orders.filter((o) => !(o.type === 'develop' && o.territoryId === order.territoryId && o.upgrade === order.upgrade))
    else if (order.type === 'cancelTrain') rest = orders.filter((o) => !(o.type === 'cancelTrain' && o.jobId === order.jobId))
    else if (order.type === 'signContract') rest = orders.filter((o) => !(o.type === 'signContract' && o.unit === order.unit))
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
    const current = get().selectedTerritory
    const territory = current ? getWorld().map.territories[current] : null
    set({ selectedRegion: id, targetMode: null, selectedTerritory: territory?.regionId === id ? current : null })
  },

  step(dt) {
    const { game, orders, settings, fxQueue, paused } = get()
    if (!game || paused || game.pendingEvent || game.outcome !== 'playing' || fxQueue.length > 0) return
    const result = advance(game, getWorld().map, dt * (settings.simSpeed ?? 1), orders)
    absorb(result.state, result.notices, result.flushOrders)
  },

  togglePause() {
    const { game, paused, banner } = get()
    if (!game) return
    if (paused) {
      set({ paused: false, banner: null })
      return
    }
    set({ paused: true, banner: banner ?? { text: 'Paused', tone: 'good' } })
    save(game, get().orders)
  },

  setSpeed(speed) {
    get().updateSettings({ simSpeed: speed })
    if (get().paused) set({ paused: false, banner: null })
  },

  resume() {
    set({ paused: false, banner: null })
  },

  cancelLiveProject(id) {
    const { game } = get()
    if (!game) return
    const next = cancelProject(game, id)
    if (next === game) return
    save(next)
    set({ game: next })
    get().toast('Construction cancelled. What you get back is in your treasury.', 'info')
  },

  cancelLiveMarch(armyId) {
    const { game } = get()
    if (!game) return
    const next = cancelMarch(game, armyId)
    if (next === game) return
    save(next)
    set({ game: next })
  },

  clickTerritory(id) {
    const territory = getWorld().map.territories[id]
    if (!territory) return
    const { targetMode, selectedArmy, game } = get()
    if (targetMode === 'attack' && selectedArmy && game) {
      const ok = get().issueOrder({ type: 'attack', nationId: game.playerId, armyId: selectedArmy, target: territory.regionId, territoryId: id })
      if (ok) {
        get().toast(`Attacking ${territory.name}`, 'success')
        set({ targetMode: null })
      }
      return
    }
    get().focusTerritory(id, true)
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
    const shown = tone === 'error' ? speak(text) : text
    set((st) => ({ toasts: [...st.toasts.slice(-3), { id, text: shown, tone }] }))
    setTimeout(() => get().dismissToast(id), ms)
  },

  dismissToast(id) {
    set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }))
  },

  persist() {
    const { game, orders } = get()
    save(game, orders)
  },
}))
