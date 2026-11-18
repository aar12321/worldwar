import { afterEach, describe, expect, it } from 'vitest'
import { BLOC } from '../../data/blocs'
import { describeOrder } from '../resolveTurn'
import { factionNews } from '../factions'
import { map, ok, world } from './blocFixtures'

/** The order tray and its "waiting for the 1st" note call it what the desk calls it: a bloc (the old word only with blocs off). */
describe('bloc orders read as bloc orders', () => {
  const was = BLOC.on
  afterEach(() => {
    BLOC.on = was
  })

  it('founding, inviting and leaving say "bloc", and "faction" only when blocs are switched off', () => {
    const s = world()
    BLOC.on = true
    expect(describeOrder(s, map, { type: 'factionFound', nationId: 'r0', name: 'Rhine Accord' })).toBe('Found the bloc Rhine Accord')
    expect(describeOrder(s, map, { type: 'factionInvite', nationId: 'r0', target: 'r1' })).toBe('Invite Region 1 to the bloc')
    expect(describeOrder(s, map, { type: 'factionLeave', nationId: 'r0' })).toBe('Leave the bloc')
    BLOC.on = false
    expect(describeOrder(s, map, { type: 'factionFound', nationId: 'r0', name: 'Rhine Accord' })).toBe('Found the faction Rhine Accord')
  })

  it("an invitation's note sends the player to the Bloc desk, the nav's name for it", () => {
    BLOC.on = true
    const s = world()
    ok(s, { type: 'factionFound', nationId: 'r0', name: 'Rhine Accord' })
    const before = structuredClone(s)
    ok(s, { type: 'factionInvite', nationId: 'r0', target: 'r1' })
    const note = factionNews(before, s, 'r1').find((t) => t.includes('invited you'))
    expect(note).toMatch(/See the Bloc desk\.$/)
  })
})
