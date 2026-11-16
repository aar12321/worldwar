import { generateAllBotOrders, generateBotOrders } from '../ai/bot'
import { createInitialState } from '../data/startingNations'
import { resolveTurn } from '../engine/resolveTurn'
import type { GameState, NationId, Order, WorldMap } from '../engine/types'
import { decodeState, encodeState, MAX_PLAYERS, type ChatMessage, type ClientId, type Lobby, type NetMessage, type OpenSeat, type RoomSettings } from './protocol'
import type { Transport, TransportStatus } from './transport'

/** Heartbeats keep everyone's list of who is here. A player not heard from in this long is treated as gone. */
export const PING_MS = 2500
export const PEER_TIMEOUT_MS = 9000
export const HOST_TIMEOUT_MS = 12000
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

  constructor(opts: SessionOptions) {
    this.clientId = opts.clientId
    this.transport = opts.transport
    this.name = opts.name
    this.map = opts.map
    this.events = opts.events ?? {}
    this.now = opts.now ?? Date.now
    this.transport.onMessage((m) => void this.receive(m))
    this.transport.onStatus((s) => this.connection(s))
    if (opts.autoTick !== false) this.timer = setInterval(() => this.tick(), 500)
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
    const state = createInitialState(this.map, { playerRegionId: ids[0], humans: ids, seed: lobby.settings.seed, victoryShare: lobby.settings.victoryShare, goal: lobby.settings.goal ?? 'world', difficulty: lobby.settings.difficulty, online: true })
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

  /** Host: sends the room back to the lobby with the same players, ready to pick again and start a new game. */
  rematch() {
    const lobby = this.lobby
    if (!this.isHost || !lobby || lobby.phase !== 'playing') return
    this.game = null
    this.plans.clear()
    this.deadlineAt = null
    this.remainingMs = null
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

  /** Sends the game in pieces, to everyone or to the one screen that asked. */
  private async broadcastState(to?: ClientId) {
    const game = this.game
    if (!game) return
    const parts = await encodeState(game)
    const id = `${game.turn}-${this.now().toString(36)}-${this.stateSeq++}`
    const remainingMs = this.deadlineAt === null ? null : Math.max(0, this.deadlineAt - this.now())
    parts.forEach((data, part) => this.send({ t: 'state', from: this.clientId, id, part, parts: parts.length, data, turn: game.turn, remainingMs, hostTerm: this.term, ...(to ? { to } : {}) }))
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
          else this.events.onReady?.(msg.ready, msg.remainingMs)
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
    }
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
    // A newer copy has arrived while this one was assembling.
    if (this.game && msg.turn < this.game.turn) return
    let state: GameState
    try {
      state = await decodeState(entry.parts)
    } catch {
      this.catchUp()
      return
    }
    const prev = this.game
    this.game = state
    this.remainingMs = msg.remainingMs
    if (prev && prev.turn < state.turn) this.events.onState?.(this.viewOf(prev), this.viewOf(state))
    else this.events.onStart?.(this.viewOf(state))
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
  }

  /** Called every half second: heartbeats, the month timer, and taking over when the host disappears. */
  tick() {
    if (this.closed) return
    const t = this.now()
    if (this.lastTick && t - this.lastTick > SLEEP_GAP_MS) this.forgive(t)
    this.lastTick = t
    if (t - this.lastPing >= PING_MS) {
      this.lastPing = t
      this.send({ t: 'ping', from: this.clientId, name: this.name, host: this.lobby?.host ?? null, term: this.term })
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
    if (this.hostIsGone(t)) this.electIfFirst()
  }

  /** The host said it was leaving, or has gone quiet for too long. */
  private hostIsGone(t: number): boolean {
    if (this.hostQuit) return true
    const seen = this.lobby ? this.seen.get(this.lobby.host) : undefined
    return seen !== undefined && t - seen > HOST_TIMEOUT_MS
  }

  /**
   * The first player still here takes over, with the latest game this screen holds. A screen whose own line is down never does,
   * since it would see nobody and crown itself.
   */
  private electIfFirst() {
    const lobby = this.lobby
    if (!lobby || this.isHost || this.transport.status !== 'connected') return
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
