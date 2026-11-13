import { generateAllBotOrders, generateBotOrders } from '../ai/bot'
import { createInitialState } from '../data/startingNations'
import { resolveTurn } from '../engine/resolveTurn'
import type { GameState, NationId, Order, WorldMap } from '../engine/types'
import { decodeState, encodeState, MAX_PLAYERS, type ChatMessage, type ClientId, type Lobby, type NetMessage, type RoomSettings } from './protocol'
import type { Transport } from './transport'

/** Heartbeats keep everyone's list of who is here. A player not heard from in this long is treated as gone. */
export const PING_MS = 2500
export const PEER_TIMEOUT_MS = 9000
export const HOST_TIMEOUT_MS = 12000
/** A plan is sent again this often, so a message the network dropped costs a few seconds, not the player's month. */
export const RESEND_MS = 6000
/** A screen that finds it is behind asks for the game, but not more often than this. */
const CATCH_UP_MS = 4000

export interface SessionEvents {
  onLobby?(lobby: Lobby): void
  /** The game began, or this screen got a fresh copy (after joining late or reconnecting). */
  onStart?(state: GameState): void
  /** A month resolved. `prev` is the game before it, so the screen can replay the battles. */
  onState?(prev: GameState | null, next: GameState): void
  onReady?(ready: NationId[], remainingMs: number | null): void
  onChat?(msg: ChatMessage): void
  onPeers?(connected: ClientId[]): void
  onHost?(isHost: boolean): void
  /** The host changed, so each screen should send its plan again. */
  onResubmit?(): void
  onError?(text: string): void
}

export interface SessionOptions {
  transport: Transport
  clientId: ClientId
  name: string
  map: WorldMap
  events?: SessionEvents
  now?: () => number
  /** Tests turn the timers off and call `tick()` themselves. */
  autoTick?: boolean
}

/** A seeded shuffle of the humans, so nobody gains from sending orders a moment sooner. */
export function humanOrder(seed: number, turn: number, ids: NationId[]): NationId[] {
  const key = (id: NationId) => {
    let h = 2166136261 ^ seed ^ Math.imul(turn, 2654435761)
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
    return h >>> 0
  }
  return [...ids].sort((a, b) => key(a) - key(b) || (a < b ? -1 : 1))
}

interface Plan {
  turn: number
  orders: Order[]
  ready: boolean
}

/**
 * One screen's side of an online game. The host holds the true game and resolves each month; everyone else sends their
 * orders to the host and shows the games the host sends back. Nothing here trusts a client: orders are checked against
 * the nation the sender is playing before they are used.
 */
export class OnlineSession {
  readonly clientId: ClientId
  readonly transport: Transport
  name: string
  lobby: Lobby | null = null
  game: GameState | null = null
  private map: WorldMap
  private events: SessionEvents
  private now: () => number
  private plans = new Map<NationId, Plan>()
  private seen = new Map<ClientId, number>()
  private names = new Map<ClientId, string>()
  private pieces = new Map<string, string[]>()
  private deadlineAt: number | null = null
  /** Milliseconds left in the month, as last told by the host. Null when there is no timer. */
  remainingMs: number | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastPing = 0
  private resolving = false
  private lastPeers = ''
  private lastPlan: (Plan & { at: number }) | null = null
  private askedAt = -Infinity
  closed = false

  constructor(opts: SessionOptions) {
    this.clientId = opts.clientId
    this.transport = opts.transport
    this.name = opts.name
    this.map = opts.map
    this.events = opts.events ?? {}
    this.now = opts.now ?? Date.now
    this.transport.onMessage((m) => void this.receive(m))
    if (opts.autoTick !== false) this.timer = setInterval(() => this.tick(), 500)
  }

  get isHost() {
    return this.lobby?.host === this.clientId
  }

  /** The nation this screen plays, once one is picked. */
  get me(): NationId | null {
    return this.lobby?.players.find((p) => p.clientId === this.clientId)?.nationId ?? null
  }

  private send(msg: NetMessage) {
    if (!this.closed) this.transport.send(msg)
  }

  // ---- lobby ----

  /** Opens a room with this screen as the host. */
  createRoom(code: string, settings: RoomSettings) {
    this.lobby = { code, host: this.clientId, settings, players: [{ clientId: this.clientId, name: this.name, nationId: null }], phase: 'lobby' }
    this.seen.set(this.clientId, this.now())
    this.broadcastLobby()
    this.events.onHost?.(true)
  }

  /** Asks to join a room. The host answers with the lobby. */
  joinRoom() {
    this.send({ t: 'hello', from: this.clientId, name: this.name })
  }

  pickNation(nationId: NationId | null) {
    if (this.isHost) this.handlePick(this.clientId, nationId)
    else this.send({ t: 'pick', from: this.clientId, nationId })
  }

  updateSettings(settings: RoomSettings) {
    if (!this.isHost || !this.lobby || this.lobby.phase !== 'lobby') return
    this.lobby = { ...this.lobby, settings }
    this.broadcastLobby()
  }

  private broadcastLobby() {
    if (!this.lobby) return
    this.send({ t: 'lobby', from: this.clientId, lobby: this.lobby })
    this.events.onLobby?.(this.lobby)
  }

  private handlePick(from: ClientId, nationId: NationId | null) {
    const lobby = this.lobby
    if (!lobby || lobby.phase !== 'lobby') return
    const p = lobby.players.find((x) => x.clientId === from)
    if (!p) return
    if (nationId !== null) {
      if (!this.map.regions[nationId]) return
      if (lobby.players.some((x) => x.clientId !== from && x.nationId === nationId)) return
    }
    p.nationId = nationId
    this.broadcastLobby()
  }

  /** Host: starts the game with the nations picked. Returns why it cannot, or null. */
  async startGame(): Promise<string | null> {
    const lobby = this.lobby
    if (!this.isHost || !lobby) return 'Only the host can start the game'
    if (lobby.phase !== 'lobby') return 'The game has already started'
    const humans = lobby.players.map((p) => p.nationId)
    if (humans.some((h) => !h)) return 'Everyone needs to pick a nation first'
    const ids = humans as NationId[]
    const state = createInitialState(this.map, { playerRegionId: ids[0], humans: ids, seed: lobby.settings.seed, victoryShare: lobby.settings.victoryShare, difficulty: lobby.settings.difficulty })
    lobby.phase = 'playing'
    this.game = state
    this.plans.clear()
    this.armTimer()
    this.broadcastLobby()
    await this.broadcastState()
    this.events.onStart?.(this.viewOf(state))
    this.emitReady()
    return null
  }

  // ---- play ----

  /** Sends this screen's plan for the month. `ready` says the player is done. */
  submitOrders(turn: number, orders: Order[], ready: boolean) {
    const me = this.me
    if (!me) return
    if (this.isHost) this.takePlan(this.clientId, turn, orders, ready)
    else {
      this.lastPlan = { turn, orders, ready, at: this.now() }
      this.send({ t: 'orders', from: this.clientId, turn, orders, ready })
    }
  }

  private takePlan(from: ClientId, turn: number, orders: Order[], ready: boolean) {
    const game = this.game
    const p = this.lobby?.players.find((x) => x.clientId === from)
    if (!game || !p?.nationId || game.outcome !== 'playing' || turn !== game.turn) return
    if (!game.humans.includes(p.nationId)) return
    // Only orders for the sender's own nation count.
    const mine = orders.filter((o) => o && o.nationId === p.nationId)
    this.plans.set(p.nationId, { turn, orders: mine, ready })
    this.emitReady()
    this.checkResolve()
  }

  private connected(clientId: ClientId): boolean {
    if (clientId === this.clientId) return true
    const at = this.seen.get(clientId)
    return at !== undefined && this.now() - at < PEER_TIMEOUT_MS
  }

  private humansHere(): { clientId: ClientId; nationId: NationId }[] {
    const game = this.game
    if (!game || !this.lobby) return []
    return this.lobby.players.filter((p): p is { clientId: ClientId; name: string; nationId: NationId } => !!p.nationId && game.humans.includes(p.nationId))
  }

  private readyNations(): NationId[] {
    const game = this.game
    if (!game) return []
    return this.humansHere()
      .filter((h) => this.plans.get(h.nationId)?.ready && this.plans.get(h.nationId)?.turn === game.turn)
      .map((h) => h.nationId)
  }

  private emitReady() {
    const ready = this.readyNations()
    const remaining = this.deadlineAt === null ? null : Math.max(0, this.deadlineAt - this.now())
    this.remainingMs = remaining
    this.events.onReady?.(ready, remaining)
    if (this.isHost) this.send({ t: 'ready', from: this.clientId, turn: this.game?.turn ?? 0, ready, remainingMs: remaining })
  }

  private checkResolve() {
    if (!this.isHost || !this.game || this.game.outcome !== 'playing' || this.resolving) return
    const waiting = this.humansHere().filter((h) => this.connected(h.clientId) && !(this.plans.get(h.nationId)?.ready && this.plans.get(h.nationId)?.turn === this.game!.turn))
    if (waiting.length === 0) void this.resolve()
  }

  private armTimer() {
    const seconds = this.lobby?.settings.timer ?? 0
    this.deadlineAt = seconds > 0 ? this.now() + seconds * 1000 : null
  }

  /** Host: plays the month. Anyone who has not sent a plan stays idle, unless they have left, and then the AI plays for them. */
  async resolve() {
    const game = this.game
    if (!this.isHost || !game || game.outcome !== 'playing' || this.resolving) return
    this.resolving = true
    try {
      const orders: Order[] = []
      for (const id of humanOrder(game.seed, game.turn, game.humans)) {
        const player = this.lobby?.players.find((p) => p.nationId === id)
        const plan = this.plans.get(id)
        if (plan && plan.turn === game.turn) orders.push(...plan.orders)
        else if (player && !this.connected(player.clientId)) orders.push(...generateBotOrders(game, this.map, id, true))
      }
      orders.push(...generateAllBotOrders(game, this.map))
      const next = resolveTurn(game, this.map, orders)
      this.game = next
      this.plans.clear()
      this.armTimer()
      await this.broadcastState()
      this.events.onState?.(this.viewOf(game), this.viewOf(next))
      this.emitReady()
    } finally {
      this.resolving = false
    }
  }

  private async broadcastState(to?: ClientId) {
    const game = this.game
    if (!game) return
    void to
    const parts = await encodeState(game)
    const id = `${game.turn}-${this.now().toString(36)}`
    parts.forEach((data, part) => this.send({ t: 'state', from: this.clientId, id, part, parts: parts.length, data, turn: game.turn, remainingMs: this.deadlineAt === null ? null : Math.max(0, this.deadlineAt - this.now()) }))
  }

  /** This screen's copy of a game: the same, but `playerId` says whose screen it is. */
  private viewOf(state: GameState): GameState {
    const me = this.me
    return me ? { ...state, playerId: me } : state
  }

  // ---- messages ----

  chat(text: string) {
    const msg: ChatMessage = { from: this.clientId, name: this.name, text: text.slice(0, 240), at: this.now() }
    this.send({ t: 'chat', ...msg })
    this.events.onChat?.(msg)
  }

  leave() {
    this.send({ t: 'leave', from: this.clientId })
    this.close()
  }

  close() {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.transport.close()
  }

  private async receive(msg: NetMessage) {
    if (this.closed || !msg || msg.from === this.clientId) return
    this.seen.set(msg.from, this.now())
    switch (msg.t) {
      case 'ping':
        this.names.set(msg.from, msg.name)
        return
      case 'hello':
        return this.handleHello(msg.from, msg.name)
      case 'pick':
        if (this.isHost) this.handlePick(msg.from, msg.nationId)
        return
      case 'leave':
        return this.handleLeave(msg.from)
      case 'orders':
        if (this.isHost) this.takePlan(msg.from, msg.turn, msg.orders, msg.ready)
        return
      case 'lobby':
        // Only the current host's word counts.
        if (this.lobby && this.lobby.host !== msg.from && !this.isHostClaim(msg.from)) return
        this.lobby = msg.lobby
        this.events.onLobby?.(msg.lobby)
        this.events.onHost?.(this.isHost)
        return
      case 'ready':
        if (!this.isHost) {
          // The host is on a later month than this screen: a state message was lost.
          if (this.game && msg.turn > this.game.turn) this.catchUp()
          else this.events.onReady?.(msg.ready, msg.remainingMs)
        }
        this.remainingMs = msg.remainingMs
        return
      case 'state':
        return this.handleStatePiece(msg)
      case 'need-state':
        if (this.isHost) await this.broadcastState()
        return
      case 'chat':
        this.events.onChat?.({ from: msg.from, name: msg.name, text: msg.text, at: msg.at })
        return
      case 'claim-host':
        return this.handleClaim(msg.from)
      case 'settings':
        return
    }
  }

  private isHostClaim(from: ClientId) {
    return this.lobby?.players.some((p) => p.clientId === from) ?? false
  }

  private handleHello(from: ClientId, name: string) {
    this.names.set(from, name)
    if (!this.isHost || !this.lobby) return
    const lobby = this.lobby
    const known = lobby.players.find((p) => p.clientId === from)
    if (known) {
      known.name = name
    } else if (lobby.phase === 'lobby' && lobby.players.length < MAX_PLAYERS) {
      lobby.players.push({ clientId: from, name, nationId: null })
    } else {
      this.events.onError?.(`${name} tried to join, but the room is ${lobby.phase === 'playing' ? 'already playing' : 'full'}.`)
      return
    }
    this.broadcastLobby()
    // Someone coming back to a running game gets the game.
    if (lobby.phase === 'playing') void this.broadcastState()
  }

  private handleLeave(from: ClientId) {
    this.seen.delete(from)
    if (!this.isHost || !this.lobby) return
    if (this.lobby.phase === 'lobby') {
      this.lobby.players = this.lobby.players.filter((p) => p.clientId !== from)
      this.broadcastLobby()
    } else {
      // A running game keeps the seat: the AI plays it while they are away, and they can come back.
      this.checkResolve()
    }
  }

  private async handleStatePiece(msg: Extract<NetMessage, { t: 'state' }>) {
    if (this.isHost) return
    const list = this.pieces.get(msg.id) ?? []
    list[msg.part] = msg.data
    this.pieces.set(msg.id, list)
    if (list.filter(Boolean).length < msg.parts) return
    this.pieces.delete(msg.id)
    // A newer copy has arrived while this one was assembling.
    if (this.game && msg.turn < this.game.turn) return
    const state = await decodeState(list)
    const prev = this.game
    this.game = state
    this.remainingMs = msg.remainingMs
    if (prev && prev.turn < state.turn) this.events.onState?.(this.viewOf(prev), this.viewOf(state))
    else this.events.onStart?.(this.viewOf(state))
  }

  private handleClaim(from: ClientId) {
    if (!this.lobby || !this.isHostClaim(from)) return
    this.lobby = { ...this.lobby, host: from }
    this.events.onLobby?.(this.lobby)
    this.events.onHost?.(this.isHost)
    this.events.onResubmit?.()
  }

  /** Called every half second: heartbeats, the month timer, and taking over when the host disappears. */
  tick() {
    if (this.closed) return
    const t = this.now()
    if (t - this.lastPing >= PING_MS) {
      this.lastPing = t
      this.send({ t: 'ping', from: this.clientId, name: this.name })
    }
    const here = [...this.seen.keys()].filter((id) => this.connected(id)).sort()
    const key = here.join(',')
    if (key !== this.lastPeers) {
      this.lastPeers = key
      this.events.onPeers?.(here)
    }
    if (!this.lobby) return
    if (this.isHost) {
      if (this.game?.outcome === 'playing' && this.deadlineAt !== null && t >= this.deadlineAt) void this.resolve()
      else this.checkResolve()
      return
    }
    // Send the plan again in case the host never got it. The host takes the latest plan it hears, so this changes nothing if it did.
    const plan = this.lastPlan
    if (plan && this.game && plan.turn === this.game.turn && t - plan.at >= RESEND_MS) {
      plan.at = t
      this.send({ t: 'orders', from: this.clientId, turn: plan.turn, orders: plan.orders, ready: plan.ready })
    }
    // The host has gone quiet: the first player still here takes over, with the latest game this screen holds.
    const hostSeen = this.seen.get(this.lobby.host)
    if (this.lobby.phase === 'playing' && this.game && hostSeen !== undefined && t - hostSeen > HOST_TIMEOUT_MS) {
      const candidates = this.lobby.players.map((p) => p.clientId).filter((id) => id !== this.lobby!.host && this.connected(id)).sort()
      if (candidates[0] === this.clientId) this.becomeHost()
    }
  }

  private becomeHost() {
    if (!this.lobby) return
    this.lobby = { ...this.lobby, host: this.clientId }
    this.plans.clear()
    this.armTimer()
    this.send({ t: 'claim-host', from: this.clientId })
    this.events.onLobby?.(this.lobby)
    this.events.onHost?.(true)
    this.events.onResubmit?.()
    this.emitReady()
  }

  /** Asks the host for the current game, for a screen that has just opened. */
  requestState() {
    this.send({ t: 'need-state', from: this.clientId })
  }

  private catchUp() {
    const t = this.now()
    if (t - this.askedAt < CATCH_UP_MS) return
    this.askedAt = t
    this.requestState()
  }
}
