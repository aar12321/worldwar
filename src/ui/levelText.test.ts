import { describe, expect, it } from 'vitest'
import { AGENCY, agencyLevelText } from '../data/agencies'
import { lineKindName } from './missileProgramText'
import { PROGRAM_SECTIONS, isProgramSection } from './programSection'

describe('one "Raise to level N+1" action, with what later levels do in a few words', () => {
  it('an agency level names the teams and the operations it opens', () => {
    expect(agencyLevelText('foreign', 2)).toMatch(/^2 teams a month; opens .*sabotage industry.*arm rebels/)
    expect(agencyLevelText('foreign', 4)).toMatch(/back a coup/)
    expect(agencyLevelText('domestic', 2)).toMatch(/break up rebels/)
    // A level that opens nothing new still says what it adds.
    expect(agencyLevelText('foreign', AGENCY.maxLevel)).toMatch(/better odds/)
  })
})

describe('the Missile Program tab', () => {
  it('has the six sections, Overview first, and the production line names interceptor rounds', () => {
    expect(PROGRAM_SECTIONS.map(([id]) => id)).toEqual(['overview', 'facilities', 'staff', 'development', 'arsenal', 'rivals'])
    expect(isProgramSection('arsenal')).toBe(true)
    expect(isProgramSection('program')).toBe(false)
    expect(lineKindName('interceptor')).toBe('interceptor rounds')
    expect(lineKindName('cruise')).toBe('cruise missiles')
  })
})
