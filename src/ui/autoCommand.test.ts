import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_AUTO } from '../engine/commander'
import { setMilitary } from '../engine/__tests__/fixtures'
import { applyOrderNow, describeOrder, resolveTurn } from '../engine/resolveTurn'
import { getWorld } from '../map/world'
import { keptOrder, sanitizeAuto, useGame } from '../store'

const { map } = getWorld()

/** A turn game in the store: Germany at war with Poland and France, with an army and AI Battle Command at `level`. */
function game(level: number) {
  useGame.getState().newGame({ playerRegionId: 'germany', seed: 3, difficulty: 'normal' })
  const g = structuredClone(useGame.getState().game!)
  g.wars.push('germany|poland', 'france|germany')
  g.nations.germany.resources.capital = 3000
  g.nations.germany.systems = { ...g.nations.germany.systems, ai: level, cyber: 0, shield: 0, quantum: 0, orbital: 0, nano: 0 }
  setMilitary(g, 'germany', { infantry: 40, armor: 14, artillery: 8, fighter: 6, air: 6 })
  setMilitary(g, 'poland', { infantry: 8 })
  setMilitary(g, 'france', { infantry: 9 })
  useGame.setState({ game: g, orders: [], autoCommand: { ...DEFAULT_AUTO } })
  return g
}

describe('auto-command in the store', () => {
  beforeEach(() => {
    useGame.setState({ online: null, fxQueue: [], summary: null, warRoom: null, helpOpen: false, running: false, orders: [], autoCommand: { ...DEFAULT_AUTO } })
  })

  it('needs AI Battle Command level 3', () => {
    game(2)
    useGame.getState().setAutoCommand({ on: true })
    expect(useGame.getState().autoCommand.on).toBe(false)
    expect(useGame.getState().orders).toHaveLength(0)
  })

  it('queues the month in the tray, marked as auto, within the limits, and switching it off takes them out', () => {
    game(3)
    useGame.getState().setAutoCommand({ on: true, maxAttacks: 2, minWin: 0.5, reserve: 0.3 })
    const orders = useGame.getState().orders
    const autos = orders.filter((o) => o.type === 'attack' && o.auto)
    expect(autos.length).toBeGreaterThan(0)
    expect(autos.length).toBeLessThanOrEqual(2)
    expect(describeOrder(useGame.getState().game!, map, autos[0])).toMatch(/^Auto-command: Attack /)
    // Each one is a plain attack that names its units.
    for (const o of autos) if (o.type === 'attack') expect(o.units).toBeTruthy()
    // The player can take one out before the month ends.
    const idx = useGame.getState().orders.findIndex((o) => o.type === 'attack' && o.auto)
    useGame.getState().removeOrder(idx)
    expect(useGame.getState().orders.filter((o) => o.type === 'attack' && o.auto)).toHaveLength(autos.length - 1)
    // A hand-made order for something else survives switching it off.
    useGame.getState().setPolicy({ taxRate: 0.31 })
    useGame.getState().setAutoCommand({ on: false })
    expect(useGame.getState().orders.some((o) => o.type === 'attack' && o.auto)).toBe(false)
    expect(useGame.getState().orders.some((o) => o.type === 'setPolicy')).toBe(true)
  })

  it('the queued attacks are fought when the month ends, and the next month is planned again', () => {
    const g = game(3)
    useGame.getState().setAutoCommand({ on: true, maxAttacks: 1, minWin: 0.4, reserve: 0.2 })
    const queued = useGame.getState().orders.filter((o) => o.type === 'attack' && o.auto)
    expect(queued).toHaveLength(1)
    const before = g.battles.length
    useGame.getState().endTurn()
    const after = useGame.getState().game!
    expect(after.battles.length).toBeGreaterThan(before)
    expect(after.battles.some((b) => b.attacker.nationId === 'germany' && b.chosen)).toBe(true)
    // The standing auto-command planned the new month straight away, if there is anything left to attack.
    expect(useGame.getState().autoCommand.on).toBe(true)
  }, 120_000)

  it('its planned attacks survive a reload of the tray, and an ordinary attack does not', () => {
    const planned = { type: 'attack' as const, nationId: 'germany', target: 'poland', units: { infantry: 4 }, auto: true }
    expect(keptOrder(planned, 'germany')).toBe(true)
    expect(keptOrder({ ...planned, auto: undefined }, 'germany')).toBe(false)
    expect(keptOrder({ ...planned, units: undefined }, 'germany')).toBe(false)
    expect(keptOrder(planned, 'france')).toBe(false)
  })

  it('keeps its limits sane', () => {
    expect(sanitizeAuto({ maxAttacks: 99, reserve: 5, minWin: -1, objective: 'nonsense' as never })).toEqual({ on: false, objective: 'win', maxAttacks: 9, reserve: 0.9, minWin: 0.3 })
  })

  it('a hand-sent named attack and the engine agree (turn game)', () => {
    const g = game(0)
    const { battle, error } = applyOrderNow(structuredClone(g), map, { type: 'attack', nationId: 'germany', target: 'poland', stance: 'assault', units: { infantry: 20, armor: 6 } })
    expect(error).toBeNull()
    expect(battle!.attacker.units.infantry).toBeCloseTo(20)
    void resolveTurn
  })
})
