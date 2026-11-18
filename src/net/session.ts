import { generateAllBotOrders, generateBotOrders } from '../ai/bot'
import { createInitialState } from '../data/startingNations'
import { LIVE } from '../data/live'
import { clockOf } from '../engine/calendar'
import type { LiveStep } from '../engine/live'
import { resolveTurn } from '../engine/resolveTurn'
import type { GameState, NationId, Order, WorldMap } from '../engine/types'
import { liveFingerprint } from './fingerprint'
import { applyCommand, checkCommand, humanOrder, stepRoomDay, votesNeeded } from './liveRoom'
import { decodeState, encodeState, isLiveRoom, MAX_PLAYERS, type ChatMessage, type ClientId, type ClockRequest, type ClockView, type Lobby, type NetMessage, type OpenSeat, type RoomSettings, type StreamItem } from './protocol'
import type { Transport, TransportStatus } from './transport'

/** Heartbeats keep everyone's list of who is here. A player not heard from in this long is treated as gone. */
export const PING_MS = 2500
export const PEER_TIMEOUT_MS = 9000
export const HOST_TIMEOUT_MS = 12000
/**
 * A host that has gone quiet without saying goodbye is replaced at once only by players who can hear most of the room. A screen
 * that hears nobody cannot tell whether the host went or its own line did (the relay notices a dead line only after tens of
 * seconds), so it waits this long before taking over: a phone that lost its signal for half a minute must not come back as a
 * second host with an older game and roll everyone back to it.
 */
export const HOST_GIVE_UP_MS = 45_000
/** A plan is sent again this often, so a message the network dropped costs a few seconds, not the player's month. */
export const RESEND_MS = 6000
/** A screen that finds it is behind asks for the game, but not more often than this. */
const CATCH_UP_MS = 4000
/** A half-received game older than this is thrown away. */
const PIECES_MS = 30_000
/** If the clock jumps this far between two half-second ticks, the page was asleep or the line was down, so what it last heard is stale. */
const SLEEP_GAP_MS = 5000

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
  /** The line to the room dropped or came back. */
  onConnection?(status: TransportStatus): void
  /** The room is already playing: these seats are free for this player to take. */
  onSeats?(seats: OpenSeat[]): void
  /** The host sent this player away. */
  onKicked?(): void
  /** The host sent the room back to the lobby for another game. */
  onRematch?(): void
  /** Live rooms: a day passed on this screen. `step.state` is this screen's copy of the game after it. */
  onDay?(prev: GameState, step: LiveStep): void
  /** Live rooms: an order was taken into the game (anyone's). */
  onOrder?(e: OrderEvent): void
  /** Live rooms: the host answered one of this screen's orders. */
  onAck?(cid: number, ok: boolean, reason: string | undefined, order: Order): void
  /** Live rooms: the shared clock changed. */
  onClock?(clock: ClockView): void
  /** Live rooms: the connection to the shared game changed (lag, a hidden host, a resync). */
  onLive?(status: LiveStatus): void
  /** Live rooms, host only: a friend asked for a clock change the rules leave to the host. */
  onClockRequest?(name: string, req: ClockRequest): void
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

export { humanOrder }

/** Live rooms. A day's worth of the clock is never lost, but the host catches up at most this many days in one go, so a sleeping tab wakes up without lurching. */
export const MAX_DAYS_PER_TICK = 12
/** The most game time the host's clock holds in reserve while its timers are slow (a hidden tab). */
export const MAX_BACKLOG_DAYS = 60
/** A host that was away this long (the computer slept) stops the clock instead of racing to catch up. */
export const ASLEEP_MS = 10 * 60_000
/** The host checks the game against everyone's every this many days. */
export const CHECK_EVERY_DAYS = 10
/** A guest that misses a message waits this long for it before asking for the whole game. */
export const GAP_MS = 1500
/** An order the host has not answered is sent again after this long, and given up on after the second. */
export const CMD_RESEND_MS = 2500
export const CMD_GIVE_UP_MS = 25_000
/** A proposal to pause or change speed lapses after this long without enough votes. */
export const VOTE_MS = 20_000
/** Host orders wait for at most this long, so they do not beat a friend's order sent at the same moment by more than the line allows. */
const MAX_SELF_DELAY_MS = 250
const RESULTS_KEPT = 200

/** What a live screen can say about its connection to the shared game. */
export interface LiveStatus {
  /** The host's tab is in the background: its clock may run in bursts. */
  hostHidden: boolean
  /** Nothing heard from the host for a while. */
  hostAway: boolean
  /** How long a message takes to the host and back, in ms. Null until measured. For the host, the slowest friend's. */
  rttMs: number | null
  /** False while this screen waits for the host's game after a gap or a mismatch. */
  inSync: boolean
  /** Times this screen found itself out of step with the host and fetched the game again. */
  resyncs: number
  /** Orders this screen sent that the host has not answered yet. */
  pending: number
}

/** One order as it happened, for the screen to say so. */
export interface OrderEvent {
  by: ClientId
  nation: NationId
  order: Order
  /** True for this screen's own order. */
  own: boolean
  /** The game after it. */
  state: GameState
  queued: boolean
}

interface Plan {
  turn: number
  orders: Order[]
  ready: boolean
}

interface Claim {
  term: number
  host: ClientId
}

/** The stronger claim to be host: a later term, and between equal terms the lower id, so everyone settles on the same one. */
const beats = (a: Claim, b: Claim) => a.term > b.term || (a.term === b.term && a.host < b.host)

/** A seat that no connected person holds. */
const OPEN_PREFIX = 'open-'

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
  private pieces = new Map<string, { parts: string[]; at: number }>()
  private deadlineAt: number | null = null
  /** Milliseconds left in the month, as last told by the host. Null when there is no timer. */
  remainingMs: number | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastPing = 0
  private lastTick = 0
  private resolving = false
  private lastPeers = ''
  private lastPlan: (Plan & { at: number }) | null = null
  private askedAt = -Infinity
  private helloAt = -Infinity
  private stateSeq = 0
  /** True once the host has said it is leaving, or has come back from a reload with nothing: someone else must take over now. */
  private hostQuit = false
  private offline = false
  closed = false

  // ---- live rooms ----
  /** The shared clock as the host last set it. On a guest, as the host last told it. */
  clock: ClockView = { running: false, speed: 1, by: '', why: 'start' }
  /** Host: game time not yet turned into days, in ms. */
  private acc = 0
  private clockAt = 0
  private hostSeq = 0
  private outbox: StreamItem[] = []
  private votes = new Map<NationId, { req: ClockRequest; at: number; name: string }>()
  private results = new Map<ClientId, Map<number, { ok: boolean; reason?: string }>>()
  private checkedAt = -Infinity
  private selfQueue: { due: number; cid: number; order: Order }[] = []
  private rtts = new Map<ClientId, number>()
  private hidden = false
  /** Guest: the last stream message applied, or -1 before the game has arrived. */
  private lastSeq = -1
  private held = new Map<number, Extract<NetMessage, { t: 'stream' }>>()
  private gapAt = 0
  /** Guest: waiting for the host's game, so stream messages are kept, not applied. */
  private syncing = false
  private dayAt = 0
  private nextCid = 1
  private pendingCmds = new Map<number, { order: Order; at: number; first: number }>()
  private rtt: number | null = null
  private hostHidden = false
  resyncs = 0
  private liveKey = ''
  /** Guest: how far through the day the clock stood when it stopped. */
  private frozen = 0

  constructor(opts: SessionOptions) {
    this.clientId = opts.clientId
    this.transport = opts.transport
    this.name = opts.name
    this.map = opts.map
    this.events = opts.events ?? {}
    this.now = opts.now ?? Date.now
    this.transport.onMessage((m) => void this.receive(m))
    this.transport.onStatus((s) => this.connection(s))
    if (opts.autoTick !== false) this.timer = setInterval(() => this.tick(), 200)
  }

  get isHost() {
    return this.lobby?.host === this.clientId
  }

  /** The nation this screen plays, once one is picked. */
  get me(): NationId | null {
    return this.lobby?.players.find((p) => p.clientId === this.clientId)?.nationId ?? null
  }

  private get term() {
    return this.lobby?.term ?? 1
  }

  /** Whether this room plays on the live clock. */
  get liveRoom(): boolean {
    return !!this.lobby && isLiveRoom(this.lobby.settings)
  }

  private send(msg: NetMessage) {
    if (!this.closed) this.transport.send(msg)
  }

  // ---- connection ----

  /** The line dropped or came back. Coming back, this screen may have missed anything, so it says hello and the host sends the game again. */
  private connection(status: TransportStatus) {
    this.events.onConnection?.(status)
    if (this.closed) return
    if (status === 'reconnecting') {
      this.offline = true
      return
    }
    if (status === 'connected' && this.offline) {
      this.offline = false
      this.forgive(this.now())
      if (!this.lobby) return
      if (this.isHost) this.broadcastLobby()
      else {
        // A live game moved on while this screen heard nothing: what it holds is stale, and the host's answer to hello brings the game.
        if (this.liveRoom && this.lobby.phase === 'playing') this.startSync()
        for (const p of this.pendingCmds.values()) p.at = -Infinity
        this.send({ t: 'hello', from: this.clientId, name: this.name })
        const plan = this.lastPlan
        if (plan && this.game && plan.turn === this.game.turn) {
          plan.at = this.now()
          this.send({ t: 'orders', from: this.clientId, turn: plan.turn, orders: plan.orders, ready: plan.ready })
        }
      }
    }
  }

  /** After a sleep or a dropped line, what this screen last heard from others is old, not proof that they left. */
  private forgive(t: number) {
    for (const id of this.seen.keys()) this.seen.set(id, t)
  }

  // ---- lobby ----

  /** Opens a room with this screen as the host. */
  createRoom(code: string, settings: RoomSettings) {
    this.lobby = { code, host: this.clientId, settings, players: [{ clientId: this.clientId, name: this.name, nationId: null }], phase: 'lobby', term: 1 }
    this.seen.set(this.clientId, this.now())
    this.broadcastLobby()
    this.events.onHost?.(true)
  }

  /**
   * Opens a room again from a game this screen saved. This screen is the host of a running game; `seat` is the nation it plays.
   * Everyone else's seats start empty and are taken back as they join with the room code.
   */
  resumeRoom(saved: Lobby, game: GameState, seat: NationId): string | null {
    const mine = saved.players.find((p) => p.nationId === seat)
    if (!mine || !game.humans.includes(seat)) return 'That seat is not in the saved game'
    const players = saved.players.map((p) => (p === mine ? { ...p, clientId: this.clientId, name: this.name } : { ...p, clientId: `${OPEN_PREFIX}${p.nationId ?? p.clientId}` }))
    this.lobby = { ...saved, players, host: this.clientId, phase: 'playing', term: (saved.term ?? 1) + 1 }
    this.game = game
    this.plans.clear()
    this.seen.set(this.clientId, this.now())
    this.armTimer()
    this.broadcastLobby()
    this.events.onHost?.(true)
    if (this.liveRoom) this.beginLive()
    this.events.onStart?.(this.viewOf(game))
    this.emitReady()
    return null
  }

  /** Asks to join a room. The host answers with the lobby. */
  joinRoom() {
    this.send({ t: 'hello', from: this.clientId, name: this.name })
  }

  /** In a room that is already playing, takes one of the free seats. */
  takeSeat(nationId: NationId) {
    this.send({ t: 'take-seat', from: this.clientId, nationId, name: this.name })
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
    const live = isLiveRoom(lobby.settings)
    const state = createInitialState(this.map, { playerRegionId: ids[0], humans: ids, seed: lobby.settings.seed, victoryShare: lobby.settings.victoryShare, goal: lobby.settings.goal ?? 'world', difficulty: lobby.settings.difficulty, online: true, ...(live ? { mode: 'live' as const } : {}) })
    lobby.phase = 'playing'
    this.game = state
    this.plans.clear()
    this.armTimer()
    if (live) this.beginLive()
    this.broadcastLobby()
    await this.broadcastState()
    this.events.onStart?.(this.viewOf(state))
    this.emitReady()
    return null
  }

  /** Host: sends the room back to the lobby with the same players, ready to pick again and start a new game. */
  rematch() {
    const lobby = this.lobby
    if (!this.isHost || !lobby || lobby.phase !== 'playing') return
    this.game = null
    this.plans.clear()
    this.deadlineAt = null
    this.remainingMs = null
    this.resetLive()
    // Players who left in the meantime are dropped, and the world is new.
    const players = lobby.players.filter((p) => !p.clientId.startsWith(OPEN_PREFIX))
    this.lobby = { ...lobby, phase: 'lobby', players, settings: { ...lobby.settings, seed: Math.floor((lobby.settings.seed * 16807 + 12345) % 1_000_000) } }
    this.broadcastLobby()
    this.events.onRematch?.()
  }

  /** Host: sends a player away. In the lobby they are removed; in a game their seat is left free for the AI, or for someone new. */
  kick(target: ClientId) {
    const lobby = this.lobby
    if (!this.isHost || !lobby || target === this.clientId) return
    const p = lobby.players.find((x) => x.clientId === target)
    if (!p) return
    this.send({ t: 'kick', from: this.clientId, target })
    this.seen.delete(target)
    if (lobby.phase === 'lobby') this.lobby = { ...lobby, players: lobby.players.filter((x) => x.clientId !== target) }
    else this.lobby = { ...lobby, players: lobby.players.map((x) => (x === p ? { ...x, clientId: `${OPEN_PREFIX}${x.nationId ?? x.clientId}`, name: `${x.name} (left)` } : x)) }
    this.broadcastLobby()
    this.checkResolve()
    this.syncAi()
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
    if (!game || !p?.nationId || game.outcome !== 'playing') return
    // A plan for another month means that screen is behind: say where the game is, and it will ask for it.
    if (turn !== game.turn) {
      this.emitReady()
      return
    }
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
    if (this.liveRoom) return
    const ready = this.readyNations()
    const remaining = this.deadlineAt === null ? null : Math.max(0, this.deadlineAt - this.now())
    this.remainingMs = remaining
    this.events.onReady?.(ready, remaining)
    if (this.isHost) this.send({ t: 'ready', from: this.clientId, turn: this.game?.turn ?? 0, ready, remainingMs: remaining })
  }

  private checkResolve() {
    if (!this.isHost || !this.game || this.game.outcome !== 'playing' || this.resolving || this.liveRoom) return
    const waiting = this.humansHere().filter((h) => this.connected(h.clientId) && !(this.plans.get(h.nationId)?.ready && this.plans.get(h.nationId)?.turn === this.game!.turn))
    if (waiting.length === 0) void this.resolve()
  }

  private armTimer() {
    const seconds = this.liveRoom ? 0 : (this.lobby?.settings.timer ?? 0)
    this.deadlineAt = seconds > 0 ? this.now() + seconds * 1000 : null
  }

  /** Host: plays the month. Anyone who has not sent a plan stays idle, unless they have left, and then the AI plays for them. */
  async resolve() {
    const game = this.game
    if (!this.isHost || !game || game.outcome !== 'playing' || this.resolving || this.liveRoom) return
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

  /** Sends the game in pieces, to everyone or to the one screen that asked. */
  private async broadcastState(to?: ClientId) {
    const game = this.game
    if (!game) return
    // A live game keeps moving while the game is squeezed, so where the host's stream stood is fixed before waiting.
    const live = this.liveRoom ? { liveSeq: this.hostSeq, clock: this.clockView() } : {}
    const parts = await encodeState(game)
    const id = `${game.turn}-${this.now().toString(36)}-${this.stateSeq++}`
    const remainingMs = this.deadlineAt === null ? null : Math.max(0, this.deadlineAt - this.now())
    parts.forEach((data, part) => this.send({ t: 'state', from: this.clientId, id, part, parts: parts.length, data, turn: game.turn, remainingMs, hostTerm: this.term, ...(to ? { to } : {}), ...live }))
  }

  /** This screen's copy of a game: the same, but `playerId` says whose screen it is. */
  private viewOf(state: GameState): GameState {
    const me = this.me
    return me ? { ...state, playerId: me } : state
  }

  // ---- live rooms ----

  /** Host: a live game is about to begin (or begin again from a save). The clock starts stopped, so nobody is caught out. */
  private beginLive() {
    this.hostSeq = 0
    this.outbox = []
    this.acc = 0
    this.clockAt = this.now()
    this.votes.clear()
    this.results.clear()
    this.selfQueue = []
    this.checkedAt = -Infinity
    this.syncing = false
    this.clock = { running: false, speed: this.lobby?.settings.liveSpeed ?? 1, by: '', why: 'start' }
    this.events.onClock?.(this.clockView())
  }

  /** Everything a live game keeps about itself, dropped, for a rematch. */
  private resetLive() {
    this.lastSeq = -1
    this.held.clear()
    this.syncing = false
    this.pendingCmds.clear()
    this.outbox = []
    this.selfQueue = []
    this.votes.clear()
    this.results.clear()
    this.acc = 0
    this.hostSeq = 0
    this.clock = { running: false, speed: 1, by: '', why: 'start' }
  }

  /** Guest: what this screen holds is not to be trusted. Messages from the host are kept until its game arrives. */
  private startSync() {
    this.syncing = true
    this.lastSeq = -1
    this.gapAt = 0
    this.askedAt = -Infinity
  }

  /** This screen found it is out of step with the host: it fetches the game again. */
  private desync() {
    if (this.syncing) return
    this.resyncs++
    this.startSync()
    this.catchUp()
    this.emitLive(true)
  }

  /** The shared clock as screens show it, with any proposal still short of votes. */
  clockView(): ClockView {
    const votes = [...this.votes.values()]
    const vote = votes.length ? { req: votes[0].req, by: votes.map((v) => v.name), need: votesNeeded(this.hereCount()) } : null
    return { ...this.clock, vote }
  }

  /** Players of the game who are here now. */
  private hereCount(): number {
    const game = this.game
    return this.humansHere().filter((h) => this.connected(h.clientId) && !game?.eliminated.includes(h.nationId)).length
  }

  private push(...items: StreamItem[]) {
    this.outbox.push(...items)
  }

  /** Host: sends what happened since the last message, as one message, numbered. */
  private flush() {
    if (!this.outbox.length) return
    const items = this.outbox
    this.outbox = []
    this.send({ t: 'stream', from: this.clientId, term: this.term, seq: ++this.hostSeq, items })
  }

  private pushClock() {
    const view = this.clockView()
    this.push({ k: 'clock', clock: view })
    this.events.onClock?.(view)
    this.emitLive(true)
  }

  private setClock(patch: Partial<ClockView>) {
    this.clock = { ...this.clock, ...patch }
    this.pushClock()
    this.flush()
  }

  // -- orders --

  /**
   * Sends this player's order to the host, which is the only one that puts it into the game. Returns the order's number, or why it
   * cannot be sent. The answer arrives in `onAck`; the order itself arrives in the game with the host's next message.
   */
  sendCommand(order: Order): { cid: number; error: string | null } {
    const game = this.game
    if (!this.liveRoom || !game || !this.me) return { cid: 0, error: 'There is no live game to send that to' }
    if (order.nationId !== this.me) return { cid: 0, error: 'That order is for another nation' }
    const bad = checkCommand(game, this.map, order)
    if (bad) return { cid: 0, error: bad }
    const cid = this.nextCid++
    const t = this.now()
    this.pendingCmds.set(cid, { order, at: t, first: t })
    if (this.isHost) {
      const delay = this.selfDelay()
      if (delay > 0) this.selfQueue.push({ due: t + delay, cid, order })
      else this.hostCommand(this.clientId, cid, order)
    } else this.send({ t: 'cmd', from: this.clientId, cid, order })
    this.emitLive()
    return { cid, error: null }
  }

  /** The host lets its own orders wait about as long as the slowest friend's take to arrive, so being the host is not an edge. */
  private selfDelay(): number {
    let worst = 0
    for (const [id, r] of this.rtts) if (this.connected(id)) worst = Math.max(worst, r)
    return worst >= 60 ? Math.min(MAX_SELF_DELAY_MS, Math.round(worst / 2)) : 0
  }

  private remember(from: ClientId, cid: number, result: { ok: boolean; reason?: string }) {
    let mine = this.results.get(from)
    if (!mine) this.results.set(from, (mine = new Map()))
    mine.set(cid, result)
    if (mine.size > RESULTS_KEPT) mine.delete(mine.keys().next().value as number)
  }

  private ack(to: ClientId, cid: number, ok: boolean, reason?: string) {
    if (to === this.clientId) this.handleAck(cid, ok, reason)
    else this.send({ t: 'ack', from: this.clientId, to, cid, ok, ...(reason ? { reason } : {}) })
  }

  private handleAck(cid: number, ok: boolean, reason?: string) {
    const p = this.pendingCmds.get(cid)
    if (!p) return
    this.pendingCmds.delete(cid)
    this.events.onAck?.(cid, ok, reason, p.order)
    this.emitLive()
  }

  /** Host: one player's order. It is checked against the game as it is now, and taken in or turned down with a reason. */
  private hostCommand(from: ClientId, cid: number, order: Order) {
    const game = this.game
    const lobby = this.lobby
    if (!this.isHost || !game || !lobby || !this.liveRoom || lobby.phase !== 'playing') return
    const done = this.results.get(from)?.get(cid)
    if (done) return this.ack(from, cid, done.ok, done.reason)
    const p = lobby.players.find((x) => x.clientId === from)
    let result: { ok: boolean; reason?: string }
    if (!p?.nationId) result = { ok: false, reason: 'You do not have a nation in this game' }
    else if (!order || order.nationId !== p.nationId) result = { ok: false, reason: 'That order is for another nation' }
    else {
      const r = applyCommand(game, this.map, order)
      if (r.error) result = { ok: false, reason: r.error }
      else {
        this.game = r.state
        this.push({ k: 'cmd', by: from, cid, order })
        this.events.onOrder?.({ by: from, nation: p.nationId, order, own: from === this.clientId, state: this.viewOf(r.state), queued: !!r.queued })
        result = { ok: true }
      }
    }
    this.remember(from, cid, result)
    this.flush()
    this.ack(from, cid, result.ok, result.reason)
  }

  // -- the clock --

  /** Asks to pause, resume or change the speed. The rules of the room decide who gets it. */
  controlClock(req: ClockRequest) {
    if (!this.liveRoom || !this.game) return
    if (this.isHost) this.handleClockRequest(this.clientId, req)
    else this.send({ t: 'clock-req', from: this.clientId, req })
  }

  private handleClockRequest(from: ClientId, req: ClockRequest) {
    const game = this.game
    const lobby = this.lobby
    if (!this.isHost || !game || !lobby || !this.liveRoom || game.outcome !== 'playing') return
    const p = lobby.players.find((x) => x.clientId === from)
    if (!p?.nationId || !game.humans.includes(p.nationId) || !req) return
    if (req.kind === 'speed' ? ![1, 2, 4].includes(req.speed) : req.kind !== 'pause' && req.kind !== 'resume') return
    // Asking for what already is does nothing.
    if ((req.kind === 'pause' && !this.clock.running) || (req.kind === 'resume' && this.clock.running) || (req.kind === 'speed' && req.speed === this.clock.speed)) return
    if ((lobby.settings.liveControl ?? 'host') === 'host') {
      if (from === this.clientId) this.applyClock(req, p.name)
      else this.events.onClockRequest?.(p.name, req)
      return
    }
    const key = (r: ClockRequest) => (r.kind === 'speed' ? `speed${r.speed}` : r.kind)
    // A new proposal replaces one that is still open.
    for (const [id, v] of this.votes) if (key(v.req) !== key(req)) this.votes.delete(id)
    this.votes.set(p.nationId, { req, at: this.now(), name: p.name })
    const agreed = [...this.votes.values()].filter((v) => key(v.req) === key(req)).length
    if (agreed >= votesNeeded(this.hereCount())) this.applyClock(req, [...this.votes.values()].map((v) => v.name).join(' and '))
    else {
      this.pushClock()
      this.flush()
    }
  }

  private applyClock(req: ClockRequest, by: string) {
    this.votes.clear()
    if (req.kind === 'speed') this.clock = { ...this.clock, speed: req.speed, by }
    else {
      // A clock set going counts time from this moment, not from the last time it was looked at.
      if (req.kind === 'resume') this.clockAt = this.now()
      this.clock = { running: req.kind === 'resume', speed: this.clock.speed, by }
    }
    this.pushClock()
    this.flush()
  }

  /** Called by the screen when its tab is hidden or shown. A hidden host's timers slow down, so its friends are told. */
  setHidden(hidden: boolean) {
    if (this.hidden === hidden) return
    this.hidden = hidden
    this.lastPing = -Infinity
    if (this.liveRoom && this.lobby && !this.closed) this.tick()
  }

  /** How far through the current day the shared clock is, from 0 to just under 1. Screens draw armies from this. */
  dayFraction(): number {
    if (this.isHost) return Math.min(0.999, this.acc / LIVE.msPerDay)
    if (!this.clock.running || this.syncing) return this.frozen
    return Math.min(0.999, ((this.now() - this.dayAt) * this.clock.speed) / LIVE.msPerDay)
  }

  /** The clock's speed and whether it runs, as the screens show it. */
  get running() {
    return this.clock.running
  }

  // -- the host's clock --

  /** Host: every tick turns the time that has passed into days. A tick that comes late (a hidden tab) turns all the time it missed into days, a few at a time. */
  private liveTick(t: number) {
    if (!this.game || this.lobby?.phase !== 'playing') return
    if (!this.isHost) return this.guestTick(t)
    const dt = Math.max(0, t - this.clockAt)
    this.clockAt = t
    if (this.selfQueue.length) {
      const due = this.selfQueue.filter((q) => q.due <= t)
      this.selfQueue = this.selfQueue.filter((q) => q.due > t)
      for (const q of due) this.hostCommand(this.clientId, q.cid, q.order)
    }
    if (this.votes.size && [...this.votes.values()].every((v) => t - v.at > VOTE_MS)) {
      this.votes.clear()
      this.pushClock()
      this.flush()
    }
    this.syncAi()
    const game = this.game!
    if (game.outcome !== 'playing') {
      if (this.clock.running) this.setClock({ running: false, why: 'over' })
      return
    }
    if (!this.clock.running) return this.emitLive()
    if (dt > ASLEEP_MS) {
      this.setClock({ running: false, why: 'asleep', by: 'the host' })
      return
    }
    this.acc = Math.min(this.acc + dt * this.clock.speed, LIVE.msPerDay * MAX_BACKLOG_DAYS)
    let n = 0
    while (this.acc >= LIVE.msPerDay && n < MAX_DAYS_PER_TICK) {
      this.acc -= LIVE.msPerDay
      n++
    }
    if (n) this.hostDays(n)
    this.emitLive()
  }

  /** Host: plays `n` days, and tells everyone. */
  private hostDays(n: number) {
    let stepped = 0
    let monthEnded = false
    for (let i = 0; i < n; i++) {
      const prev = this.game
      if (!prev || prev.outcome !== 'playing') break
      const step = stepRoomDay(prev, this.map)
      this.game = step.state
      stepped++
      monthEnded ||= step.monthEnded
      this.events.onDay?.(this.viewOf(prev), { ...step, state: this.viewOf(step.state) })
    }
    if (!stepped || !this.game) return
    this.push({ k: 'day', n: stepped })
    const at = clockOf(this.game)
    if (monthEnded || at - this.checkedAt >= CHECK_EVERY_DAYS) {
      this.checkedAt = at
      this.push({ k: 'fp', at, fp: liveFingerprint(this.game) })
    }
    this.flush()
    if (this.game.outcome !== 'playing') this.setClock({ running: false, why: 'over' })
  }

  /** Host: the nations whose players are away are played by the AI from the next month's turn. */
  private syncAi() {
    const game = this.game
    const lobby = this.lobby
    if (!this.isHost || !game || !lobby || !this.liveRoom || lobby.phase !== 'playing') return
    const ids = lobby.players
      .filter((p): p is typeof p & { nationId: NationId } => !!p.nationId && game.humans.includes(p.nationId) && !game.eliminated.includes(p.nationId) && !this.connected(p.clientId))
      .map((p) => p.nationId)
      .sort()
    if (ids.join(',') === (game.liveAi ?? []).join(',')) return
    this.game = { ...game, liveAi: ids }
    this.push({ k: 'ai', ids })
    this.flush()
  }

  // -- the guest's side --

  private guestTick(t: number) {
    if (this.syncing) this.catchUp()
    else if (this.held.size && this.gapAt && t - this.gapAt > GAP_MS) this.desync()
    for (const [cid, p] of this.pendingCmds) {
      if (t - p.first > CMD_GIVE_UP_MS) {
        this.pendingCmds.delete(cid)
        this.events.onAck?.(cid, false, 'The host did not answer. Check the connection.', p.order)
      } else if (t - p.at >= CMD_RESEND_MS) {
        p.at = t
        this.send({ t: 'cmd', from: this.clientId, cid, order: p.order })
      }
    }
    this.emitLive()
  }

  private handleStream(msg: Extract<NetMessage, { t: 'stream' }>) {
    if (this.isHost || !this.lobby || !this.liveRoom || msg.from !== this.lobby.host || msg.term !== this.term) return
    if (!this.syncing && this.lastSeq >= 0 && msg.seq <= this.lastSeq) return
    this.held.set(msg.seq, msg)
    // A game that has not arrived yet, or is being fetched again, only collects.
    if (this.syncing || this.lastSeq < 0) {
      if (this.held.size > 600) this.held.delete(Math.min(...this.held.keys()))
      return
    }
    this.drain()
  }

  /** Applies the host's messages in order, as far as they are all here. A hole waits a moment for the missing one. */
  private drain() {
    while (!this.syncing && this.lastSeq >= 0) {
      for (const k of this.held.keys()) if (k <= this.lastSeq) this.held.delete(k)
      const next = this.held.get(this.lastSeq + 1)
      if (!next) break
      this.held.delete(next.seq)
      this.lastSeq = next.seq
      this.dayAt = this.now()
      for (const item of next.items) {
        this.applyItem(item)
        if (this.syncing) return
      }
    }
    this.gapAt = this.held.size ? this.gapAt || this.now() : 0
  }

  private applyItem(item: StreamItem) {
    const game = this.game
    if (!game) return
    switch (item.k) {
      case 'day':
        for (let i = 0; i < item.n; i++) {
          const prev = this.game
          if (!prev || prev.outcome !== 'playing') break
          const step = stepRoomDay(prev, this.map)
          this.game = step.state
          this.events.onDay?.(this.viewOf(prev), { ...step, state: this.viewOf(step.state) })
        }
        return
      case 'cmd': {
        const r = applyCommand(game, this.map, item.order)
        // The host took an order this screen cannot: the two games have already parted.
        if (r.error) return this.desync()
        this.game = r.state
        this.remember(item.by, item.cid, { ok: true })
        this.events.onOrder?.({ by: item.by, nation: item.order.nationId, order: item.order, own: item.by === this.clientId, state: this.viewOf(r.state), queued: !!r.queued })
        return
      }
      case 'clock':
        if (this.clock.running && !item.clock.running) this.frozen = this.dayFraction()
        this.clock = { running: item.clock.running, speed: item.clock.speed, by: item.clock.by, ...(item.clock.why ? { why: item.clock.why } : {}), vote: item.clock.vote ?? null }
        this.dayAt = this.now()
        this.events.onClock?.(this.clock)
        this.emitLive(true)
        return
      case 'ai':
        this.game = { ...game, liveAi: item.ids }
        return
      case 'fp':
        if (clockOf(game) === item.at && liveFingerprint(game) !== item.fp) this.desync()
    }
  }

  // -- how the line is doing --

  /** What the screen shows about the connection to the shared game. */
  liveStatus(): LiveStatus {
    const t = this.now()
    const seen = this.lobby ? this.seen.get(this.lobby.host) : undefined
    let worst: number | null = null
    if (this.isHost) for (const [id, r] of this.rtts) if (this.connected(id)) worst = Math.max(worst ?? 0, r)
    return {
      hostHidden: !this.isHost && this.hostHidden,
      hostAway: !this.isHost && seen !== undefined && t - seen > 6000,
      rttMs: this.isHost ? worst : this.rtt === null ? null : Math.round(this.rtt),
      inSync: this.isHost || (!this.syncing && this.lastSeq >= 0),
      resyncs: this.resyncs,
      pending: this.pendingCmds.size,
    }
  }

  private emitLive(force = false) {
    if (!this.events.onLive) return
    const s = this.liveStatus()
    const key = `${s.hostHidden}|${s.hostAway}|${s.rttMs === null ? '' : Math.round(s.rttMs / 20)}|${s.inSync}|${s.resyncs}|${s.pending}`
    if (key === this.liveKey && !force) return
    this.liveKey = key
    this.events.onLive(s)
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
        if (msg.from === this.lobby?.host) this.hostHidden = !!msg.hidden
        if (this.isHost && msg.ts !== undefined) {
          this.send({ t: 'pong', from: this.clientId, to: msg.from, ts: msg.ts })
          if (msg.rtt !== undefined) this.rtts.set(msg.from, msg.rtt)
        }
        return this.checkRival(msg.host, msg.term)
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
        return this.handleLobby(msg.from, msg.lobby)
      case 'ready':
        if (!this.isHost) {
          // The host is on a later month than this screen: a state message was lost.
          if (this.game && msg.turn > this.game.turn) this.catchUp()
          // A ready list from an earlier month can arrive after the new month's state: it must not light the dots again.
          else if (!this.game || msg.turn === this.game.turn) this.events.onReady?.(msg.ready, msg.remainingMs)
        }
        this.remainingMs = msg.remainingMs
        return
      case 'state':
        return this.handleStatePiece(msg)
      case 'need-state':
        if (this.isHost) await this.broadcastState(msg.from)
        return
      case 'chat':
        this.events.onChat?.({ from: msg.from, name: msg.name, text: msg.text, at: msg.at })
        return
      case 'claim-host':
        return this.handleClaim(msg.from, msg.term)
      case 'kick':
        if (msg.target === this.clientId && msg.from === this.lobby?.host) {
          this.events.onKicked?.()
          this.close()
        }
        return
      case 'seats':
        if (msg.to === this.clientId) this.events.onSeats?.(msg.seats)
        return
      case 'take-seat':
        if (this.isHost) this.handleTakeSeat(msg.from, msg.name, msg.nationId)
        return
      case 'stream':
        return this.handleStream(msg)
      case 'cmd':
        if (this.isHost) this.hostCommand(msg.from, msg.cid, msg.order)
        return
      case 'ack':
        if (msg.to === this.clientId) this.handleAck(msg.cid, msg.ok, msg.reason)
        return
      case 'clock-req':
        if (this.isHost) this.handleClockRequest(msg.from, msg.req)
        return
      case 'pong':
        if (msg.to === this.clientId) this.rtt = this.rtt === null ? this.now() - msg.ts : this.rtt * 0.7 + (this.now() - msg.ts) * 0.3
        return
    }
  }

  /** A lobby counts only from the host it names, and only if that host's claim is the strongest this screen has heard. */
  private handleLobby(from: ClientId, next: Lobby) {
    if (next.host !== from) return
    const cur = this.lobby
    if (cur) {
      const theirs = { term: next.term ?? 1, host: next.host }
      const mine = { term: this.term, host: cur.host }
      const same = theirs.term === mine.term && theirs.host === mine.host
      if (!same && !beats(theirs, mine)) {
        // This screen holds the stronger claim: tell the other one.
        if (this.isHost) this.broadcastLobby()
        return
      }
      if (!same) this.adoptHost()
    }
    const wasPlaying = cur?.phase === 'playing'
    this.lobby = next
    if (wasPlaying && next.phase === 'lobby') {
      this.game = null
      this.plans.clear()
      this.resetLive()
      this.events.onRematch?.()
    }
    this.events.onLobby?.(next)
    this.events.onHost?.(this.isHost)
  }

  /** Someone else is host now: stop acting as one, and forget the old host's departure. */
  private adoptHost() {
    this.hostQuit = false
    if (this.isHost) {
      this.plans.clear()
      this.deadlineAt = null
      this.outbox = []
      this.selfQueue = []
    }
    // The new host's game is the one to follow: nothing of the old host's stream counts any more.
    if (this.liveRoom && this.lobby?.phase === 'playing') this.startSync()
    this.requestState()
  }

  /** A heartbeat names who its sender thinks the host is. When that is a stronger claim than this screen's, follow it. */
  private checkRival(host: ClientId | null, term: number) {
    const cur = this.lobby
    if (!cur || !host) return
    if (host === cur.host && term === this.term) return
    if (beats({ term, host }, { term: this.term, host: cur.host })) {
      // Asking again brings the stronger host's lobby, which carries the players and the rules.
      const t = this.now()
      if (t - this.helloAt >= CATCH_UP_MS) {
        this.helloAt = t
        this.send({ t: 'hello', from: this.clientId, name: this.name })
      }
    } else if (this.isHost) this.broadcastLobby()
  }

  private isHostClaim(from: ClientId) {
    return this.lobby?.players.some((p) => p.clientId === from) ?? false
  }

  private handleHello(from: ClientId, name: string) {
    this.names.set(from, name)
    const lobby = this.lobby
    // The host's own screen says hello only when it has just opened with nothing: it reloaded, so someone else must run the room.
    if (lobby && !this.isHost && from === lobby.host) {
      this.hostQuit = true
      return
    }
    if (!this.isHost || !lobby) return
    const known = lobby.players.find((p) => p.clientId === from)
    if (known) {
      known.name = name
    } else if (lobby.phase === 'lobby' && lobby.players.length < MAX_PLAYERS) {
      lobby.players.push({ clientId: from, name, nationId: null })
    } else if (lobby.phase === 'playing') {
      this.offerSeats(from, name)
      return
    } else {
      this.events.onError?.(`${name} tried to join, but the room is full.`)
      return
    }
    this.broadcastLobby()
    // Someone coming back to a running game gets the game, and where the month stands.
    if (lobby.phase === 'playing') {
      this.syncAi()
      void this.broadcastState(from)
      this.emitReady()
    }
  }

  /** The seats of a running game that nobody is sitting in right now. */
  private openSeats(): OpenSeat[] {
    const game = this.game
    if (!game || !this.lobby) return []
    return this.lobby.players
      .filter((p): p is typeof p & { nationId: NationId } => !!p.nationId && game.humans.includes(p.nationId) && !game.eliminated.includes(p.nationId) && !this.connected(p.clientId))
      .map((p) => ({ nationId: p.nationId, name: p.name }))
  }

  private offerSeats(from: ClientId, name: string) {
    const seats = this.openSeats()
    this.send({ t: 'seats', from: this.clientId, to: from, seats })
    if (!seats.length) this.events.onError?.(`${name} tried to join, but every seat in the game is taken.`)
  }

  private handleTakeSeat(from: ClientId, name: string, nationId: NationId) {
    const lobby = this.lobby
    if (!lobby || lobby.phase !== 'playing') return
    const seat = lobby.players.find((p) => p.nationId === nationId)
    if (!seat || !this.openSeats().some((o) => o.nationId === nationId)) {
      this.offerSeats(from, name)
      return
    }
    // Someone with a seat already cannot take a second.
    if (lobby.players.some((p) => p.clientId === from)) return
    seat.clientId = from
    seat.name = name
    this.seen.set(from, this.now())
    this.broadcastLobby()
    this.syncAi()
    void this.broadcastState(from)
    this.emitReady()
  }

  private handleLeave(from: ClientId) {
    this.seen.delete(from)
    const lobby = this.lobby
    if (!lobby) return
    if (lobby.phase === 'lobby') {
      this.lobby = { ...lobby, players: lobby.players.filter((p) => p.clientId !== from) }
      if (this.isHost) this.broadcastLobby()
      else this.events.onLobby?.(this.lobby)
    } else if (this.isHost) {
      // A running game keeps the seat: the AI plays it while they are away, and they can come back.
      this.checkResolve()
    }
    if (from === lobby.host && !this.isHost) this.hostQuit = true
  }

  private async handleStatePiece(msg: Extract<NetMessage, { t: 'state' }>) {
    if (this.isHost) return
    if (msg.to && msg.to !== this.clientId) return
    // A game from a host that has been replaced is not this room's game any more.
    if (this.lobby && (msg.hostTerm < this.term || msg.from !== this.lobby.host)) return
    const entry = this.pieces.get(msg.id) ?? { parts: [], at: this.now() }
    entry.parts[msg.part] = msg.data
    this.pieces.set(msg.id, entry)
    if (entry.parts.filter(Boolean).length < msg.parts) return
    this.pieces.delete(msg.id)
    const live = msg.liveSeq !== undefined
    // A newer copy has arrived while this one was assembling.
    if (!live && this.game && msg.turn < this.game.turn) return
    if (live && !this.syncing && this.lastSeq >= 0 && msg.liveSeq! <= this.lastSeq) return
    let state: GameState
    try {
      state = await decodeState(entry.parts)
    } catch {
      this.catchUp()
      return
    }
    const prev = this.game
    if (live) {
      // The game took a while to unpack: a newer one may have been adopted meanwhile.
      if (!this.syncing && this.lastSeq >= 0 && msg.liveSeq! <= this.lastSeq) return
      this.game = state
      this.lastSeq = msg.liveSeq!
      this.syncing = false
      this.gapAt = 0
      this.dayAt = this.now()
      if (msg.clock) this.clock = msg.clock
      this.drain()
      this.events.onStart?.(this.viewOf(this.game!))
      this.events.onClock?.(this.clock)
      this.emitLive(true)
      return
    }
    this.game = state
    this.remainingMs = msg.remainingMs
    if (prev && prev.turn < state.turn) {
      this.events.onState?.(this.viewOf(prev), this.viewOf(state))
      // A new month starts with nobody ready. The host's own ready list for it may have come before this state and been set aside.
      this.events.onReady?.([], msg.remainingMs)
    } else this.events.onStart?.(this.viewOf(state))
  }

  private handleClaim(from: ClientId, term: number) {
    const cur = this.lobby
    if (!cur || !this.isHostClaim(from)) return
    if (!beats({ term, host: from }, { term: this.term, host: cur.host })) {
      if (this.isHost) this.broadcastLobby()
      return
    }
    this.adoptHost()
    this.lobby = { ...cur, host: from, term }
    this.events.onLobby?.(this.lobby)
    this.events.onHost?.(this.isHost)
    this.events.onResubmit?.()
    for (const p of this.pendingCmds.values()) p.at = -Infinity
  }

  /** Called every 200 ms: heartbeats, the month timer, and taking over when the host disappears. */
  tick() {
    if (this.closed) return
    const t = this.now()
    if (this.lastTick && t - this.lastTick > SLEEP_GAP_MS) this.forgive(t)
    this.lastTick = t
    if (t - this.lastPing >= PING_MS) {
      this.lastPing = t
      this.send({ t: 'ping', from: this.clientId, name: this.name, host: this.lobby?.host ?? null, term: this.term, ...(this.liveRoom ? { ts: t, ...(this.rtt !== null ? { rtt: Math.round(this.rtt) } : {}), hidden: this.hidden } : {}) })
    }
    const here = [...this.seen.keys()].filter((id) => this.connected(id)).sort()
    const key = here.join(',')
    if (key !== this.lastPeers) {
      this.lastPeers = key
      this.events.onPeers?.(here)
    }
    for (const [id, entry] of this.pieces) if (t - entry.at > PIECES_MS) this.pieces.delete(id)
    if (!this.lobby) return
    // A room that is playing and no game here yet. The host sends it right after the lobby, so by the next tick it is overdue: ask.
    if (this.lobby.phase === 'playing' && !this.game && !this.isHost) this.catchUp()
    if (this.liveRoom) {
      this.liveTick(t)
      if (this.isHost) return
    } else if (this.isHost) {
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
    if (this.hostIsGone(t)) this.electIfFirst()
  }

  /** The host said it was leaving, or has gone quiet for too long: long enough, or for long enough with most of the room still here. */
  private hostIsGone(t: number): boolean {
    if (this.hostQuit) return true
    const lobby = this.lobby
    const seen = lobby ? this.seen.get(lobby.host) : undefined
    if (!lobby || seen === undefined) return false
    const quiet = t - seen
    if (quiet > HOST_GIVE_UP_MS) return true
    if (quiet <= HOST_TIMEOUT_MS) return false
    const players = lobby.players.filter((p) => !p.clientId.startsWith(OPEN_PREFIX))
    const here = players.filter((p) => p.clientId !== lobby.host && this.connected(p.clientId)).length
    return here * 2 > players.length
  }

  /**
   * The first player still here takes over, with the latest game this screen holds. A screen whose own line is down never does,
   * since it would see nobody and crown itself.
   */
  private electIfFirst() {
    const lobby = this.lobby
    if (!lobby || this.isHost || this.transport.status !== 'connected') return
    // The browser knows its network is gone before the relay does.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    if (lobby.phase === 'playing' && !this.game) return
    const candidates = lobby.players.map((p) => p.clientId).filter((id) => id !== lobby.host && !id.startsWith(OPEN_PREFIX) && this.connected(id)).sort()
    if (candidates[0] === this.clientId) this.becomeHost()
  }

  private becomeHost() {
    const lobby = this.lobby
    if (!lobby) return
    const term = this.term + 1
    this.lobby = { ...lobby, host: this.clientId, term }
    this.hostQuit = false
    this.plans.clear()
    this.armTimer()
    this.send({ t: 'claim-host', from: this.clientId, term })
    this.broadcastLobby()
    this.events.onHost?.(true)
    this.events.onResubmit?.()
    this.emitReady()
    // A live game goes on from this screen's copy, at the speed it was running. Everyone is sent that copy, so all screens agree on where it stands.
    if (this.liveRoom && this.game) {
      this.hostSeq = 0
      this.outbox = []
      this.held.clear()
      this.syncing = false
      this.clockAt = this.now()
      this.acc = 0
        this.syncAi()
      void this.broadcastState()
    }
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
