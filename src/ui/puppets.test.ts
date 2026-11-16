import { describe, expect, it } from 'vitest'
import { advise } from '../engine/advisor'
import { bindPuppet } from '../engine/puppets'
import { lineMap, startState } from '../engine/__tests__/fixtures'
import { regCtxOf } from './regCtx'
import { NO_CTX } from './shortcuts'
import { findTab, visibleTabs } from './registry'

const map = lineMap(6)

describe('the Puppets tab', () => {
  it('is registered on the Empire desk, and shows only while you rule a puppet', () => {
    expect(findTab('empire', 'puppets')).toBeDefined()
    expect(visibleTabs('empire', NO_CTX).map((t) => t.id)).not.toContain('puppets')
    const s = startState(map, 'r0', 3)
    expect(visibleTabs('empire', regCtxOf(s)).map((t) => t.id)).not.toContain('puppets')
    bindPuppet(s, 'r1', 'r0')
    const ctx = regCtxOf(s)
    expect(ctx.puppets).toBe(1)
    expect(visibleTabs('empire', ctx).map((t) => t.id)).toContain('puppets')
  })

  it('loads a component', async () => {
    const tab = findTab('empire', 'puppets')!
    const mod = await tab.load!()
    expect(typeof mod.default).toBe('function')
  })
})

describe('the advisor and puppets', () => {
  it('warns about a restive puppet, urgently when it is about to revolt, and says nothing of a loyal one', () => {
    const s = startState(map, 'r0', 3)
    bindPuppet(s, 'r1', 'r0')
    expect(advise(s, map, 'r0', [], 30).some((a) => a.id === 'puppet-r1')).toBe(false)
    s.nations.r1.loyalty = 30
    const soon = advise(s, map, 'r0', [], 30).find((a) => a.id === 'puppet-r1')
    expect(soon?.urgency).toBe('soon')
    expect(soon?.target).toEqual({ desk: 'empire', tab: 'puppets' })
    s.nations.r1.loyalty = 10
    expect(advise(s, map, 'r0', [], 30).find((a) => a.id === 'puppet-r1')?.urgency).toBe('now')
  })
})
