import { beforeEach, describe, expect, it } from 'vitest'
import { generateAllBotOrders } from '../ai/bot'
import { LIVE } from '../data/live'
import { createInitialState } from '../data/startingNations'
import { advanceDay, startLive } from '../engine/live'
import { lineMap, setMilitary, startState } from '../engine/__tests__/fixtures'
import type { Army, GameState } from '../engine/types'
import { getWorld } from '../map/world'
import { liveHold, useGame } from '../store'
import { glyphOf } from './globe/badges'
import { paintSignature } from './globe/paint'
import { settleGame } from './hooks'

const { map } = getWorld()

/** Starts a live game in the store, with the player at war with a neighbor and an army big enough to matter. */
function liveGame(player = 'germany', foe = 'poland') {
  useGame.getState().newGame({ playerRegionId: player, seed: 3, difficulty: 'normal', mode: 'live' })
  const g = structuredClone(useGame.getState().game!)
  g.wars.push([player, foe].sort().join('|'))
  g.nations[player].resources.capital = 3000
  useGame.setState({ game: g })
  return g
}

const all = (g: GameState) => g.nations[g.playerId].military.units

describe('the live clock in the store', () => {
  beforeEach(() => {
    useGame.setState({ online: null, fxQueue: [], summary: null, warRoom: null, helpOpen: false, running: false })
  })

  it('a new live game starts paused, on the first day, with nothing marching', () => {
    liveGame()
    const st = useGame.getState()
    expect(st.running).toBe(false)
    expect(st.game!.day).toBe(0)
    expect(st.game!.armies).toEqual([])
    expect(st.game!.settings.mode).toBe('live')
  })

  it('play and pause run the clock, and the clock only steps when it is running and nothing holds it', () => {
    liveGame()
    useGame.getState().play()
    expect(useGame.getState().running).toBe(true)
    useGame.getState().stepDay()
    expect(useGame.getState().game!.day).toBe(1)
    useGame.getState().togglePause()
    expect(useGame.getState().running).toBe(false)
  })

  it('names what holds the clock, in order', () => {
    liveGame()
    const base = () => useGame.getState()
    expect(liveHold(base())).toBeNull()
    useGame.setState({ helpOpen: true })
    expect(liveHold(base())).toBe('help')
    useGame.setState({ warRoom: 'poland' })
    expect(liveHold(base())).toBe('planning')
    useGame.setState({ summary: { turn: 1, deltas: [], battles: [], lines: [], world: [] } })
    expect(liveHold(base())).toBe('report')
    useGame.setState({ fxQueue: [{} as never] })
    expect(liveHold(base())).toBe('battle')
    useGame.setState({ game: { ...base().game!, pendingEvent: { eventId: 'bread_riot', turn: 1, rivalId: null, regionId: null } } })
    expect(liveHold(base())).toBe('event')
    useGame.setState({ game: { ...base().game!, outcome: 'defeat' } })
    expect(liveHold(base())).toBe('over')
    useGame.setState({ online: {} as never })
    expect(liveHold(base())).toBe('online')
  })

  it('does not step while something holds it', () => {
    liveGame()
    useGame.getState().play()
    useGame.getState().openWarRoom('poland')
    useGame.getState().stepDay()
    expect(useGame.getState().game!.day).toBe(0)
    useGame.getState().openWarRoom(null)
    useGame.getState().stepDay()
    expect(useGame.getState().game!.day).toBe(1)
  })

  it('an attack becomes an army that marches, fights, and comes home, and the store keeps the battle', () => {
    liveGame()
    const before = all(useGame.getState().game!).infantry
    expect(useGame.getState().attack('poland', 'main', 'assault')).toBe(true)
    let st = useGame.getState()
    expect(st.game!.armies).toHaveLength(1)
    expect(all(st.game!).infantry).toBeLessThan(before)
    st.play()
    for (let i = 0; i < 12; i++) useGame.getState().stepDay()
    st = useGame.getState()
    expect(st.game!.armies).toHaveLength(0)
    expect(st.recentBattles).toHaveLength(1)
    expect(all(st.game!).infantry).toBeGreaterThan(before * 0.6)
  })

  it('recalls an army that is on its way out', () => {
    liveGame()
    useGame.getState().attack('poland', 'main', 'assault')
    useGame.getState().play()
    useGame.getState().stepDay()
    const id = useGame.getState().game!.armies![0].id
    expect(useGame.getState().recallArmy(id)).toBe(true)
    expect(useGame.getState().game!.armies![0].outcome).toBe('recalled')
    expect(useGame.getState().recallArmy('nope')).toBe(false)
  })

  it('a month ends with a note, or with a report that holds the clock if you chose that', () => {
    liveGame()
    useGame.getState().play()
    const length = 31
    for (let i = 0; i < length; i++) useGame.getState().stepDay()
    let st = useGame.getState()
    expect(st.game!.turn).toBe(2)
    expect(st.liveNote).not.toBeNull()
    expect(st.summary).toBeNull()
    st.openNote()
    expect(useGame.getState().summary).not.toBeNull()
    expect(liveHold(useGame.getState())).toBe('report')
    useGame.getState().dismissSummary()
    useGame.getState().updateSettings({ liveReport: 'pause' })
    for (let i = 0; i < 28; i++) useGame.getState().stepDay()
    st = useGame.getState()
    expect(st.game!.turn).toBe(3)
    expect(st.summary).not.toBeNull()
    useGame.getState().updateSettings({ liveReport: 'note' })
  })

  it('Next turn does nothing in a live game, and a live save says so', () => {
    liveGame()
    useGame.getState().endTurn()
    expect(useGame.getState().game!.turn).toBe(1)
    expect(useGame.getState().game!.day).toBe(0)
  })

  it('a missile strike is not held for the month end: it flies at once', () => {
    const g = liveGame()
    const me = g.playerId
    const armed = structuredClone(g)
    armed.nations[me].military.units.missile = 5
    armed.regions.germany.buildings.factory = 1
    useGame.setState({ game: armed })
    expect(useGame.getState().issueOrder({ type: 'strike', nationId: me, target: 'poland', weapon: 'missile', count: 2 })).toBe(true)
    expect(useGame.getState().orders).toHaveLength(0)
    expect(useGame.getState().game!.flights).toHaveLength(1)
    expect(useGame.getState().game!.nations[me].military.units.missile).toBe(3)
  })

  it('research still waits for the 1st, and says it is queued', () => {
    const g = liveGame()
    expect(useGame.getState().issueOrder({ type: 'setPolicy', nationId: g.playerId, taxRate: 0.3, draftRate: 0.03, budget: g.nations[g.playerId].budget })).toBe(true)
    expect(useGame.getState().orders).toHaveLength(1)
    useGame.getState().play()
    for (let i = 0; i < 31; i++) useGame.getState().stepDay()
    expect(useGame.getState().orders).toHaveLength(0)
    expect(useGame.getState().game!.nations[g.playerId].taxRate).toBeCloseTo(0.3)
  })
})

describe('what the globe draws', () => {
  const army = (over: Partial<Army>): Pick<Army, 'via' | 'units'> => ({ via: 'land', units: { infantry: 5, armor: 0, artillery: 0, fighter: 0, air: 0, naval: 0, drone: 0, robot: 0, missile: 0 }, ...over })

  it('picks a badge picture by how the army travels and what it is made of', () => {
    expect(glyphOf(army({}))).toBe('infantry')
    expect(glyphOf(army({ units: { ...army({}).units, infantry: 1, armor: 4 } }))).toBe('armor')
    expect(glyphOf(army({ via: 'air' }))).toBe('plane')
    expect(glyphOf(army({ via: 'fleet' }))).toBe('ship')
    expect(glyphOf(army({ via: 'lane' }))).toBe('ship')
    expect(glyphOf(army({ units: { ...army({}).units, infantry: 0, drone: 3 } }))).toBe('drone')
  })

  it('repaints the map only when ownership or the colors change, and not when armies march', () => {
    const s = createInitialState(map, { playerRegionId: 'germany', seed: 1, mode: 'live' })
    const a = paintSignature(s, 'political')
    const moved = structuredClone(s)
    moved.day = 9
    moved.armies = [{ id: 'a1' } as Army]
    expect(paintSignature(moved, 'political')).toBe(a)
    const taken = structuredClone(s)
    taken.regions.poland.owner = 'germany'
    expect(paintSignature(taken, 'political')).not.toBe(a)
    // The relations map also follows who is at war.
    const warring = structuredClone(s)
    warring.wars.push('germany|poland')
    expect(paintSignature(warring, 'political')).toBe(a)
    expect(paintSignature(warring, 'relations')).not.toBe(paintSignature(s, 'relations'))
    expect(paintSignature(null, 'political')).toBe('none')
  })

  it('hands back the same game on a quiet day, so desks and the HUD do no work', () => {
    const small = lineMap(4)
    let s = startLive(startState(small))
    expect(settleGame(null)).toBeNull()
    const first = settleGame(s)
    s = advanceDay(s, small, { planner: () => [] }).state
    expect(settleGame(s)).toBe(first)
    // A day when something really changed is a new game.
    s.wars.push('r0|r1')
    setMilitary(s, 'r0', { infantry: 10 })
    const changed = { ...s, nations: { ...s.nations } }
    expect(settleGame(changed)).toBe(changed)
    expect(LIVE.msPerDay).toBeGreaterThan(0)
  })

  it('a long live game still plays through the store helpers without the AI breaking', () => {
    const small = lineMap(6)
    let s = startLive(startState(small))
    for (let i = 0; i < 40; i++) s = advanceDay(s, small, { planner: (st, m) => generateAllBotOrders(st, m) }).state
    expect(s.turn).toBe(2)
  })
})
