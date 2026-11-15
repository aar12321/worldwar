import { generateAllBotOrders, generateBotOrders } from '../ai/bot'
import { createInitialState } from '../data/startingNations'
import type { LiveOp } from '../engine/live'
import { isMonthEndOrder } from '../engine/orders'
import { resolveTurn } from '../engine/resolveTurn'
import type { GameState, NationId, Order, WorldMap } from '../engine/types'
import { LiveMirror, LiveReferee, type LiveUpdate, type MonthInput } from './liveRoom'
import { decodeState, encodeState, fingerprint, MAX_PLAYERS, type ChatMessage, type ClientId, type LiveClock, type LiveSpeed, type Lobby, type NetMessage, type RoomSettings } from './protocol'
import { startTicker } from './ticker'
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
  /** Live: the game moved on, by the host's steps or a fresh copy. The games already have this screen's `playerId`. */
  onLive?(update: LiveUpdate): void
  /** Live: the shared clock changed. */
  onClock?(clock: LiveClock): void
  /** Live: the host could not make an order this screen sent, or refused a request about the clock. */
  onActFail?(nonce: string, error: string): void
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

/** How often the session ticks. A live game at 4x moves a day every half second, so the host checks the clock often. */
export const TICK_MS = 250

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
  private askedOpsAt = -Infinity
  /** Live, on the host: the true game, the clock and the log of steps. */
  referee: LiveReferee | null = null
  /** Live, everywhere else: this screen's copy of the host's game. */
  mirror: LiveMirror | null = null
  /** Live: the shared clock, as last heard. */
  clock: LiveClock | null = null
  private clockKey = ''
  private lastClockAt = 0
  private behindSince: number | null = null
  private nonce = 0
  /** Live: orders this screen sent that the host has not answered yet, sent again now and then in case one was lost. */
  private unacked = new Map<string, { order: Order; at: number }>()
  /** Live, on the host: what became of recent orders, by nonce (null when made), so one that arrives twice runs once. */
  private answered = new Map<string, string | null>()
  closed = false

  constructor(opts: SessionOptions) {
    this.clientId = opts.clientId
    this.transport = opts.transport
    this.name = opts.name
    this.map = opts.map
    this.events = opts.events ?? {}
    this.now = opts.now ?? Date.now
    this.transport.onMessage((m) => void this.receive(m))
    if (opts.autoTick !== false) this.stopTicker = startTicker(() => this.tick(), TICK_MS)
  }

  private stopTicker: (() => void) | null = null

  get isHost() {
    return this.lobby?.host === this.clientId
  }

  /** Whether this room plays the live mode. */
  get isLive() {
    return this.lobby?.settings.mode === 'live'
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
    const live = lobby.settings.mode === 'live'
    const state = createInitialState(this.map, {
      playerRegionId: ids[0],
      humans: ids,
      seed: lobby.settings.seed,
      victoryShare: lobby.settings.victoryShare,
      goal: lobby.settings.goal ?? 'world',
      difficulty: lobby.settings.difficulty,
      online: true,
      ...(live ? { mode: 'live' as const } : {}),
    })
    lobby.phase = 'playing'
    this.game = state
    this.plans.clear()
    if (live) this.referee = new LiveReferee(state, this.map, { hostId: this.clientId, speed: lobby.settings.speed, pauses: lobby.settings.pauses, pauseLimitSec: lobby.settings.pauseLimitSec, seq: 0, now: this.now() })
    else this.armTimer()
    this.broadcastLobby()
    await this.broadcastState()
    this.events.onStart?.(this.viewOf(state))
    if (live) this.broadcastClock()
    else this.emitReady()
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
    // A live month ends by the clock, not when everyone is ready.
    if (this.isLive) return
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
    if (this.isLive) return
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
    if (this.isLive) return
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

  private async broadcastState(reset = false) {
    // A live game is sent as of a step, so the screens know which of the host's steps come after it.
    const game = this.referee?.game ?? this.game
    if (!game) return
    const seq = this.referee ? this.referee.seq : undefined
    const parts = await encodeState(game)
    const id = `${game.turn}-${seq ?? ''}-${this.now().toString(36)}`
    const live = seq !== undefined ? { seq, ...(reset ? { reset: true } : {}) } : {}
    parts.forEach((data, part) => this.send({ t: 'state', from: this.clientId, id, part, parts: parts.length, data, turn: game.turn, remainingMs: this.deadlineAt === null ? null : Math.max(0, this.deadlineAt - this.now()), ...live }))
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
    this.stopTicker?.()
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
      case 'act':
        if (this.isHost) this.handleAct(msg.from, msg.nonce, msg.order)
        return
      case 'act-fail':
        if (msg.to === this.clientId && (this.unacked.delete(msg.nonce) || msg.nonce.startsWith('clock-'))) this.events.onActFail?.(msg.nonce, msg.error)
        return
      case 'ops':
        return this.handleOps(msg)
      case 'clock':
        if (msg.from === this.lobby?.host && !this.isHost) this.takeClock(msg.clock)
        return
      case 'clock-req':
        if (this.isHost) this.handleClockRequest(msg.from, msg.action, msg.speed)
        return
      case 'need-ops':
        if (this.isHost) this.handleNeedOps(msg.fromSeq)
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
    // Someone coming back to a running game gets the game, and in a live game the clock.
    if (lobby.phase === 'playing') {
      void this.broadcastState()
      if (this.referee) this.broadcastClock()
    }
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
    if (msg.seq !== undefined) return this.takeLiveState(await decodeState(list), msg.seq, !!msg.reset)
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
    if (this.isHost && this.referee) {
      this.tickLive(t)
      return
    }
    if (this.isHost) {
      if (this.game?.outcome === 'playing' && this.deadlineAt !== null && t >= this.deadlineAt) void this.resolve()
      else this.checkResolve()
      return
    }
    if (this.mirror) this.watchMirror(t)
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
    this.send({ t: 'claim-host', from: this.clientId })
    this.events.onLobby?.(this.lobby)
    this.events.onHost?.(true)
    if (this.isLive && this.mirror) {
      // Carry on from this screen's own copy and step count, paused, and make sure everyone has exactly this game.
      const settings = this.lobby.settings
      const referee = new LiveReferee(this.mirror.game, this.map, { hostId: this.clientId, speed: this.clock?.speed ?? settings.speed, pauses: settings.pauses, pauseLimitSec: settings.pauseLimitSec, seq: this.mirror.seq, now: this.now() })
      if (this.clock) referee.restorePauses(this.clock.pausesLeft)
      this.referee = referee
      this.game = referee.game
      this.mirror = null
      void this.broadcastState(true)
      this.broadcastClock()
      this.events.onResubmit?.()
      return
    }
    this.armTimer()
    this.events.onResubmit?.()
    this.emitReady()
  }

  // ---- live games ----

  /** A new nonce for an order this screen sends. */
  newNonce(): string {
    return `${this.clientId}-${this.now().toString(36)}-${++this.nonce}`
  }

  /** Sends an order that happens at once. The host applies it and every screen gets it as a step. Returns its nonce. */
  sendAct(order: Order, nonce: string = this.newNonce()): string {
    if (this.isHost) this.handleAct(this.clientId, nonce, order)
    else {
      this.unacked.set(nonce, { order, at: this.now() })
      this.send({ t: 'act', from: this.clientId, nonce, order })
    }
    return nonce
  }

  requestPause() {
    this.clockRequest('pause')
  }

  requestResume() {
    this.clockRequest('resume')
  }

  requestSpeed(speed: LiveSpeed) {
    this.clockRequest('speed', speed)
  }

  private clockRequest(action: 'pause' | 'resume' | 'speed', speed?: LiveSpeed) {
    if (this.isHost) this.handleClockRequest(this.clientId, action, speed)
    else this.send({ t: 'clock-req', from: this.clientId, action, ...(speed ? { speed } : {}) })
  }

  /** The host's page was hidden or shown again. Everyone is told, since a hidden page may run the game slowly. */
  setHidden(hidden: boolean) {
    if (!this.referee || this.referee.hostHidden === hidden) return
    this.referee.hostHidden = hidden
    this.broadcastClock()
  }

  private actFail(to: ClientId, nonce: string, error: string) {
    this.remember(nonce, error)
    if (to === this.clientId) this.events.onActFail?.(nonce, error)
    else this.send({ t: 'act-fail', from: this.clientId, to, nonce, error })
  }

  private remember(nonce: string, error: string | null) {
    if (nonce.startsWith('clock-')) return
    this.answered.set(nonce, error)
    if (this.answered.size > 2000) this.answered.delete(this.answered.keys().next().value!)
  }

  private handleAct(from: ClientId, nonce: string, order: Order) {
    const referee = this.referee
    const p = this.lobby?.players.find((x) => x.clientId === from)
    if (!referee || !p?.nationId) return
    // The same order sent again: it was made (the steps carry it) or refused (say so again), never made twice.
    if (this.answered.has(nonce)) {
      const error = this.answered.get(nonce)
      if (error) this.actFail(from, nonce, error)
      return
    }
    const game = referee.game
    if (!game.humans.includes(p.nationId)) return this.actFail(from, nonce, 'Your nation has fallen')
    // Only orders for the sender's own nation count, and only those that happen at once.
    if (!order || order.nationId !== p.nationId) return this.actFail(from, nonce, 'That order is for another nation')
    if (isMonthEndOrder(game, order.type)) return this.actFail(from, nonce, 'That order waits for the 1st of the month')
    const result = referee.act(p.nationId, order, nonce)
    if ('error' in result) return this.actFail(from, nonce, result.error)
    this.remember(nonce, null)
    this.game = referee.game
    this.broadcastOps(referee.seq - 1, [result.op])
    this.emitLive(result.update)
  }

  private broadcastOps(seq0: number, ops: LiveOp[]) {
    const game = this.referee?.game
    this.send({ t: 'ops', from: this.clientId, seq0, ops, fp: game ? fingerprint(game) : null })
  }

  private emitLive(update: LiveUpdate) {
    this.events.onLive?.({ ...update, prev: this.viewOf(update.prev), next: this.viewOf(update.next) })
  }

  /** Everyone's month-end orders in the month's seeded order, and the AI for the nations nobody is at. */
  private monthInput(game: GameState): MonthInput {
    const monthOrders: Order[] = []
    const plans: Record<NationId, number> = {}
    const away: NationId[] = []
    for (const id of humanOrder(game.seed, game.turn, game.humans)) {
      const player = this.lobby?.players.find((p) => p.nationId === id)
      const plan = this.plans.get(id)
      if (plan && plan.turn === game.turn) {
        monthOrders.push(...plan.orders)
        plans[id] = plan.turn
      } else if (player && !this.connected(player.clientId)) away.push(id)
    }
    const planner = (s: GameState, map: WorldMap) => [...away.flatMap((id) => generateBotOrders(s, map, id, true)), ...generateAllBotOrders(s, map)]
    return { monthOrders, plans, planner }
  }

  private tickLive(t: number) {
    const referee = this.referee!
    const { ops, update } = referee.advance(t, (g) => this.monthInput(g))
    if (ops.length) {
      this.game = referee.game
      this.broadcastOps(referee.seq - ops.length, ops)
      if (update?.monthEnded) {
        // Plans for the month that ended are spent.
        for (const [id, plan] of this.plans) if (plan.turn < referee.game.turn) this.plans.delete(id)
        void this.broadcastState()
      }
      if (update) this.emitLive(update)
    }
    // The clock goes out when it changes, and with each heartbeat so the pause countdown stays right.
    const view = referee.view(t, this.playerIds())
    const key = `${view.running}|${view.speed}|${view.pausedBy}|${view.hostHidden ?? ''}|${JSON.stringify(view.pausesLeft)}`
    if (key !== this.clockKey || t - this.lastClockAt >= PING_MS) this.broadcastClock()
  }

  private playerIds(): ClientId[] {
    return (this.lobby?.players ?? []).map((p) => p.clientId)
  }

  private broadcastClock() {
    const referee = this.referee
    if (!referee) return
    const t = this.now()
    const clock = referee.view(t, this.playerIds())
    this.clockKey = `${clock.running}|${clock.speed}|${clock.pausedBy}|${clock.hostHidden ?? ''}|${JSON.stringify(clock.pausesLeft)}`
    this.lastClockAt = t
    this.clock = clock
    this.send({ t: 'clock', from: this.clientId, clock })
    this.events.onClock?.(clock)
  }

  private takeClock(clock: LiveClock) {
    this.clock = clock
    this.events.onClock?.(clock)
  }

  private handleClockRequest(from: ClientId, action: 'pause' | 'resume' | 'speed', speed?: LiveSpeed) {
    const referee = this.referee
    if (!referee || !this.lobby?.players.some((p) => p.clientId === from)) return
    const t = this.now()
    // Bring the clock up to now first, so a pause stops it where it is.
    this.tickLive(t)
    const error = action === 'pause' ? referee.pause(from, t) : action === 'resume' ? referee.requestResume(from) : speed ? referee.setSpeed(from, speed) : 'No speed given'
    if (error) this.actFail(from, `clock-${action}`, error)
    this.broadcastClock()
  }

  private handleNeedOps(fromSeq: number) {
    const referee = this.referee
    if (!referee) return
    const ops = referee.opsSince(fromSeq)
    if (ops === null) void this.broadcastState()
    else if (ops.length) this.broadcastOps(fromSeq, ops)
  }

  private handleOps(msg: Extract<NetMessage, { t: 'ops' }>) {
    if (this.isHost || msg.from !== this.lobby?.host) return
    const mirror = this.mirror
    if (!mirror) {
      this.catchUp()
      return
    }
    const { update, gap, mismatch } = mirror.receive(msg.seq0, msg.ops, msg.fp)
    this.game = mirror.game
    for (const a of update?.acts ?? []) if (a.nonce) this.unacked.delete(a.nonce)
    if (update) this.emitLive(update)
    if (mismatch) this.catchUp()
    else if (gap) this.askForOps()
  }

  private takeLiveState(state: GameState, seq: number, reset: boolean) {
    if (!this.mirror) {
      this.mirror = new LiveMirror(state, seq, this.map)
      this.game = state
      this.behindSince = null
      this.events.onStart?.(this.viewOf(state))
      return
    }
    const update = this.mirror.snapshot(state, seq, reset)
    this.game = this.mirror.game
    for (const a of update?.acts ?? []) if (a.nonce) this.unacked.delete(a.nonce)
    if (!this.mirror.behind) this.behindSince = null
    if (update) this.emitLive(update)
  }

  /** A screen that has been missing steps, or waiting for the month's game, for a while asks again. */
  private watchMirror(t: number) {
    // Orders the host has not answered go again. The host makes each only once.
    for (const [nonce, u] of this.unacked) {
      if (t - u.at < RESEND_MS) continue
      u.at = t
      this.send({ t: 'act', from: this.clientId, nonce, order: u.order })
    }
    const mirror = this.mirror!
    if (!mirror.behind) {
      this.behindSince = null
      return
    }
    this.behindSince ??= t
    if (t - this.behindSince < CATCH_UP_MS) return
    if (mirror.needsGame) this.catchUp()
    else this.askForOps()
  }

  private askForOps() {
    const t = this.now()
    if (!this.mirror || t - this.askedOpsAt < CATCH_UP_MS / 4) return
    this.askedOpsAt = t
    this.send({ t: 'need-ops', from: this.clientId, fromSeq: this.mirror.seq })
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
