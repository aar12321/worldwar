import type { GameState, NationId } from '../engine/types'
import { decodeState, encodeState, type Lobby } from './protocol'

/**
 * Online games are saved on every player's own device after each month, because every player already holds the whole game.
 * If everyone closes their tab, any one of them can open the room again from here and the others take their seats back by code.
 */
const KEY = 'worlds-of-others-online-saves'
/** Rooms kept, newest first. A squeezed game is about 60 KB, so a few fit well within what a browser allows. */
export const KEEP_ROOMS = 3

/** What the entry screen lists: enough to recognise a game without opening it. */
export interface OnlineSaveInfo {
  code: string
  turn: number
  /** Live rooms: the day of the month, and that the room is live. */
  day?: number
  live?: boolean
  savedAt: number
  /** Who sat where, for choosing which seat to take back. */
  seats: { nationId: NationId; name: string }[]
}

interface StoredSave extends OnlineSaveInfo {
  lobby: Lobby
  /** The game, squeezed and as one piece of text. */
  data: string
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

const defaultStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function read(store: Store | null): StoredSave[] {
  if (!store) return []
  try {
    const raw = JSON.parse(store.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((s): s is StoredSave => !!s && typeof s.code === 'string' && typeof s.data === 'string' && !!s.lobby) : []
  } catch {
    return []
  }
}

function write(store: Store | null, saves: StoredSave[]): boolean {
  if (!store) return false
  if (saves.length === 0) {
    try {
      store.setItem(KEY, '[]')
      return true
    } catch {
      return false
    }
  }
  // Storage that is full drops the oldest room and tries again, rather than losing the newest game.
  for (let keep = saves.length; keep >= 1; keep--) {
    try {
      store.setItem(KEY, JSON.stringify(saves.slice(0, keep)))
      return true
    } catch {
      /* try with one room fewer */
    }
  }
  return false
}

/** The saved rooms on this device, newest first. */
export function listOnlineSaves(store: Store | null = defaultStore()): OnlineSaveInfo[] {
  return read(store).map(({ code, turn, day, live, savedAt, seats }) => ({ code, turn, ...(live ? { day, live } : {}), savedAt, seats }))
}

/** Saves a room's game. A finished game is not worth reopening, so it is dropped instead. */
export async function writeOnlineSave(lobby: Lobby, game: GameState, now: number = Date.now(), store: Store | null = defaultStore()): Promise<boolean> {
  if (game.outcome !== 'playing') {
    deleteOnlineSave(lobby.code, store)
    return true
  }
  const data = (await encodeState(game)).join('')
  const seats = lobby.players.filter((p) => p.nationId && game.humans.includes(p.nationId)).map((p) => ({ nationId: p.nationId as NationId, name: p.name.replace(/ \(left\)$/, '') }))
  const entry: StoredSave = { code: lobby.code, turn: game.turn, ...(game.settings.mode === 'live' ? { day: game.day ?? 0, live: true } : {}), savedAt: now, seats, lobby, data }
  return write(store, [entry, ...read(store).filter((s) => s.code !== lobby.code)].slice(0, KEEP_ROOMS))
}

/** Opens a saved room's lobby and game. Null if it is gone or cannot be read. */
export async function loadOnlineSave(code: string, store: Store | null = defaultStore()): Promise<{ lobby: Lobby; game: GameState } | null> {
  const found = read(store).find((s) => s.code === code)
  if (!found) return null
  try {
    return { lobby: found.lobby, game: await decodeState([found.data]) }
  } catch {
    return null
  }
}

export function deleteOnlineSave(code: string, store: Store | null = defaultStore()) {
  const saves = read(store)
  const rest = saves.filter((s) => s.code !== code)
  if (rest.length !== saves.length) write(store, rest)
}
