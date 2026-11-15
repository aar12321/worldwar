import type { LiveOp } from '../engine/live'
import type { Difficulty, GameState, NationId, Order } from '../engine/types'

export type ClientId = string

/** What the host decides about a room before the game starts. */
export interface RoomSettings {
  difficulty: Difficulty
  /** How big the 'classic' goals are (see `conquestGoal` and `economicGoal`). Ignored when the goal is the whole world. */
  victoryShare: number
  /** 'world': the first player to hold every country wins. 'classic': the shorter goals (countries, people or output). Missing means 'world'. */
  goal?: 'world' | 'classic'
  /** Seconds each month lasts before the game moves on without the slow players. 0 means wait for everyone. */
  timer: 0 | 60 | 90 | 120 | 180
  seed: number
  /** 'live': the clock runs and armies march. Missing means turns. */
  mode?: 'turns' | 'live'
  /** Live: how fast the clock runs. The host can change it during the game. */
  speed?: LiveSpeed
  /** Live: how many times each player who is not the host may pause the game. 99 means as often as they like. */
  pauses?: number
  /** Live: seconds a pause by a player who is not the host lasts before the clock runs again by itself. */
  pauseLimitSec?: number
}

export type LiveSpeed = 1 | 2 | 4

export const PAUSE_CHOICES = [0, 3, 5, 99] as const
export const DEFAULT_PAUSES = 3
export const DEFAULT_PAUSE_LIMIT_SEC = 90

/** A new room's rules: the mode chosen on the start screen, and the usual defaults. */
export function newRoomSettings(mode: 'turns' | 'live', random: () => number = Math.random): RoomSettings {
  return { difficulty: 'normal', victoryShare: 0.4, goal: 'world', timer: 0, seed: Math.floor(random() * 1e6), mode, speed: 1, pauses: DEFAULT_PAUSES, pauseLimitSec: DEFAULT_PAUSE_LIMIT_SEC }
}

/** The shared clock of an online live game, as the host runs it. */
export interface LiveClock {
  running: boolean
  speed: LiveSpeed
  /** Who paused it, while it is paused by a player. Null when nobody has (a new game, or after the host changed). */
  pausedBy: ClientId | null
  /** Pauses each player who is not the host has left. */
  pausesLeft: Record<ClientId, number>
  /** Milliseconds until a player's pause ends by itself, or null. */
  resumeInMs: number | null
  /** The host's page is hidden, so its browser may slow the game down. */
  hostHidden?: boolean
}

export interface LobbyPlayer {
  clientId: ClientId
  name: string
  nationId: NationId | null
}

export interface Lobby {
  code: string
  host: ClientId
  settings: RoomSettings
  players: LobbyPlayer[]
  phase: 'lobby' | 'playing'
}

export const MAX_PLAYERS = 4

export interface ChatMessage {
  from: ClientId
  name: string
  text: string
  at: number
}

/** Everything that travels between screens. Each message carries its sender; the host is the only one that decides anything. */
export type NetMessage =
  | { t: 'hello'; from: ClientId; name: string }
  | { t: 'lobby'; from: ClientId; lobby: Lobby }
  | { t: 'pick'; from: ClientId; nationId: NationId | null }
  | { t: 'settings'; from: ClientId; settings: RoomSettings }
  | { t: 'leave'; from: ClientId }
  | { t: 'orders'; from: ClientId; turn: number; orders: Order[]; ready: boolean }
  | { t: 'ready'; from: ClientId; turn: number; ready: NationId[]; remainingMs: number | null }
  | { t: 'state'; from: ClientId; id: string; part: number; parts: number; data: string; turn: number; remainingMs: number | null; seq?: number; reset?: boolean }
  | { t: 'need-state'; from: ClientId }
  | { t: 'chat'; from: ClientId; name: string; text: string; at: number }
  | { t: 'ping'; from: ClientId; name: string }
  | { t: 'claim-host'; from: ClientId }
  // Live games.
  /** An order that happens at once, for the host to apply and pass on. `nonce` lets the sender match the answer. */
  | { t: 'act'; from: ClientId; nonce: string; order: Order }
  /** The host could not make an order. */
  | { t: 'act-fail'; from: ClientId; to: ClientId; nonce: string; error: string }
  /** Steps of the game, numbered from `seq0`. `fp` is the fingerprint of the game after the last one, when it is known. */
  | { t: 'ops'; from: ClientId; seq0: number; ops: LiveOp[]; fp: string | null }
  | { t: 'clock'; from: ClientId; clock: LiveClock }
  | { t: 'clock-req'; from: ClientId; action: 'pause' | 'resume' | 'speed'; speed?: LiveSpeed }
  /** A screen missed steps and asks for them again, from this number on. */
  | { t: 'need-ops'; from: ClientId; fromSeq: number }

/** Room codes avoid letters that look alike, so they can be read out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function newRoomCode(random: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < 5; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  return out
}

export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
export const validCode = (code: string) => code.length === 5 && [...code].every((c) => CODE_ALPHABET.includes(c))

export function newClientId(random: () => number = Math.random): string {
  return `c${Math.floor(random() * 0xffffffff).toString(36)}${Date.now().toString(36)}`
}

// A full game is about 300 KB of JSON, and about 45 KB once squeezed. Messages stay well under any relay's size limit by splitting it.
const CHUNK = 40_000

const toB64 = (bytes: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  void writer.write(bytes as unknown as BufferSource)
  void writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

/** Squeezes a game into text, in pieces small enough to send. */
export async function encodeState(state: GameState): Promise<string[]> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(state)), new CompressionStream('gzip'))
  const text = toB64(packed)
  const parts: string[] = []
  for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK))
  return parts
}

export async function decodeState(parts: string[]): Promise<GameState> {
  const bytes = await pipe(fromB64(parts.join('')), new DecompressionStream('gzip'))
  return JSON.parse(new TextDecoder().decode(bytes)) as GameState
}

/** A short fingerprint of a game, to see at a glance whether two screens agree. */
export function fingerprint(state: GameState): string {
  let h = 2166136261
  const armies = (state.armies ?? []).map((a) => `${a.id}${a.phase}${a.end}`).join(',')
  const text = `${state.turn}|${state.day ?? ''}|${armies}|${state.seed}|${state.log.length}|${state.nextId}|${Object.values(state.nations).map((n) => `${n.id}${n.alive ? 1 : 0}${Math.round(n.resources.capital)}`).join(',')}`
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
