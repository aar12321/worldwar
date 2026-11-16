import { describe, expect, it } from 'vitest'
import { lineMap, startState } from '../engine/__tests__/fixtures'
import type { Lobby } from './protocol'
import { deleteOnlineSave, KEEP_ROOMS, listOnlineSaves, loadOnlineSave, writeOnlineSave } from './saves'

/** A browser's storage, in memory. `limit` is how many characters it will hold in all. */
function fakeStore(limit = Infinity) {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if ([...data].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0) + v.length > limit) throw new Error('QuotaExceeded')
      data.set(k, v)
    },
  }
}

const map = lineMap(4)
const lobbyOf = (code: string): Lobby => ({
  code,
  host: 'h',
  term: 3,
  phase: 'playing',
  settings: { difficulty: 'normal', victoryShare: 2, timer: 0, seed: 1 },
  players: [
    { clientId: 'h', name: 'Hana', nationId: 'r0' },
    { clientId: 'b', name: 'Bo (left)', nationId: 'r1' },
  ],
})
const gameOf = () => {
  const g = startState(map, 'r0')
  g.humans = ['r0', 'r1']
  return g
}

describe('online saves', () => {
  it('keeps a room and gives the same game back, with who sat where', async () => {
    const store = fakeStore()
    const game = gameOf()
    game.turn = 7
    expect(await writeOnlineSave(lobbyOf('ABCDE'), game, 1234, store)).toBe(true)
    expect(listOnlineSaves(store)).toEqual([{ code: 'ABCDE', turn: 7, savedAt: 1234, seats: [{ nationId: 'r0', name: 'Hana' }, { nationId: 'r1', name: 'Bo' }] }])
    const back = await loadOnlineSave('ABCDE', store)
    expect(back!.lobby.term).toBe(3)
    expect(JSON.stringify(back!.game)).toBe(JSON.stringify(game))
    expect(await loadOnlineSave('ZZZZZ', store)).toBeNull()
  })

  it('a room saves over itself, and only the newest few rooms are kept', async () => {
    const store = fakeStore()
    const game = gameOf()
    for (const [i, code] of ['AAAAA', 'BBBBB', 'CCCCC', 'DDDDD'].entries()) await writeOnlineSave(lobbyOf(code), game, i, store)
    expect(listOnlineSaves(store).map((s) => s.code)).toEqual(['DDDDD', 'CCCCC', 'BBBBB'])
    expect(listOnlineSaves(store)).toHaveLength(KEEP_ROOMS)
    game.turn = 9
    await writeOnlineSave(lobbyOf('CCCCC'), game, 99, store)
    expect(listOnlineSaves(store).map((s) => [s.code, s.turn])).toEqual([['CCCCC', 9], ['DDDDD', 1], ['BBBBB', 1]])
  })

  it('a finished game is dropped, and the last room can be deleted', async () => {
    const store = fakeStore()
    const game = gameOf()
    await writeOnlineSave(lobbyOf('AAAAA'), game, 1, store)
    game.outcome = 'victory'
    await writeOnlineSave(lobbyOf('AAAAA'), game, 2, store)
    expect(listOnlineSaves(store)).toEqual([])
    game.outcome = 'playing'
    await writeOnlineSave(lobbyOf('BBBBB'), game, 3, store)
    deleteOnlineSave('BBBBB', store)
    expect(listOnlineSaves(store)).toEqual([])
  })

  it('full storage drops the oldest room instead of losing the newest', async () => {
    const game = gameOf()
    const probe = fakeStore()
    await writeOnlineSave(lobbyOf('AAAAA'), game, 1, probe)
    const one = probe.getItem('worlds-of-others-online-saves')!.length
    const store = fakeStore(one * 1.5)
    await writeOnlineSave(lobbyOf('AAAAA'), game, 1, store)
    expect(await writeOnlineSave(lobbyOf('BBBBB'), game, 2, store)).toBe(true)
    expect(listOnlineSaves(store).map((s) => s.code)).toEqual(['BBBBB'])
  })

  it('missing or broken storage never throws', async () => {
    expect(listOnlineSaves(null)).toEqual([])
    expect(await writeOnlineSave(lobbyOf('AAAAA'), gameOf(), 1, null)).toBe(false)
    const broken = { getItem: () => '{not json', setItem: () => undefined }
    expect(listOnlineSaves(broken)).toEqual([])
    expect(await loadOnlineSave('AAAAA', broken)).toBeNull()
  })
})
