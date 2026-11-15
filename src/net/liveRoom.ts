import { LIVE } from '../data/live'
import { advanceDay, applyLiveOp, isMonthEndDay, type BotPlanner, type LiveEvent, type LiveOp } from '../engine/live'
import type { GameState, NationId, Order, WorldMap } from '../engine/types'
import { DEFAULT_PAUSE_LIMIT_SEC, DEFAULT_PAUSES, fingerprint, type ClientId, type LiveClock, type LiveSpeed } from './protocol'

/** How many recent steps the host keeps, so a screen that missed a few gets them again instead of the whole game. */
export const OP_LOG_SIZE = 400
/** Pauses at or above this count are unlimited. */
export const UNLIMITED_PAUSES = 99

/** What a run of steps did to a screen's game, for the screen to show. */
export interface LiveUpdate {
  prev: GameState
  next: GameState
  events: LiveEvent[]
  /** True when the month turned over in these steps. */
  monthEnded: boolean
  /** The orders applied, with the nonce of the screen that sent each. */
  acts: { nationId: NationId; nonce?: string }[]
  /** At a month's end: for each human whose month-end orders were used, the month they were for. */
  plans?: Record<NationId, number>
  /** True when the game was replaced by a fresh copy from the host, not stepped. */
  resync?: boolean
}

/** What the host needs from the room at a month's end: everyone's month-end orders, and who plays the nations nobody is at. */
export interface MonthInput {
  monthOrders: Order[]
  plans: Record<NationId, number>
  planner: BotPlanner
}

export interface RefereeOptions {
  hostId: ClientId
  speed?: LiveSpeed
  pauses?: number
  pauseLimitSec?: number
  /** The step number the game is at. A new game starts at 0; a new host carries on from its own count. */
  seq?: number
  now: number
}

/**
 * The host's side of an online live game: the true game, the shared clock and its pause rules, and a numbered log of every
 * step taken. It knows nothing about the network; the session sends what it produces.
 */
export class LiveReferee {
  game: GameState
  seq: number
  hostId: ClientId
  running = false
  speed: LiveSpeed
  pausedBy: ClientId | null = null
  private pausesLeft = new Map<ClientId, number>()
  private pauses: number
  private pauseLimitMs: number
  private resumeAt: number | null = null
  private acc = 0
  private lastAt: number
  private log: { seq: number; op: LiveOp }[] = []
  hostHidden = false
  private map: WorldMap

  constructor(game: GameState, map: WorldMap, opts: RefereeOptions) {
    this.map = map
    this.game = game
    this.hostId = opts.hostId
    this.seq = opts.seq ?? 0
    this.speed = opts.speed ?? 1
    this.pauses = opts.pauses ?? DEFAULT_PAUSES
    this.pauseLimitMs = (opts.pauseLimitSec ?? DEFAULT_PAUSE_LIMIT_SEC) * 1000
    this.lastAt = opts.now
  }

  /** Carries the pause allowance over from the last host, so a new host does not hand everyone fresh pauses. */
  restorePauses(left: Record<ClientId, number>) {
    for (const [id, n] of Object.entries(left)) this.pausesLeft.set(id, n)
  }

  private record(op: LiveOp) {
    this.log.push({ seq: this.seq, op })
    if (this.log.length > OP_LOG_SIZE) this.log.splice(0, this.log.length - OP_LOG_SIZE)
    this.seq++
  }

  /** The steps from `fromSeq` on, or null when the log no longer reaches back that far. */
  opsSince(fromSeq: number): LiveOp[] | null {
    if (fromSeq >= this.seq) return []
    const first = this.log[0]?.seq ?? this.seq
    if (fromSeq < first) return null
    return this.log.slice(fromSeq - first).map((x) => x.op)
  }

  /** An order that happens at once. Returns the step and what it did, or why it could not be made. */
  act(nationId: NationId, order: Order, nonce?: string): { op: LiveOp; update: LiveUpdate } | { error: string } {
    const op: LiveOp = { k: 'act', nationId, order, ...(nonce ? { nonce } : {}) }
    const prev = this.game
    const result = applyLiveOp(prev, this.map, op)
    if (result.error) return { error: result.error }
    this.game = result.state
    this.record(op)
    if (this.game.outcome !== 'playing') this.running = false
    return { op, update: { prev, next: this.game, events: result.events, monthEnded: false, acts: [{ nationId, nonce }] } }
  }

  /**
   * Moves the clock on to `now`: the days that are due, at most a few at a time, so a stalled page never races ahead.
   * Returns the steps taken and what they did, merged.
   */
  advance(now: number, month: (s: GameState) => MonthInput): { ops: LiveOp[]; update: LiveUpdate | null } {
    const dt = Math.max(0, Math.min(1000, now - this.lastAt))
    this.lastAt = now
    // A player's pause ends by itself.
    if (!this.running && this.pausedBy && this.pausedBy !== this.hostId && this.resumeAt !== null && now >= this.resumeAt) this.resume()
    if (!this.running || this.game.outcome !== 'playing') return { ops: [], update: null }
    this.acc += dt * this.speed
    const ops: LiveOp[] = []
    const prev = this.game
    const events: LiveEvent[] = []
    let monthEnded = false
    let plans: Record<NationId, number> | undefined
    let steps = 0
    while (this.acc >= LIVE.msPerDay && steps < LIVE.maxCatchUpDays && this.game.outcome === 'playing') {
      this.acc -= LIVE.msPerDay
      steps++
      if (isMonthEndDay(this.game)) {
        const input = month(this.game)
        const step = advanceDay(this.game, this.map, { monthOrders: input.monthOrders, planner: input.planner })
        const op: LiveOp = { k: 'month', plans: input.plans, events: step.events }
        this.game = step.state
        this.record(op)
        ops.push(op)
        events.push(...step.events)
        monthEnded = true
        plans = input.plans
        // The month's turnover goes out on its own, with the game after it, before anything else happens.
        break
      }
      const op: LiveOp = { k: 'day' }
      const result = applyLiveOp(this.game, this.map, op)
      if (result.error) break
      this.game = result.state
      this.record(op)
      ops.push(op)
      events.push(...result.events)
    }
    if (this.acc >= LIVE.msPerDay) this.acc = LIVE.msPerDay - 1
    if (this.game.outcome !== 'playing') this.running = false
    if (ops.length === 0) return { ops, update: null }
    return { ops, update: { prev, next: this.game, events, monthEnded, acts: [], ...(plans ? { plans } : {}) } }
  }

  /** How far through the current day the clock is, from 0 to 1. */
  get fraction() {
    return Math.min(0.999, this.acc / LIVE.msPerDay)
  }

  private left(clientId: ClientId) {
    return this.pausesLeft.get(clientId) ?? this.pauses
  }

  /** A player asks to pause. The host may always; others spend one of their pauses. Returns why not, or null. */
  pause(clientId: ClientId, now: number): string | null {
    if (!this.running) return 'The game is already paused'
    const host = clientId === this.hostId
    if (!host) {
      const left = this.left(clientId)
      if (left <= 0) return 'You have no pauses left'
      if (this.pauses < UNLIMITED_PAUSES) this.pausesLeft.set(clientId, left - 1)
    }
    this.running = false
    this.pausedBy = clientId
    this.resumeAt = host ? null : now + this.pauseLimitMs
    return null
  }

  /** Only the player who paused, or the host, can start the clock again. */
  requestResume(clientId: ClientId): string | null {
    if (this.running) return null
    if (this.game.outcome !== 'playing') return 'The game is over'
    if (clientId !== this.hostId && clientId !== this.pausedBy) return 'Only the player who paused, or the host, can resume'
    this.resume()
    return null
  }

  private resume() {
    this.running = true
    this.pausedBy = null
    this.resumeAt = null
  }

  setSpeed(clientId: ClientId, speed: LiveSpeed): string | null {
    if (clientId !== this.hostId) return 'Only the host sets the speed'
    if (!LIVE.speeds.includes(speed)) return 'Not a speed the game has'
    this.speed = speed
    return null
  }

  /** The clock as everyone sees it. */
  view(now: number, players: ClientId[]): LiveClock {
    const pausesLeft: Record<ClientId, number> = {}
    for (const id of players) if (id !== this.hostId) pausesLeft[id] = this.left(id)
    return {
      running: this.running,
      speed: this.speed,
      pausedBy: this.pausedBy,
      pausesLeft,
      resumeInMs: !this.running && this.resumeAt !== null ? Math.max(0, this.resumeAt - now) : null,
      ...(this.hostHidden ? { hostHidden: true } : {}),
    }
  }
}

/**
 * A screen's copy of an online live game that is not the host's: it applies the host's steps in their order and notices
 * when it has missed some or no longer agrees with the host, so it can ask for them again.
 */
export class LiveMirror {
  game: GameState
  seq: number
  private buffer = new Map<number, LiveOp>()
  /** Set when a step the host made could not be made here: the two games have drifted apart. */
  private drifted = false
  /** The month's turnover this screen is waiting for the host's game after: where it was, and what it brought. */
  private month: { seq: number; prev: GameState; events: LiveEvent[]; plans: Record<NationId, number> } | null = null

  private map: WorldMap

  constructor(game: GameState, seq: number, map: WorldMap) {
    this.map = map
    this.game = game
    this.seq = seq
  }

  /** True while steps are waiting for one that has not arrived, or the month's game has not come yet. */
  get behind(): boolean {
    return this.month !== null || this.buffer.size > 0 || this.drifted
  }

  /** True when this screen no longer agrees with the host and needs its game. */
  get needsGame(): boolean {
    return this.month !== null || this.drifted
  }

  get waitingForMonth(): boolean {
    return this.month !== null
  }

  /**
   * Takes a batch of steps. Returns what changed, whether some are missing, and whether this screen disagrees with the host.
   */
  receive(seq0: number, ops: LiveOp[], fp: string | null): { update: LiveUpdate | null; gap: boolean; mismatch: boolean } {
    ops.forEach((op, i) => {
      if (seq0 + i >= this.seq) this.buffer.set(seq0 + i, op)
    })
    const update = this.drain()
    const gap = this.buffer.size > 0 && !this.month
    // Only compare when this screen is exactly where the host was after the batch.
    if (!!update && fp !== null && !this.month && this.seq === seq0 + ops.length && fingerprint(this.game) !== fp) this.drifted = true
    // Stays set until the host's game arrives, so that copy is taken even if it is at the same step.
    return { update, gap, mismatch: this.drifted }
  }

  private drain(): LiveUpdate | null {
    const prev = this.game
    const events: LiveEvent[] = []
    const acts: LiveUpdate['acts'] = []
    while (!this.month && this.buffer.has(this.seq)) {
      const op = this.buffer.get(this.seq)!
      if (op.k === 'month') {
        this.month = { seq: this.seq, prev: this.game, events: op.events, plans: op.plans }
        break
      }
      this.buffer.delete(this.seq)
      const result = applyLiveOp(this.game, this.map, op)
      // An order the host made but this screen could not: the two have drifted apart. The fingerprint check asks for the game.
      if (result.error) this.drifted = true
      else {
        this.game = result.state
        events.push(...result.events)
      }
      if (op.k === 'act') acts.push({ nationId: op.nationId, nonce: op.nonce })
      this.seq++
    }
    if (this.game === prev && acts.length === 0) return null
    return { prev, next: this.game, events, monthEnded: false, acts }
  }

  /**
   * The host's game, as of step `seq`. It ends a month's turnover this screen was waiting for, or replaces a game that had
   * drifted. Returns what changed, or null when it is older than what this screen already has.
   */
  snapshot(game: GameState, seq: number, reset = false): LiveUpdate | null {
    if (!reset && seq < this.seq) return null
    // The same game again (sent to someone who joined): nothing to do.
    if (!reset && seq === this.seq && !this.behind) return null
    const month = this.month && seq > this.month.seq ? this.month : null
    const prev = month?.prev ?? this.game
    this.game = game
    this.seq = seq
    this.month = null
    this.drifted = false
    for (const k of [...this.buffer.keys()]) if (k < seq) this.buffer.delete(k)
    const base: LiveUpdate = month
      ? { prev, next: game, events: month.events, monthEnded: true, acts: [], plans: month.plans }
      : { prev, next: game, events: [], monthEnded: false, acts: [], resync: true }
    // Steps that arrived while waiting carry on from here.
    const more = this.drain()
    if (!more) return base
    return { ...base, next: more.next, events: [...base.events, ...more.events], acts: more.acts }
  }
}
