import { describe, expect, it } from 'vitest'
import { sceneKey } from '../sceneKey'
import { lineMap, startState } from './fixtures'

describe('scene key', () => {
  it('ignores the clock and march progress', () => {
    const map = lineMap(2)
    const state = startState(map)
    const army = Object.values(state.armies)[0]
    army.march = {
      kind: 'move',
      to: 'r1',
      territoryId: 't',
      fromLat: 1,
      fromLng: 2,
      toLat: 3,
      toLng: 4,
      progress: 0.1,
      duration: 8,
    }
    const before = sceneKey(state)
    army.march.progress = 0.85
    state.simTime += 4
    state.monthElapsed += 4
    state.trainingQueue.push({
      id: 'q',
      nationId: 'r0',
      territoryId: 'r0:0',
      unit: 'infantry',
      remaining: 3,
      total: 10,
      orderedTurn: 1,
      clock: 'time',
    })
    expect(sceneKey(state)).toBe(before)
    army.location = 'r1'
    expect(sceneKey(state)).not.toBe(before)
  })
})
