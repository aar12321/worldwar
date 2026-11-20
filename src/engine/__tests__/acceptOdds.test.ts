import { describe, expect, it } from 'vitest'
import { botJoinsCall, CALL_NOISE, callOutlooks, joinCallOutlook } from '../../ai/blocs'
import { evaluateProposal, NOISE, offerOutlook, type OfferOutlook } from '../../ai/diplomat'
import { addOpinion } from '../../ai/opinion'
import { joinProblem } from '../bloc'
import { joinWarBlocked, propose } from '../diplomacy'
import { factionOf } from '../factions'
import { atWar, pairKey } from '../helpers'
import { applyOrderNow } from '../resolveTurn'
import { createRng, type Rng } from '../rng'
import type { Difficulty, GameState, NationId, PeaceTerms, Personality, Proposal, ProposalDraft } from '../types'
import { validatePeaceTerms } from '../warscore'
import { lineMap, setMilitary, startState } from './fixtures'

/**
 * Acceptance odds (docs/RELATIONS_STATUS.md, docs/BLOC_STATUS.md): over many random worlds, the outlook a screen shows is the AI's own
 * decision. "Likely" means it accepts on every draw, "unlikely" that it refuses on every draw, and "may" carries the real chance.
 */
const map = lineMap(8)
const IDS = Object.keys(map.regions)
const PERSONAS: Personality[] = ['expansionist', 'trader', 'turtle', 'opportunist', 'honorable']
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard']
const DRAWS = 60

/** A random world on the chain: armies, weariness, temperaments, opinions, wars with war scores, alliances and pacts. */
function randomWorld(seed: number): { s: GameState; r: Rng } {
  const r = createRng(seed * 7919 + 13)
  const s = startState(map, 'r0', seed)
  s.turn = 4 + r.int(0, 20)
  s.settings.difficulty = r.pick(DIFFS)
  for (const id of IDS) {
    const n = s.nations[id]
    if (!n) continue
    n.personality = r.pick(PERSONAS)
    n.warWeariness = r.int(0, 60)
    n.resources.capital = r.int(0, 800)
    setMilitary(s, id, { infantry: r.int(1, 30), armor: r.int(0, 10) })
    for (const other of IDS) if (other !== id && r.chance(0.3)) addOpinion(s, id, other, r.chance(0.5) ? 'Insulted us' : 'Helped us', r.int(-60, 60), 0.2)
  }
  for (let i = 0; i < IDS.length; i++)
    for (let j = i + 1; j < IDS.length; j++) {
      const k = pairKey(IDS[i], IDS[j])
      const roll = r.next()
      if (roll < 0.3) {
        s.wars.push(k)
        s.warStarted[k] = s.turn - r.int(0, 8)
        s.warScore[`${IDS[i]}>${IDS[j]}`] = r.int(0, 70)
        s.warScore[`${IDS[j]}>${IDS[i]}`] = r.int(0, 70)
      } else if (roll < 0.45) s.alliances.push(k)
      else if (roll < 0.5) s.pacts[k] = s.turn + 12
    }
  s.wars.sort()
  s.alliances.sort()
  return { s, r }
}

/** Random peace terms from `from` to `to`: regions either way, reparations, and now and then a puppet, a territory or a general peace. */
function randomTerms(s: GameState, r: Rng, from: NationId, to: NationId): PeaceTerms {
  const cede = IDS.filter((id) => (s.regions[id].owner === to || s.regions[id].owner === from) && s.nations[s.regions[id].owner]?.capital !== id && r.chance(0.3))
  const roll = r.next()
  return { cede, reparations: r.int(-30, 30), ...(roll < 0.2 ? { puppet: true } : roll < 0.35 ? { territory: true } : {}), ...(r.chance(0.2) ? { general: true } : {}) }
}

/** Checks one outlook against the decision itself on `DRAWS` real draws of the dice, each read exactly when the rule says how. */
function agree(s: GameState, to: NationId, from: NationId, draft: ProposalDraft, seed: number): OfferOutlook {
  const o = offerOutlook(s, map, to, from, draft)
  const p = { ...draft, id: 'x', from, to, created: s.turn, expires: s.turn + 1 } as Proposal
  let yes = 0
  for (let k = 0; k < DRAWS; k++) {
    const noise = createRng(seed * 31 + k).range(-NOISE, NOISE)
    const v = evaluateProposal(s, map, to, p, createRng(seed * 31 + k))
    if (o.outlook === 'likely') expect(v.accept, `${draft.kind} ${to}<-${from} likely but refused: ${v.reason}`).toBe(true)
    if (o.outlook === 'unlikely') expect(v.accept, `${draft.kind} ${to}<-${from} unlikely but accepted: ${v.reason}`).toBe(false)
    if (o.dice) expect(v.accept).toBe(o.dice.base + noise > o.dice.need)
    if (v.accept) yes++
  }
  if (o.outlook === 'unsure') {
    expect(o.chance).toBeGreaterThan(0)
    expect(o.chance).toBeLessThan(1)
    // Sixty draws: the share that said yes is within reach of the chance shown.
    expect(Math.abs(yes / DRAWS - o.chance)).toBeLessThan(0.25)
  } else expect(o.chance).toBe(o.outlook === 'likely' ? 1 : 0)
  return o
}

const tally = () => ({ likely: 0, unsure: 0, unlikely: 0 })

describe('peace odds match the AI that answers them', () => {
  it('over random wars and terms, likely accepts and unlikely refuses on every draw; the dice read exactly', () => {
    const seen = tally()
    let checked = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { s, r } = randomWorld(seed)
      for (const k of s.wars) {
        const [a, b] = k.split('|')
        const [from, to] = r.chance(0.5) ? [a, b] : [b, a]
        if (to === 'r0' || !s.nations[from]?.alive || !s.nations[to]?.alive) continue
        const draft: ProposalDraft = { kind: 'peace', terms: randomTerms(s, r, from, to) }
        seen[agree(s, to, from, draft, seed * 100 + checked).outlook]++
        checked++
      }
    }
    expect(checked).toBeGreaterThan(200)
    // Every verdict turns up, so each band is really tested.
    expect(seen.likely).toBeGreaterThan(10)
    expect(seen.unsure).toBeGreaterThan(10)
    expect(seen.unlikely).toBeGreaterThan(10)
  })

  it('changing the terms changes the odds: asking for more never makes peace likelier', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { s } = randomWorld(seed)
      const k = s.wars.find((w) => w.split('|').includes('r0'))
      if (!k) continue
      const to = k.split('|').find((x) => x !== 'r0')!
      let last = 2
      for (const reparations of [-30, -10, 0, 10, 30]) {
        const o = offerOutlook(s, map, to, 'r0', { kind: 'peace', terms: { cede: [], reparations } })
        expect(o.chance).toBeLessThanOrEqual(last)
        last = o.chance
      }
      const plain = offerOutlook(s, map, to, 'r0', { kind: 'peace', terms: { cede: [], reparations: 0 } })
      const puppet = offerOutlook(s, map, to, 'r0', { kind: 'peace', terms: { cede: [], reparations: 0, puppet: true } })
      expect(puppet.chance).toBeLessThanOrEqual(plain.chance)
      expect(puppet.dice!.need).toBe(8)
    }
  })

  it('the offer a player sends is settled the same way: a likely peace ends the war, an unlikely one does not', () => {
    let likely = 0
    let unlikely = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { s, r } = randomWorld(seed)
      for (const k of [...s.wars]) {
        const [from, to] = k.split('|')
        if (to === 'r0') continue
        const terms = randomTerms(s, r, from, to)
        if (validatePeaceTerms(s, map, terms, from, to) !== null) continue
        const o = offerOutlook(s, map, to, from, { kind: 'peace', terms })
        if (o.outlook === 'unsure') continue
        const t = structuredClone(s)
        propose(t, map, from, to, { kind: 'peace', terms }, createRng(seed))
        expect(atWar(t, from, to), `${from} -> ${to}: ${o.outlook} "${o.reason}"`).toBe(o.outlook === 'unlikely')
        if (o.outlook === 'likely') likely++
        else unlikely++
      }
    }
    expect(likely).toBeGreaterThan(5)
    expect(unlikely).toBeGreaterThan(5)
  })
})

describe('treaty, trade and call-to-arms odds match the AI too', () => {
  it('pacts, alliances, guarantees, trade and calls to arms: the verdict holds on every draw', () => {
    const seen = tally()
    for (let seed = 1; seed <= 40; seed++) {
      const { s, r } = randomWorld(seed)
      for (const to of IDS.slice(1)) {
        if (!s.nations[to]?.alive) continue
        const from = r.pick(IDS.filter((x) => x !== to && s.nations[x]?.alive))
        const drafts: ProposalDraft[] = [{ kind: 'pact' }, { kind: 'alliance' }, { kind: 'guarantee' }, { kind: 'trade', terms: { give: { capital: r.int(0, 60) }, receive: { food: r.int(1, 30) }, months: r.pick([0, 3]) } }]
        const foe = IDS.find((e) => e !== to && atWar(s, from, e))
        if (foe) drafts.push({ kind: 'callToArms', enemy: foe })
        for (const d of drafts) seen[agree(s, to, from, d, seed * 1000 + IDS.indexOf(to) * 10 + drafts.indexOf(d)).outlook]++
      }
    }
    expect(seen.likely).toBeGreaterThan(10)
    expect(seen.unsure).toBeGreaterThan(10)
    expect(seen.unlikely).toBeGreaterThan(10)
  })

  it('a call to arms reads its score exactly, like peace', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { s } = randomWorld(seed)
      const k = s.wars[0]
      if (!k) continue
      const [from, enemy] = k.split('|')
      const ally = IDS.find((x) => x !== from && x !== enemy && !atWar(s, x, enemy))
      if (!ally) continue
      const o = offerOutlook(s, map, ally, from, { kind: 'callToArms', enemy })
      if (o.dice) expect(o.factors!.reduce((a, f) => a + f.value, 0)).toBe(o.dice.base)
    }
  })
})

/** A bloc of r0 (a player), r1 and r2 at war with r4; r3 sometimes a member too. */
function blocWorld(seed: number): { s: GameState; members: NationId[] } {
  const { s, r } = randomWorld(seed)
  s.humans = ['r0']
  for (const id of IDS) s.nations[id].isPlayer = id === 'r0'
  s.wars = s.wars.filter((k) => !k.split('|').includes('r0') || k === pairKey('r0', 'r4'))
  s.alliances = s.alliances.filter((k) => !k.includes('r4'))
  if (!s.wars.includes(pairKey('r0', 'r4'))) s.wars.push(pairKey('r0', 'r4'))
  s.wars.sort()
  s.nations.r0.resources.pp = 400
  const members = ['r1', 'r2', ...(r.chance(0.5) ? ['r3'] : [])]
  expect(applyOrderNow(s, map, { type: 'factionFound', nationId: 'r0', name: 'Pact' }).error).toBeNull()
  const f = factionOf(s, 'r0')!
  for (const m of members) f.members.push(m)
  if (r.chance(0.3)) f.bloc!.xp = 10_000
  return { s, members }
}

describe('bloc call-to-arms odds match the rivals that answer', () => {
  it('over random worlds, each member: likely joins on every draw, unlikely never, and the dice read exactly', () => {
    const seen = { ...tally(), human: 0 }
    for (let seed = 1; seed <= 80; seed++) {
      const { s } = blocWorld(seed)
      const f = factionOf(s, 'r0')!
      for (const { id: m, o } of callOutlooks(s, map, f, 'r0', 'r4', false).members) {
        seen[o.outlook]++
        // Easy rivals are never asked, and a yes that starts no war is no help: the outlook says so without the dice.
        if (!o.dice) continue
        for (let k = 0; k < DRAWS; k++) {
          const noise = createRng(seed * 977 + k).range(-CALL_NOISE, CALL_NOISE)
          const joins = botJoinsCall(s, map, m, 'r0', 'r4', createRng(seed * 977 + k))
          if (o.outlook === 'likely') expect(joins).toBe(true)
          if (o.outlook === 'unlikely') expect(joins).toBe(false)
          expect(joins).toBe(o.dice.base + noise > o.dice.need)
        }
      }
      expect(joinCallOutlook(s, map, 'r0', 'r1', 'r4', false).outlook).toBe('human')
    }
    expect(seen.likely).toBeGreaterThan(5)
    expect(seen.unsure).toBeGreaterThan(5)
    expect(seen.unlikely).toBeGreaterThan(5)
  })

  it('a call the leader makes is answered as shown, through the real orders: at once with Mutual Defence, then each rival in turn', () => {
    let atOnce = 0
    let answered = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { s } = blocWorld(seed)
      const f = factionOf(s, 'r0')!
      const before = callOutlooks(s, map, f, 'r0', 'r4', true).members
      const warsBefore = [...s.wars]
      expect(applyOrderNow(s, map, { type: 'blocCall', nationId: 'r0', target: 'r4' }).error).toBeNull()
      const call = f.bloc!.calls.find((c) => c.target === 'r4')!
      for (const { id: m, o } of before) {
        if (o.atOnce) {
          atOnce++
          expect(atWar(s, m, 'r4'), `${m}: ${o.reason}`).toBe(true)
          continue
        }
        if (o.outlook === 'unlikely' && !warsBefore.includes(pairKey(m, 'r4')) && atWar(s, m, 'r4')) throw new Error(`${m} joined at once though shown unlikely: ${o.reason}`)
        // Easy rivals are never asked; a member with a reason it cannot join is skipped by its answer.
        if (o.reason.startsWith('Rivals on this difficulty') || joinProblem(s, m, 'r4') || atWar(s, m, 'r4') || call.answers[m]) continue
        // Another member that answered first may have taken the enemy's last free war.
        const room = !joinWarBlocked(s, m, 'r4')
        const join = botJoinsCall(s, map, m, 'r0', 'r4', createRng(seed * 13 + answered))
        expect(applyOrderNow(s, map, { type: 'blocAnswer', nationId: m, callId: call.id, join }).error).toBeNull()
        answered++
        if (o.outlook === 'likely' && room) expect(atWar(s, m, 'r4'), `${m}: ${o.reason}`).toBe(true)
        if (o.outlook === 'unlikely') expect(atWar(s, m, 'r4'), `${m}: ${o.reason}`).toBe(false)
      }
    }
    expect(atOnce).toBeGreaterThan(3)
    expect(answered).toBeGreaterThan(20)
  })

  it('an enemy at its limit of wars takes nobody more: every member is shown unlikely, with why', () => {
    const { s } = blocWorld(5)
    const f = factionOf(s, 'r0')!
    for (const id of ['r5', 'r6', 'r7']) if (!atWar(s, id, 'r4')) s.wars.push(pairKey(id, 'r4'))
    s.wars.sort()
    for (const { o } of callOutlooks(s, map, f, 'r0', 'r4', true).members) {
      expect(o.outlook).toBe('unlikely')
      expect(o.reason).toMatch(/all the wars it can|Already at war|too many wars/)
    }
  })
})
