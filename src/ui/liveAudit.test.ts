import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialState } from '../data/startingNations'
import { absDay, daysInMonth } from '../engine/calendar'
import { applyOrderNow } from '../engine/resolveTurn'
import type { BattleReport, GameState } from '../engine/types'
import { getWorld } from '../map/world'
import { liveHold, useGame } from '../store'
import { paintSignature } from './globe/paint'

const { map } = getWorld()

const memory = new Map<string, string>()
beforeEach(() => {
  memory.clear()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
    key: () => null,
    length: 0,
  } as Storage
  useGame.setState({ online: null, fxQueue: [], summary: null, liveNote: null, warRoom: null, helpOpen: false, paletteOpen: false, confirm: null, running: false })
})

/** A live game in the store: Germany at war with Poland, battle windows off so the clock never waits for one. */
function liveGame() {
  useGame.getState().newGame({ playerRegionId: 'germany', seed: 3, difficulty: 'normal', mode: 'live' })
  useGame.getState().updateSettings({ pauseOnBattles: false, battleScenes: 'off', liveReport: 'note' })
  const g = structuredClone(useGame.getState().game!)
  g.wars.push('germany|poland')
  g.nations.germany.resources.capital = 3000
  useGame.setState({ game: g })
  return g
}

describe('the month report in a live game', () => {
  /** An army of Germany that arrives on the 1st of February, the very day the month turns over. */
  function armyForTheFirst() {
    const g = liveGame()
    const s = structuredClone(g)
    const sent = applyOrderNow(s, map, { type: 'attack', nationId: 'germany', target: 'poland', commit: 'main', stance: 'assault' })
    expect(sent.army).toBeTruthy()
    const a = sent.army!
    a.end = absDay(2, 0)
    a.start = a.end - 2
    s.day = daysInMonth(1) - 1
    useGame.setState({ game: s })
  }

  it('carries the month it started from in the game itself', () => {
    const g = liveGame()
    expect(g.monthStart).toBeTruthy()
    expect(g.monthStart!.turn).toBe(1)
    expect(g.monthStart!.battles).toEqual([])
    // It holds the numbers as the game began, not as the test changed them since.
    expect(g.monthStart!.stats.money).toBeGreaterThan(0)
    expect(g.monthStart!.stats.money).not.toBe(g.nations.germany.resources.capital)
  })

  it('a battle on the 1st belongs to the new month, not to the one that ended', () => {
    armyForTheFirst()
    useGame.getState().stepDay()
    const st = useGame.getState()
    expect(st.game!.turn).toBe(2)
    expect(st.game!.day).toBe(0)
    // The fight happened on the 1st of February.
    expect(st.recentBattles.length).toBeGreaterThan(0)
    expect(st.liveNote).not.toBeNull()
    expect(st.liveNote!.turn).toBe(1)
    expect(st.liveNote!.battles).toEqual([])
    expect(st.game!.monthStart!.turn).toBe(2)
    expect(st.game!.monthStart!.battles).toHaveLength(1)
  })

  it('loading a save in the middle of a month does not reset where the month began', () => {
    armyForTheFirst()
    useGame.getState().stepDay()
    const before = useGame.getState().game!.monthStart!
    // Some days into February, the game is saved and opened again.
    for (let i = 0; i < 5; i++) useGame.getState().stepDay()
    expect(useGame.getState().game!.monthStart!.stats).toEqual(before.stats)
    useGame.getState().persist()
    useGame.getState().loadGame()
    const loaded = useGame.getState().game!
    expect(loaded.day).toBe(5)
    expect(loaded.monthStart!.turn).toBe(2)
    expect(loaded.monthStart!.stats).toEqual(before.stats)
    expect(loaded.monthStart!.battles).toEqual(before.battles)
    // And the report at the end of February counts the whole month: the battle on the 1st is in it.
    useGame.setState({ liveNote: null })
    for (let i = 0; i < 23; i++) useGame.getState().stepDay()
    const st = useGame.getState()
    expect(st.game!.turn).toBe(3)
    expect(st.liveNote!.turn).toBe(2)
    expect(st.liveNote!.battles.map((b) => b.text)).toContain(before.battles[0].text)
    const money = st.liveNote!.deltas.find((d) => d.label === 'Money')!
    expect(money.before).toBe(before.stats.money)
  })

  it('a game saved before this was kept starts the month from where it stands', () => {
    const g = liveGame()
    const old = structuredClone(g)
    delete old.monthStart
    old.nations.germany.resources.capital = 777
    memory.set('worlds-of-others-save-v4', JSON.stringify(old))
    useGame.getState().loadGame()
    expect(useGame.getState().game!.monthStart!.stats.money).toBe(777)
  })
})

describe('choosing a speed', () => {
  it('does not start a paused clock, and does not stop a running one', () => {
    liveGame()
    useGame.getState().setSpeed(4)
    expect(useGame.getState().settings.liveSpeed).toBe(4)
    expect(useGame.getState().running).toBe(false)
    useGame.getState().play()
    useGame.getState().setSpeed(2)
    expect(useGame.getState().settings.liveSpeed).toBe(2)
    expect(useGame.getState().running).toBe(true)
    useGame.getState().pause()
    useGame.getState().setSpeed(1)
    expect(useGame.getState().running).toBe(false)
  })
})

describe('what holds the clock, in the order the windows are drawn', () => {
  it('the jump-to box and a question sit above help, a battle, the report and a decision', () => {
    liveGame()
    const base = () => useGame.getState()
    useGame.setState({ helpOpen: true, fxQueue: [{} as never], summary: { turn: 1, deltas: [], battles: [], lines: [], world: [] } })
    expect(liveHold(base())).toBe('help')
    useGame.setState({ paletteOpen: true })
    expect(liveHold(base())).toBe('planning')
    useGame.setState({ paletteOpen: false, confirm: { title: 'Sure?', label: 'Yes', run: () => {} } as never })
    expect(liveHold(base())).toBe('planning')
  })

  it('the end of the game covers everything except a battle that is still playing', () => {
    liveGame()
    const base = () => useGame.getState()
    useGame.setState({ game: { ...base().game!, outcome: 'defeat' }, helpOpen: true, summary: { turn: 1, deltas: [], battles: [], lines: [], world: [] } })
    expect(liveHold(base())).toBe('over')
    useGame.setState({ fxQueue: [{} as never] })
    expect(liveHold(base())).toBe('help')
    useGame.setState({ helpOpen: false })
    expect(liveHold(base())).toBe('battle')
  })

  it('the War Room is the lowest of them', () => {
    liveGame()
    const base = () => useGame.getState()
    useGame.setState({ warRoom: 'poland' })
    expect(liveHold(base())).toBe('planning')
    useGame.setState({ summary: { turn: 1, deltas: [], battles: [], lines: [], world: [] } })
    expect(liveHold(base())).toBe('report')
  })
})

describe('watching a battle again', () => {
  it('plays it as history: the copy is marked a replay, and the list keeps the original', () => {
    liveGame()
    const old = { id: 'b-old', turn: 1, regionId: 'poland', captured: true, winner: 'attacker', rounds: [], modifiers: [], attacker: { nationId: 'germany', units: {}, losses: {} }, defender: { nationId: 'poland', units: {}, losses: {} } } as unknown as BattleReport
    useGame.setState({ recentBattles: [old] })
    useGame.getState().openBattle('b-old')
    const queued = useGame.getState().fxQueue
    expect(queued).toHaveLength(1)
    expect(queued[0].replay).toBe(true)
    expect(useGame.getState().recentBattles[0].replay).toBeUndefined()
  })
})

describe('the Fronts map', () => {
  it('is painted again when a country can hold more or less, even if its Defense Line has not moved', () => {
    const s = createInitialState(map, { playerRegionId: 'germany', seed: 1, mode: 'live' }) as GameState
    s.wars.push('germany|poland')
    const base = paintSignature(s, 'fronts')
    const stronger = structuredClone(s)
    stronger.regions.poland.buildings.barracks += 3
    expect(stronger.regions.poland.line).toBe(s.regions.poland.line)
    expect(paintSignature(stronger, 'fronts')).not.toBe(base)
    // The other maps do not care.
    expect(paintSignature(stronger, 'political')).toBe(paintSignature(s, 'political'))
  })
})
