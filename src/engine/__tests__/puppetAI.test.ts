import { describe, expect, it } from 'vitest'
import { peaceTerms } from '../../ai/bot'
import { PUPPET_GARRISON_CAP, deploymentOrder, plannedPosture } from '../../ai/deployment'
import { PUPPET_AI, wantsPuppet } from '../../ai/puppets'
import { PUPPET } from '../../data/puppets'
import { garrisonDivisions } from '../deployment'
import { giveRegions, lineMap, setMilitary, startState } from './fixtures'
import { bindPuppet, pressureOf } from '../puppets'
import { resolveTurn } from '../resolveTurn'
import { validatePeaceTerms, puppetValue } from '../warscore'
import type { GameState } from '../types'

const map = lineMap(10)

/** r0 is the winner at war with r4, a nation holding r4 to r6 (land worth ruling). */
function world(): GameState {
  const s = startState(map, 'r0', 3)
  s.humans = []
  giveRegions(s, 'r4', ['r5', 'r6'])
  giveRegions(s, 'r0', ['r1', 'r2', 'r3'])
  s.wars.push('r0|r4')
  s.warStarted['r0|r4'] = s.turn - 8
  s.warScore['r0>r4'] = 80
  return s
}

describe('bots make puppets at the peace table', () => {
  it('Easy never does, at any score', () => {
    expect(wantsPuppet(world(), map, 'r0', 'r4', 100, 0)).toBe(false)
    expect(peaceTerms(world(), map, 'r0', 'r4', 100, false, 0).puppet).toBeUndefined()
  })

  it('Medium needs a decisive win (30), Hard a clear one (25)', () => {
    const s = world()
    expect(wantsPuppet(s, map, 'r0', 'r4', PUPPET_AI.minNet[1] - 1, 1)).toBe(false)
    expect(wantsPuppet(s, map, 'r0', 'r4', PUPPET_AI.minNet[1] + 20, 1)).toBe(true)
    expect(wantsPuppet(s, map, 'r0', 'r4', PUPPET_AI.minNet[2] - 1, 2)).toBe(false)
    const need = Math.ceil(puppetValue(s, map, 'r4') / 0.85)
    expect(wantsPuppet(s, map, 'r0', 'r4', Math.max(PUPPET_AI.minNet[2], need), 2)).toBe(true)
    // Medium's bar is out of Hard's reach when the price is higher: it also needs the war score to pay for the puppet.
    expect(wantsPuppet(s, map, 'r0', 'r4', 26, 1)).toBe(false)
  })

  it('the terms are valid peace terms and the war score pays for them', () => {
    const s = world()
    const t = peaceTerms(s, map, 'r0', 'r4', 80, false, 2)
    expect(t.puppet).toBe(true)
    expect(validatePeaceTerms(s, map, t, 'r0', 'r4')).toBeNull()
  })

  it('not a tiny nation: a country of little worth is taken, not ruled', () => {
    const s = startState(map, 'r0', 3)
    s.humans = []
    s.wars.push('r0|r4')
    s.regions.r4.population = 0.5
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 2)).toBe(false)
  })

  it('never a nation that is a puppet already, nor one asking as a puppet', () => {
    const s = world()
    bindPuppet(s, 'r4', 'r8')
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 2)).toBe(false)
    const t = world()
    bindPuppet(t, 'r0', 'r8')
    expect(wantsPuppet(t, map, 'r0', 'r4', 90, 2)).toBe(false)
  })

  it('a cap on puppets per master: Medium one, Hard three, and no more than 1 + half its countries', () => {
    const s = world() // r0 holds four countries: room for three
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 1)).toBe(true)
    bindPuppet(s, 'r7', 'r0')
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 1)).toBe(false)
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 2)).toBe(true)
    bindPuppet(s, 'r8', 'r0')
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 2)).toBe(true)
    bindPuppet(s, 'r9', 'r0')
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 2)).toBe(false)
    // One country less and the half-of-its-countries rule bites first: 1 + floor(3 / 2) = 2.
    const small = world()
    small.regions.r3.owner = 'r9'
    bindPuppet(small, 'r7', 'r0')
    expect(wantsPuppet(small, map, 'r0', 'r4', 90, 2)).toBe(true)
    bindPuppet(small, 'r8', 'r0')
    expect(wantsPuppet(small, map, 'r0', 'r4', 90, 2)).toBe(false)
  })

  it('the loser\'s own puppets pass up to the winner, so they count against the cap', () => {
    const s = world()
    bindPuppet(s, 'r7', 'r4')
    bindPuppet(s, 'r8', 'r4')
    bindPuppet(s, 'r9', 'r4')
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 2)).toBe(false)
  })

  it('never a country that out-earns its master', () => {
    const s = world()
    giveRegions(s, 'r4', ['r1', 'r2', 'r3', 'r7', 'r8'])
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 2)).toBe(false)
  })

  it('a human master is left to choose for itself', () => {
    const s = world()
    s.humans = ['r0']
    expect(wantsPuppet(s, map, 'r0', 'r4', 90, 2)).toBe(false)
  })
})

describe('a bot master garrisons a shaky puppet beside it', () => {
  /** r0 rules r1, which holds three countries and needs 4.5 divisions for full cover: more than the 5% every neighbor gets. */
  function ruled(loyalty: number) {
    const s = startState(map, 'r0', 3)
    s.humans = []
    giveRegions(s, 'r1', ['r2', 'r3'])
    setMilitary(s, 'r0', { infantry: 40, armor: 10 })
    bindPuppet(s, 'r1', 'r0')
    s.nations.r1.loyalty = loyalty
    return s
  }
  const share = (s: GameState, skill: 0 | 1 | 2) => plannedPosture(s, map, 'r0', skill).border.r1 ?? 0

  it('Medium and Hard post enough troops for full cover in a puppet that is not loyal, Easy does not', () => {
    const s = ruled(45)
    // 3 countries x 1.5 divisions = 4.5 of 50: 9%, rounded up to 10%.
    expect(share(s, 2)).toBeCloseTo(0.1, 6)
    expect(share(s, 1)).toBeCloseTo(0.1, 6)
    expect(share(s, 0)).toBeLessThan(0.1)
  })

  it('no more than the cap, and none beyond the ordinary post where the puppet is loyal', () => {
    const s = ruled(45)
    s.nations.r1.loyalty = 45
    setMilitary(s, 'r0', { infantry: 6, armor: 0 })
    expect(share(s, 2)).toBeLessThanOrEqual(PUPPET_GARRISON_CAP + 1e-9)
    expect(share(ruled(PUPPET.high + 5), 2)).toBeLessThan(0.1)
    expect(share(ruled(PUPPET.high - 5), 2)).toBeLessThan(0.1)
  })

  it('a puppet that is not a land neighbor is not garrisoned', () => {
    const s = startState(map, 'r0', 3)
    s.humans = []
    setMilitary(s, 'r0', { infantry: 40, armor: 10 })
    bindPuppet(s, 'r5', 'r0')
    s.nations.r5.loyalty = 40
    expect(plannedPosture(s, map, 'r0', 2).border.r5).toBeUndefined()
  })

  it('the order goes out, the troops stand there, and the pressure report names the garrison', () => {
    let s = ruled(45)
    const order = deploymentOrder(s, map, 'r0', 2)
    expect(order).not.toBeNull()
    s = resolveTurn(s, map, [order!])
    expect(garrisonDivisions(s, 'r0', 'r1')).toBeGreaterThanOrEqual(4.4)
    const parts = pressureOf(s, map, s.nations.r1).parts
    expect(parts.find((p) => p.label === 'Garrison of the master')?.value).toBeGreaterThan(0.7)
  })

  it('keeps a garrison already posted until the puppet is loyal (no flapping at the line)', () => {
    let s = ruled(45)
    s = resolveTurn(s, map, [deploymentOrder(s, map, 'r0', 2)!])
    s.nations.r1.loyalty = PUPPET.high - 5
    expect(share(s, 2)).toBeCloseTo(0.1, 6)
    s.nations.r1.loyalty = PUPPET.high + 5
    expect(share(s, 2)).toBeLessThan(0.1)
  })
})
