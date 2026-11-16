import { describe, expect, it } from 'vitest'
import { advise } from '../engine/advisor'
import { bindTerritory } from '../engine/territories'
import { lineMap, setMilitary, startState } from '../engine/__tests__/fixtures'
import { regCtxOf } from './regCtx'
import { NO_CTX } from './shortcuts'
import { findTab, visibleTabs } from './registry'

const map = lineMap(6)

describe('the Territories tab', () => {
  it('is registered on the Empire desk, and shows only while you hold a territory', () => {
    expect(findTab('empire', 'territories')).toBeDefined()
    expect(visibleTabs('empire', NO_CTX).map((t) => t.id)).not.toContain('territories')
    const s = startState(map, 'r0', 3)
    expect(visibleTabs('empire', regCtxOf(s)).map((t) => t.id)).not.toContain('territories')
    bindTerritory(s, 'r1', 'r0')
    const ctx = regCtxOf(s)
    expect(ctx.territories).toBe(1)
    expect(visibleTabs('empire', ctx).map((t) => t.id)).toContain('territories')
  })

  it('loads a component', async () => {
    const mod = await findTab('empire', 'territories')!.load!()
    expect(typeof mod.default).toBe('function')
  })

  it('the advisor notices an idle territory army and goods to sell', () => {
    const s = startState(map, 'r0', 3)
    bindTerritory(s, 'r1', 'r0')
    setMilitary(s, 'r1', { infantry: 8 })
    s.nations.r1.resources.oil = 200
    s.wars.push('r0|r3', 'r1|r3')
    s.turn = 10
    const ids = advise(s, map, 'r0', [], 40).map((a) => a.id)
    expect(ids).toContain('territory-army-r1')
    expect(ids).toContain('territory-trade-r1')
  })
})
