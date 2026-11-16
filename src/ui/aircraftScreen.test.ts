import { beforeEach, describe, expect, it } from 'vitest'
import { AIRCRAFT_NODES } from '../data/aircraft'
import { devView } from '../engine/aircraft'
import { applyOrderNow } from '../engine/resolveTurn'
import { getWorld } from '../map/world'
import { liveHold, useGame } from '../store'

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
  useGame.setState({ online: null, fxQueue: [], summary: null, liveNote: null, warRoom: null, aircraftOpen: false, helpOpen: false, paletteOpen: false, confirm: null, running: false })
})

describe('the aircraft development screen', () => {
  it('opens and closes from the store, and a new game never starts with it open', () => {
    useGame.getState().newGame({ playerRegionId: 'germany', seed: 3, difficulty: 'normal', mode: 'live' })
    expect(useGame.getState().aircraftOpen).toBe(false)
    useGame.getState().setAircraftOpen(true)
    expect(useGame.getState().aircraftOpen).toBe(true)
    useGame.getState().newGame({ playerRegionId: 'germany', seed: 4, difficulty: 'normal' })
    expect(useGame.getState().aircraftOpen).toBe(false)
  })

  it('holds a live clock while it is open, as the War Room does', () => {
    useGame.getState().newGame({ playerRegionId: 'germany', seed: 3, difficulty: 'normal', mode: 'live' })
    expect(liveHold(useGame.getState())).toBeNull()
    useGame.setState({ aircraftOpen: true })
    expect(liveHold(useGame.getState())).toBe('planning')
  })

  it('the orders its buttons send go through the store and take effect at once', () => {
    useGame.getState().newGame({ playerRegionId: 'germany', seed: 3, difficulty: 'normal' })
    const g = structuredClone(useGame.getState().game!)
    const me = g.nations.germany
    me.techs.push('air_propeller')
    me.resources.tp = 100
    me.resources.capital = 500
    useGame.setState({ game: g })
    expect(useGame.getState().issueOrder({ type: 'startAircraftDev', nationId: 'germany', node: 'radar' })).toBe(true)
    const after = useGame.getState().game!.nations.germany
    expect(after.aircraft?.radar).toEqual({ progress: 0, done: false })
    expect(after.resources.tp).toBe(100 - AIRCRAFT_NODES.radar.tp)
    expect(devView(useGame.getState().game!, after, 'radar').status).toBe('active')
    // Nothing waits in the orders tray: a development begins the moment it is ordered.
    expect(useGame.getState().orders.some((o) => o.type === 'startAircraftDev')).toBe(false)
    // The same order from the engine directly is refused the second time.
    expect(applyOrderNow(structuredClone(useGame.getState().game!), map, { type: 'startAircraftDev', nationId: 'germany', node: 'radar' }).error).toMatch(/Already under way/)
  })
})
