import { describe, expect, it } from 'vitest'
import { createInitialState } from '../data/startingNations'
import { factionOf } from '../engine/factions'
import { pairKey } from '../engine/helpers'
import { inviteCandidates } from '../engine/partners'
import { applyOrderNow } from '../engine/resolveTurn'
import type { GameState } from '../engine/types'
import { getWorld } from '../map/world'
import { closeNations } from './diplomacyList'
import { factionChip, inviteItems, pickerMatches } from './pickerItems'

/**
 * The reported bug, on the real world of 175 nations: a pact partner could not be found in the invitation list.
 * It sat below a hundred stronger nations, in a box five rows tall, with no mark that a pact was a partnership.
 */
const { map } = getWorld()

function game(): GameState {
  const s = createInitialState(map, { playerRegionId: 'germany', seed: 1, difficulty: 'normal' })
  s.nations.germany.resources.pp = 500
  const r = applyOrderNow(s, map, { type: 'factionFound', nationId: 'germany', name: 'Iron Pact' })
  expect(r.error).toBeNull()
  return s
}

describe('the invitation list on the real world', () => {
  it('puts a small pact partner at the top, with its relation, however far down the strength ranking it is', () => {
    const s = game()
    s.pacts[pairKey('germany', 'albania')] = s.turn + 20
    s.pacts[pairKey('germany', 'croatia')] = s.turn + 20
    s.guarantees.push({ from: 'germany', to: 'belgium', until: s.turn + 20 })
    const f = factionOf(s, 'germany')!
    const items = inviteItems(s, inviteCandidates(s, map, 'germany', f, []))
    expect(items.length).toBe(Object.values(s.nations).filter((n) => n.alive).length - 1)
    const top = items.slice(0, 3).map((i) => i.id).sort()
    expect(top).toEqual(['albania', 'belgium', 'croatia'])
    expect(items.slice(0, 3).every((i) => i.group === 'Your partners')).toBe(true)
    expect(items[3].group).toBe('Everyone else')
    const albania = items.find((i) => i.id === 'albania')!
    expect(albania.chips?.map((c) => c.text)).toContain('Pact')
    expect(items.find((i) => i.id === 'belgium')!.chips?.map((c) => c.text)).toContain('You guarantee')
    expect(albania.note).toMatch(/\(.*\d\)/)
    expect(albania.why).toBeNull()
  })

  it('keeps a partner that is in another faction in the list, explained and not choosable', () => {
    const s = game()
    s.pacts[pairKey('germany', 'albania')] = s.turn + 20
    s.factions!.push({ ...structuredClone(factionOf(s, 'germany')!), id: 'f2', name: 'Balkan League', founder: 'albania', members: ['albania'], invites: [] })
    const f = factionOf(s, 'germany')!
    const items = inviteItems(s, inviteCandidates(s, map, 'germany', f, []))
    const albania = items.find((i) => i.id === 'albania')!
    expect(albania.why).toMatch(/already in a faction \(Balkan League\)/)
    expect(albania.chips?.map((c) => c.text)).toEqual(expect.arrayContaining(['Pact', 'In Balkan League']))
    // It is the only partner, so it still heads the list, with its reason, instead of vanishing.
    expect(items[0]).toMatchObject({ id: 'albania', group: 'Your partners' })
  })

  it('finds a nation by its relation word as well as its name', () => {
    const s = game()
    s.alliances.push(pairKey('germany', 'france'))
    const f = factionOf(s, 'germany')!
    const items = inviteItems(s, inviteCandidates(s, map, 'germany', f, []))
    expect(items.filter((i) => pickerMatches(i, 'ally')).map((i) => i.id)).toEqual(['france'])
    expect(items.filter((i) => pickerMatches(i, 'fran')).map((i) => i.id)).toContain('france')
    expect(items.filter((i) => pickerMatches(i, 'partners')).length).toBe(1)
  })

  it('marks a nation in a faction on the Diplomacy list, yours or theirs', () => {
    const s = game()
    expect(factionChip(s, 'albania', 'germany')).toBeNull()
    expect(factionChip(s, 'germany', 'germany')).toMatchObject({ text: 'In your faction', tone: 'good' })
    s.factions!.push({ ...structuredClone(factionOf(s, 'germany')!), id: 'f2', name: 'Balkan League', founder: 'albania', members: ['albania'], invites: [] })
    expect(factionChip(s, 'albania', 'germany')).toMatchObject({ text: 'In Balkan League', tone: 'none' })
  })
})

describe('the Diplomacy list', () => {
  it('lists a pact partner or a guarantee across the sea even though it is no neighbor and has no deal', () => {
    const s = game()
    expect(closeNations(s, 'germany', [])).not.toContain('chile')
    s.pacts[pairKey('germany', 'chile')] = s.turn + 20
    s.guarantees.push({ from: 'japan', to: 'germany', until: s.turn + 20 })
    const list = closeNations(s, 'germany', [])
    expect(list).toContain('chile')
    expect(list).toContain('japan')
    // Partners come before plain neighbors.
    expect(closeNations(s, 'germany', ['france'])[0]).not.toBe('france')
  })

  it('lists the members of your faction, and the nation you came for', () => {
    const s = game()
    factionOf(s, 'germany')!.members.push('peru')
    expect(closeNations(s, 'germany', [])).toContain('peru')
    expect(closeNations(s, 'germany', [], 'kenya')).toContain('kenya')
    expect(closeNations(s, 'germany', [], 'germany')).not.toContain('germany')
  })
})
