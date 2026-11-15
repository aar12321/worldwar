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
  /** Which era of hosting this is. Every takeover raises it, so a host that was left behind can tell it has been replaced. */
  term: number
}

/** A seat a newcomer to a running game may take: a player who is away, or whom the host let go. */
export interface OpenSeat {
  nationId: NationId
  name: string
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
  | { t: 'leave'; from: ClientId }
  | { t: 'orders'; from: ClientId; turn: number; orders: Order[]; ready: boolean }
  | { t: 'ready'; from: ClientId; turn: number; ready: NationId[]; remainingMs: number | null }
  /** A game, in pieces. `to` says who asked for it; everyone else skips it. */
  | { t: 'state'; from: ClientId; id: string; part: number; parts: number; data: string; turn: number; remainingMs: number | null; hostTerm: number; to?: ClientId }
  | { t: 'need-state'; from: ClientId }
  | { t: 'chat'; from: ClientId; name: string; text: string; at: number }
  /** Each heartbeat also says who this screen thinks the host is, so two hosts find each other. */
  | { t: 'ping'; from: ClientId; name: string; host: ClientId | null; term: number }
  | { t: 'claim-host'; from: ClientId; term: number }
  /** The host sends a player away. */
  | { t: 'kick'; from: ClientId; target: ClientId }
  /** The host answers a newcomer to a running game with the seats that are free. */
  | { t: 'seats'; from: ClientId; to: ClientId; seats: OpenSeat[] }
  | { t: 'take-seat'; from: ClientId; nationId: NationId; name: string }

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
  const text = `${state.turn}|${state.seed}|${state.log.length}|${state.nextId}|${Object.values(state.nations).map((n) => `${n.id}${n.alive ? 1 : 0}${Math.round(n.resources.capital)}`).join(',')}`
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
