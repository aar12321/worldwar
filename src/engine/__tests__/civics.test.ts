import { describe, expect, it } from 'vitest'
import { CABINET, CIVICS, MINISTRIES, PIPELINE, POLICY_AREAS, POLICY_SPECS, PROFESSIONS, SECTORS_ORDER, SERVICE, TALENT, type CivicsAction } from '../../data/civics'
import { manageCivics } from '../../ai/civics'
import { opinionReport } from '../../ai/opinion'
import {
  applyCivics,
  candidatesFor,
  civicsEffects,
  civicsProblem,
  cleanCivics,
  currentOption,
  draftSpeed,
  employmentOf,
  groupReport,
  ministerPower,
  newCivics,
  passChance,
  professionCoverage,
  talentReport,
  talentSupply,
} from '../civics'
import { computeEconomy } from '../economy'
import { daysInMonth } from '../calendar'
import { advanceDay, startLive } from '../live'
import { normalizeGame } from '../migrate'
import { jobsParts, jobsTarget } from '../people'
import { applyOrderNow, resolveTurn } from '../resolveTurn'
import { validateOrder } from '../orders'
import type { GameState, Order } from '../types'
import { lineMap, startState } from './fixtures'

const map = lineMap(6)

function game(seed = 4): GameState {
  const s = startState(map, 'r0', seed)
  s.nations.r0.resources.capital = 2000
  s.nations.r0.resources.pp = 300
  return s
}

const civ = (action: CivicsAction, nationId = 'r0'): Order => ({ type: 'civics', nationId, action })

/** Runs `fn` with a value changed, and puts it back. */
function withValue<T extends object, K extends keyof T>(obj: T, key: K, value: T[K], fn: () => void) {
  const old = obj[key]
  obj[key] = value
  try {
    fn()
  } finally {
    obj[key] = old
  }
}

/** The economy's numbers that the desk could move. */
const econNumbers = (s: GameState, id = 'r0') => {
  const e = computeEconomy(s, map, id)
  return { net: e.netCapital, stability: e.stabilityTarget, jobs: jobsTarget(s.nations[id], e.basis), admin: e.admin.capacity, tp: e.tpGain, pp: e.ppGain, factory: e.factoryIncome }
}

describe('a neutral desk changes nothing', () => {
  it('a nation with a fresh desk has exactly the same economy as one without', () => {
    const s = game()
    const before = econNumbers(s)
    s.nations.r0.civics = newCivics()
    expect(econNumbers(s)).toEqual(before)
    // Mutation check: a standard civil service that hired anyone would be caught here.
    withValue(SERVICE.jobs, 2, -0.01, () => expect(econNumbers(s)).not.toEqual(before))
  })

  it('with the layer switched off a full desk does nothing, and no order is allowed', () => {
    const s = game()
    const before = econNumbers(s)
    s.nations.r0.civics = newCivics()
    const m = candidatesFor(s, s.nations.r0, 'finance')[0]
    applyCivics(s, s.nations.r0, { kind: 'appoint', ministry: 'finance', candidate: m.id })
    applyCivics(s, s.nations.r0, { kind: 'service', level: 4 })
    withValue(CIVICS, 'on', false, () => {
      expect(econNumbers(s)).toEqual(before)
      expect(validateOrder(s, map, civ({ kind: 'service', level: 1 }))).toMatch(/switched off/)
    })
    expect(econNumbers(s)).not.toEqual(before)
  })

  it('a human nation is given a neutral desk at its first month end, a bot is not', () => {
    const s = resolveTurn(game(), map, [])
    expect(s.nations.r0.civics).toBeDefined()
    expect(s.nations.r0.civics!.cabinet).toEqual({})
    expect(s.nations.r1.civics).toBeUndefined()
    expect(s.nations.r0.civics!.history).toHaveLength(1)
  })

  it('the unemployment causes add up to the target exactly', () => {
    const s = game()
    s.nations.r0.civics = newCivics()
    s.nations.r0.civics.service = 4
    const n = s.nations.r0
    const e = computeEconomy(s, map, 'r0')
    const sum = jobsParts(n, e.basis).reduce((a, p) => a + p.value, 0)
    expect(jobsTarget(n, e.basis)).toBeCloseTo(Math.min(0.45, Math.max(0.01, sum)), 12)
    expect(jobsParts(n, e.basis).map((p) => p.label)).toContain('Civil service, ministers and reforms')
  })
})

describe('the cabinet', () => {
  it('candidates come from the seed, the nation, the ministry and the year alone', () => {
    const s = game(9)
    const a = candidatesFor(s, s.nations.r0, 'finance')
    expect(a).toHaveLength(CABINET.candidates)
    expect(candidatesFor(structuredClone(s), s.nations.r0, 'finance')).toEqual(a)
    expect(new Set(a.map((m) => m.id)).size).toBe(a.length)
    expect(candidatesFor(s, s.nations.r0, 'labour')).not.toEqual(a)
    expect(candidatesFor(s, s.nations.r1, 'finance')).not.toEqual(a)
    // Same within the year, new the next year.
    expect(candidatesFor({ ...s, turn: s.turn + 1 }, s.nations.r0, 'finance').map((m) => m.name)).toEqual(a.map((m) => m.name))
    expect(candidatesFor({ ...s, turn: s.turn + CABINET.regenMonths }, s.nations.r0, 'finance').map((m) => m.id)).not.toEqual(a.map((m) => m.id))
    for (const m of a) for (const k of ['competence', 'loyalty', 'corruption', 'popularity'] as const) expect(m[k]).toBeGreaterThanOrEqual(0)
  })

  it('appointing costs the signing fee and puts the minister to work; a finance minister brings in money', () => {
    const s = game()
    const before = computeEconomy(s, map, 'r0').netCapital
    const m = candidatesFor(s, s.nations.r0, 'finance').sort((x, y) => x.corruption - y.corruption)[0]
    const cash = s.nations.r0.resources.capital
    expect(applyOrderNow(s, map, civ({ kind: 'appoint', ministry: 'finance', candidate: m.id })).error).toBeNull()
    expect(s.nations.r0.civics!.cabinet.finance!.id).toBe(m.id)
    expect(s.nations.r0.resources.capital).toBeLessThan(cash)
    const e = computeEconomy(s, map, 'r0')
    const gov = e.lines.find((l) => l.label === 'Government (collection, waste, reforms)')!.amount
    const salary = -e.lines.find((l) => l.label === 'Cabinet salaries')!.amount
    expect(salary).toBeGreaterThan(0)
    expect(gov).toBeGreaterThan(0)
    // What the minister collects is the effect of the ministry at their power, less what their corruption wastes.
    expect(gov / e.gross).toBeCloseTo(0.03 * ministerPower(s.nations.r0, s.nations.r0.civics!.cabinet.finance!) - (m.corruption / 100) * CABINET.wastePerCorruption, 9)
    expect(e.netCapital).toBeCloseTo(before + gov - salary, 6)
  })

  it('every minister moves what the ministry says, and only that', () => {
    const effects: Record<string, (a: ReturnType<typeof econNumbers>, b: ReturnType<typeof econNumbers>, s: GameState) => void> = {
      labour: (a, b) => expect(b.jobs).toBeLessThan(a.jobs),
      interior: (a, b) => {
        expect(b.admin).toBeGreaterThan(a.admin)
        expect(b.stability).toBeGreaterThan(a.stability)
      },
      science: (a, b) => expect(b.tp).toBeGreaterThan(a.tp),
      foreign: (a, b) => expect(b.pp).toBeGreaterThan(a.pp),
      industry: (a, b) => expect(b.factory).toBeGreaterThan(a.factory),
    }
    for (const [ministry, check] of Object.entries(effects)) {
      const s = game()
      // A factory and a university, so the industry and science ministers have something to lift.
      s.regions.r0.buildings.factory = 2
      s.regions.r0.buildings.university = 2
      s.nations.r0.civics = newCivics()
      const a = econNumbers(s)
      const m = candidatesFor(s, s.nations.r0, ministry as never)[0]
      applyCivics(s, s.nations.r0, { kind: 'appoint', ministry: ministry as never, candidate: m.id })
      check(a, econNumbers(s), s)
    }
  })

  it('replacing or dismissing costs stability, and a dismissed ministry stays empty a month', () => {
    const s = game()
    const [a, b] = candidatesFor(s, s.nations.r0, 'defence')
    applyOrderNow(s, map, civ({ kind: 'appoint', ministry: 'defence', candidate: a.id }))
    const st = s.nations.r0.stability
    expect(applyOrderNow(s, map, civ({ kind: 'appoint', ministry: 'defence', candidate: b.id })).error).toBeNull()
    expect(s.nations.r0.stability).toBeLessThan(st)
    expect(applyOrderNow(s, map, civ({ kind: 'dismiss', ministry: 'defence' })).error).toBeNull()
    expect(s.nations.r0.civics!.cabinet.defence).toBeUndefined()
    expect(validateOrder(s, map, civ({ kind: 'appoint', ministry: 'defence', candidate: a.id }))).toMatch(/reorganized/)
    const next = resolveTurn(s, map, [])
    expect(validateOrder(next, map, civ({ kind: 'appoint', ministry: 'defence', candidate: a.id }))).toBeNull()
  })

  it('a foreign minister wins goodwill abroad', () => {
    const s = game()
    const before = opinionReport(s, map, 'r1', 'r0').total
    s.nations.r0.civics = newCivics()
    const m = { ...candidatesFor(s, s.nations.r0, 'foreign')[0], competence: 99 }
    s.nations.r0.civics.cabinet.foreign = m
    const after = opinionReport(s, map, 'r1', 'r0')
    expect(after.parts.find((p) => p.label === 'Their foreign minister')?.value).toBeGreaterThan(0)
    expect(after.total).toBeGreaterThan(before)
  })

  it('corrupt ministers cause scandals, and an anti-corruption purge makes them rare', () => {
    const count = (purge: boolean) => {
      let s = game(11)
      s.nations.r0.civics = newCivics()
      if (purge) s.nations.r0.civics.policies.antiCorruption = { option: 'purge', phase: 1, since: 0 }
      for (const id of MINISTRIES) s.nations.r0.civics.cabinet[id] = { ...candidatesFor(s, s.nations.r0, id)[0], corruption: 100, popularity: 90, loyalty: 90 }
      let scandals = 0
      for (let i = 0; i < 24; i++) {
        s = resolveTurn(s, map, [])
        scandals += s.log.filter((l) => l.turn === s.turn - 1 && l.text.startsWith('Scandal')).length
      }
      return scandals
    }
    const plain = count(false)
    expect(plain).toBeGreaterThan(3)
    expect(count(true)).toBeLessThan(plain)
  })
})

describe('the civil service', () => {
  it('a vast service hires the jobless and costs money; a lean one saves money and leaves people idle', () => {
    const at = (level: number) => {
      const s = game()
      s.nations.r0.civics = newCivics()
      s.nations.r0.civics.service = level
      const e = computeEconomy(s, map, 'r0')
      return { jobs: jobsTarget(s.nations[`r0`], e.basis), cost: e.lines.find((l) => l.label === 'Civil service')?.amount ?? 0, admin: e.admin.capacity }
    }
    const std = at(2)
    const vast = at(4)
    const lean = at(0)
    expect(vast.jobs).toBeLessThan(std.jobs)
    expect(vast.cost).toBeLessThan(0)
    expect(vast.admin).toBeGreaterThan(std.admin)
    expect(lean.jobs).toBeGreaterThan(std.jobs)
    expect(lean.cost).toBeGreaterThan(0)
    expect(std.cost).toBe(0)
  })

  it('a service bigger than the administrators can staff delivers less', () => {
    const s = game()
    s.nations.r0.civics = newCivics()
    s.nations.r0.civics.service = 4
    const full = civicsEffects(s.nations.r0).admin
    s.nations.r0.people.skills.skilled *= 0.3
    expect(professionCoverage(s.nations.r0).administrators).toBeLessThan(1)
    expect(civicsEffects(s.nations.r0).admin).toBeLessThan(full)
  })
})

describe('the policy pipeline', () => {
  it('drafts, goes to the vote a month after drafting and phases in over six months', () => {
    let s = game()
    expect(applyOrderNow(s, map, civ({ kind: 'draft', area: 'labourLaw', option: 'flexible' })).error).toBeNull()
    expect(s.nations.r0.resources.pp).toBe(300 - POLICY_SPECS.labourLaw.cost)
    const months = Math.ceil(POLICY_SPECS.labourLaw.draftMonths / draftSpeed(s.nations.r0, 'labourLaw'))
    withValue(PIPELINE, 'min', 1, () => {
      for (let i = 0; i < months; i++) s = resolveTurn(s, map, [])
      expect(s.nations.r0.civics!.bills[0].stage).toBe('vote')
      s = resolveTurn(s, map, [])
    })
    expect(s.nations.r0.civics!.bills).toHaveLength(0)
    expect(currentOption(s.nations.r0, 'labourLaw')).toBe('flexible')
    const p = s.nations.r0.civics!.policies.labourLaw!
    expect(p.phase).toBeCloseTo(1 / PIPELINE.phaseMonths, 9)
    const jobsEarly = civicsEffects(s.nations.r0).jobs
    for (let i = 0; i < PIPELINE.phaseMonths; i++) s = resolveTurn(s, map, [])
    expect(s.nations.r0.civics!.policies.labourLaw!.phase).toBe(1)
    expect(civicsEffects(s.nations.r0).jobs).toBeLessThan(jobsEarly)
    expect(civicsEffects(s.nations.r0).jobs).toBeCloseTo(POLICY_SPECS.labourLaw.options.flexible.effects.jobs!, 9)
  })

  it('a vote can fail, and the area can then be drafted again', () => {
    let s = game()
    applyOrderNow(s, map, civ({ kind: 'draft', area: 'taxReform', option: 'flat' }))
    withValue(PIPELINE, 'max', 0, () => {
      for (let i = 0; i < 12 && s.nations.r0.civics!.bills.length; i++) s = resolveTurn(s, map, [])
    })
    expect(s.nations.r0.civics!.bills).toHaveLength(0)
    expect(currentOption(s.nations.r0, 'taxReform')).toBe('mixed')
    expect(s.log.some((l) => l.text.includes('voted down'))).toBe(true)
    expect(validateOrder(s, map, civ({ kind: 'draft', area: 'taxReform', option: 'flat' }))).toBeNull()
  })

  it('lobbying raises the chance to pass, a council passes more than a parliament, and limits hold', () => {
    const s = game()
    applyOrderNow(s, map, civ({ kind: 'draft', area: 'industrial', option: 'strategic' }))
    const n = s.nations.r0
    const bill = n.civics!.bills[0]
    const before = passChance(s, n, bill)
    expect(applyOrderNow(s, map, civ({ kind: 'lobby', bill: bill.id })).error).toBeNull()
    expect(passChance(s, n, bill)).toBeCloseTo(Math.min(PIPELINE.max, before + PIPELINE.lobbyChance), 9)
    for (let i = 1; i < PIPELINE.lobbyMax; i++) applyOrderNow(s, map, civ({ kind: 'lobby', bill: bill.id }))
    expect(validateOrder(s, map, civ({ kind: 'lobby', bill: bill.id }))).toMatch(/hard as it can/)
    const chance = (g: GameState['nations'][string]['government']) => passChance(s, { ...n, government: g }, { area: 'industrial', option: 'strategic', lobby: 0 })
    expect(chance('one_party')).toBeGreaterThan(chance('junta'))
    expect(chance('junta')).toBeGreaterThan(chance('monarchy'))
    expect(chance('monarchy')).toBeGreaterThan(chance('democracy'))
    expect(validateOrder(s, map, civ({ kind: 'draft', area: 'industrial', option: 'market' }))).toMatch(/already in the pipeline/)
    applyOrderNow(s, map, civ({ kind: 'draft', area: 'digitalGov', option: 'eServices' }))
    expect(validateOrder(s, map, civ({ kind: 'draft', area: 'centralBank', option: 'independent' }))).toMatch(/At most/)
    expect(applyOrderNow(s, map, civ({ kind: 'withdraw', bill: bill.id })).error).toBeNull()
    expect(n.civics!.bills).toHaveLength(1)
  })

  it('a better minister drafts faster', () => {
    const s = game()
    s.nations.r0.civics = newCivics()
    const slow = draftSpeed(s.nations.r0, 'taxReform')
    s.nations.r0.civics.cabinet.finance = { ...candidatesFor(s, s.nations.r0, 'finance')[0], competence: 90 }
    expect(draftSpeed(s.nations.r0, 'taxReform')).toBeGreaterThan(slow)
  })
})

describe('interest groups', () => {
  it('react to policies: a flat tax pleases business and angers labour', () => {
    const s = game()
    s.nations.r0.civics = newCivics()
    const before = groupReport(s, s.nations.r0).groups
    s.nations.r0.civics.policies.taxReform = { option: 'flat', phase: 1, since: 0 }
    const after = groupReport(s, s.nations.r0).groups
    const sat = (rows: typeof before, id: string) => rows.find((g) => g.id === id)!.satisfaction
    expect(sat(after, 'business')).toBeGreaterThan(sat(before, 'business'))
    expect(sat(after, 'labour')).toBeLessThan(sat(before, 'labour'))
  })

  it('their stability is bounded by the cap however many hardliners are appointed', () => {
    const s = game()
    s.nations.r0.civics = newCivics()
    for (const id of MINISTRIES) s.nations.r0.civics.cabinet[id] = { ...candidatesFor(s, s.nations.r0, id)[0], ideology: 'hardliner' }
    const g = civicsEffects(s.nations.r0).parts.find((p) => p.label === 'Interest groups')!.value
    expect(Math.abs(g)).toBeLessThanOrEqual(25 * 2 * 0.06 * 5 + 1e-9)
    const { approval } = groupReport(s, s.nations.r0)
    expect(approval).toBeGreaterThanOrEqual(0)
    expect(approval).toBeLessThanOrEqual(100)
  })
})

describe('talent and jobs', () => {
  it('the pool grows with schooling and shrinks with brain drain; talent visas add to it', () => {
    const s = game()
    const n = s.nations.r0
    n.civics = newCivics()
    const base = talentSupply(n).administrators
    n.people.schooling += 0.2
    expect(talentSupply(n).administrators).toBeGreaterThan(base)
    n.people.schooling -= 0.2
    n.civics.drain = 0.1
    expect(talentSupply(n).engineers).toBeCloseTo(n.people.skills.engineers * 0.9, 12)
    n.civics.drain = 0
    n.civics.policies.talentVisas = { option: 'talentHunt', phase: 1, since: 0 }
    expect(talentSupply(n).engineers).toBeCloseTo(n.people.skills.engineers * 1.2, 12)
  })

  it('the report says who uses each profession, and its people-model rows match the economy', () => {
    const s = game()
    const n = s.nations.r0
    n.civics = newCivics()
    n.missileProgram = 2
    const e = computeEconomy(s, map, 'r0')
    const rows = talentReport(n, e)
    expect(rows.map((r) => r.profession)).toEqual(PROFESSIONS)
    const eng = rows.find((r) => r.profession === 'engineers')!
    expect(eng.users.map((u) => u.label)).toContain('Missile program')
    const lf = e.population * TALENT.participation * 1000
    // The engineers wanted are exactly what the economy's people model asks for, and the coverage is the economy's.
    expect(eng.demand).toBeCloseTo(e.demand.engineers * lf, 6)
    expect(eng.coverage).toBe(e.coverage.engineers)
    for (const r of rows) {
      expect(Number.isFinite(r.pool) && Number.isFinite(r.demand) && Number.isFinite(r.coverage)).toBe(true)
      expect(r.users.reduce((a, u) => a + u.amount, 0)).toBeCloseTo(r.demand, 6)
    }
  })

  it('the missile program draws engineers from the factories only with the desk', () => {
    const s = game()
    s.nations.r0.missileProgram = 3
    const without = computeEconomy(s, map, 'r0').demand.engineers
    s.nations.r0.civics = newCivics()
    expect(computeEconomy(s, map, 'r0').demand.engineers).toBeCloseTo(without + 3 * TALENT.missileEngineers, 12)
  })

  it('the jobs picture adds up: sectors to the employed, employed and idle to the labour force', () => {
    const s = game()
    for (const level of [0, 2, 4]) {
      s.nations.r0.civics = { ...newCivics(), service: level }
      const e = computeEconomy(s, map, 'r0')
      const job = employmentOf(s.nations.r0, e)
      expect(job.force).toBeCloseTo(e.population * TALENT.participation, 9)
      expect(job.employed + job.unemployed).toBeCloseTo(job.force, 9)
      expect(SECTORS_ORDER.reduce((a, k) => a + job.sectors[k], 0)).toBeCloseTo(job.employed, 9)
      for (const k of SECTORS_ORDER) expect(job.sectors[k]).toBeGreaterThanOrEqual(0)
      expect(job.sectors.public).toBeCloseTo(Math.min(job.employed * 0.4, job.force * SERVICE.share[level]), 9)
    }
  })
})

describe('orders are safe', () => {
  it('nonsense is refused, never thrown', () => {
    const s = game()
    const bad: unknown[] = [
      null,
      {},
      { kind: 'appoint', ministry: 'magic', candidate: 'x' },
      { kind: 'appoint', ministry: 'finance', candidate: 'finance-99-9' },
      { kind: 'appoint', ministry: '__proto__', candidate: 'x' },
      { kind: 'dismiss', ministry: 'finance' },
      { kind: 'service', level: 9 },
      { kind: 'service', level: 1.5 },
      { kind: 'draft', area: 'taxReform', option: '__proto__' },
      { kind: 'draft', area: 'taxReform', option: 'toString' },
      { kind: 'draft', area: 'constructor', option: 'flat' },
      { kind: 'draft', area: 'taxReform', option: 'mixed' },
      { kind: 'lobby', bill: 42 },
      { kind: 'withdraw', bill: -1 },
      { kind: 'explode' },
    ]
    for (const a of bad) {
      expect(() => validateOrder(s, map, { type: 'civics', nationId: 'r0', action: a } as Order)).not.toThrow()
      expect(validateOrder(s, map, { type: 'civics', nationId: 'r0', action: a } as Order)).not.toBeNull()
    }
    // A plan with nonsense goes through the month without breaking it.
    const next = resolveTurn(s, map, bad.map((a) => ({ type: 'civics', nationId: 'r0', action: a }) as Order))
    expect(next.turn).toBe(s.turn + 1)
  })

  it('cleanCivics repairs damage and keeps a good desk exactly as it was', () => {
    let s = game()
    applyOrderNow(s, map, civ({ kind: 'appoint', ministry: 'finance', candidate: candidatesFor(s, s.nations.r0, 'finance')[0].id }))
    applyOrderNow(s, map, civ({ kind: 'draft', area: 'digitalGov', option: 'eServices' }))
    s = resolveTurn(s, map, [])
    const good = s.nations.r0.civics!
    expect(JSON.stringify(cleanCivics(JSON.parse(JSON.stringify(good))))).toBe(JSON.stringify(good))
    const junk = cleanCivics({ service: 99, cabinet: { finance: { id: 3 }, labour: { id: 'x', ideology: 'anarchist' } }, policies: { taxReform: { option: 'nope' }, digitalGov: { option: 'eServices', phase: 7 } }, bills: [{ area: 'nope' }, null], drain: -4, history: [{ turn: 'a' }] })!
    expect(junk.service).toBe(SERVICE.levels.length - 1)
    expect(junk.cabinet).toEqual({})
    expect(junk.policies).toEqual({ digitalGov: { option: 'eServices', phase: 1, since: 0 } })
    expect(junk.bills).toEqual([])
    expect(junk.drain).toBe(0)
    expect(junk.history).toEqual([])
    expect(cleanCivics('rubbish')).toBeUndefined()
  })

  it('an old save without a desk loads and plays; a damaged desk is repaired on load', () => {
    const s = game()
    const old = JSON.parse(JSON.stringify(s)) as GameState
    delete old.nations.r0.civics
    const loaded = normalizeGame(old, map)
    expect(loaded.nations.r0.civics).toBeUndefined()
    expect(resolveTurn(loaded, map, []).nations.r0.civics).toBeDefined()
    const damaged = JSON.parse(JSON.stringify(s)) as GameState
    const raw = damaged.nations as unknown as Record<string, { civics: unknown }>
    raw.r0.civics = { service: 'big' }
    expect(normalizeGame(damaged, map).nations.r0.civics!.service).toBe(SERVICE.standard)
    raw.r1.civics = 7
    expect(normalizeGame(damaged, map).nations.r1.civics).toBeUndefined()
  })
})

describe('turn and live months are the same month, with the desk', () => {
  it('six months with the same desk orders give the same game in both modes', () => {
    const base = game(6)
    const fin = candidatesFor(base, base.nations.r0, 'finance')[1].id
    const now: Order[] = [civ({ kind: 'appoint', ministry: 'finance', candidate: fin }), civ({ kind: 'service', level: 3 }), civ({ kind: 'draft', area: 'labourLaw', option: 'protective' })]
    const prepare = (s: GameState) => {
      for (const o of now) expect(applyOrderNow(s, map, o).error).toBeNull()
      return s
    }
    let turn = prepare(structuredClone(base))
    for (let i = 0; i < 6; i++) turn = resolveTurn(turn, map, [])
    let live = prepare(startLive(structuredClone(base)))
    const target = live.turn + 6
    while (live.turn < target) live = advanceDay(live, map, { planner: () => [] }).state
    const strip = (s: GameState) => {
      const copy = JSON.parse(JSON.stringify(s))
      for (const k of ['day', 'armies', 'launches', 'flights', 'pendingDay', 'log']) delete copy[k]
      delete copy.settings.mode
      return copy
    }
    expect(live.turn).toBe(turn.turn)
    expect(strip(live).nations.r0.civics).toEqual(strip(turn).nations.r0.civics)
    expect(strip(live).nations).toEqual(strip(turn).nations)
    void daysInMonth
  })
})

describe('fuzz: random desk orders never break a game', () => {
  it('two hundred random orders over two years: no throw, every number finite, the desk always clean', () => {
    let s = game(13)
    let seed = 12345
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296)
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
    for (let month = 0; month < 24; month++) {
      for (let k = 0; k < 9; k++) {
        const n = s.nations.r0
        const ministry = pick(MINISTRIES)
        const area = pick(POLICY_AREAS)
        const actions: CivicsAction[] = [
          { kind: 'appoint', ministry, candidate: pick(candidatesFor(s, n, ministry)).id },
          { kind: 'dismiss', ministry },
          { kind: 'service', level: Math.floor(rnd() * 6) - 1 },
          { kind: 'draft', area, option: pick(Object.keys(POLICY_SPECS[area].options)) },
          { kind: 'lobby', bill: n.civics?.bills[0]?.id ?? 1 },
          { kind: 'withdraw', bill: Math.floor(rnd() * 5) },
        ]
        const a = pick(actions)
        const problem = civicsProblem(s, n, a)
        const res = applyOrderNow(s, map, civ(a))
        expect(res.error === null).toBe(validateOrder(s, map, civ(a)) === null || problem === null)
      }
      s = resolveTurn(s, map, [])
      const n = s.nations.r0
      const e = computeEconomy(s, map, 'r0')
      for (const v of [e.netCapital, e.stabilityTarget, n.stability, n.people.unemployment, n.resources.capital, n.resources.pp]) expect(Number.isFinite(v)).toBe(true)
      expect(n.stability).toBeGreaterThanOrEqual(0)
      expect(n.stability).toBeLessThanOrEqual(100)
      expect(cleanCivics(JSON.parse(JSON.stringify(n.civics)))).toEqual(n.civics)
      expect(n.civics!.bills.length).toBeLessThanOrEqual(PIPELINE.maxBills)
      expect(groupReport(s, n).approval).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('bots use the desk by difficulty', () => {
  const plan = (skill: 0 | 1 | 2, turn: number) => {
    const s = game(3)
    s.turn = turn
    s.nations.r1.resources.capital = 900
    s.nations.r1.resources.pp = 200
    const orders: Order[] = []
    const tryAdd = (o: Order) => (validateOrder(s, map, o, orders) === null ? (orders.push(o), true) : false)
    manageCivics(s, 'r1', computeEconomy(s, map, 'r1'), skill, tryAdd)
    return orders
  }
  it('Easy never touches it; Medium and Hard appoint a minister when they look, and the same game plans the same', () => {
    const turns = Array.from({ length: 12 }, (_, i) => i + 1)
    expect(turns.flatMap((t) => plan(0, t))).toEqual([])
    const medium = turns.flatMap((t) => plan(1, t))
    const hard = turns.flatMap((t) => plan(2, t))
    expect(medium.some((o) => o.type === 'civics' && o.action.kind === 'appoint')).toBe(true)
    expect(hard.filter((o) => o.type === 'civics' && o.action.kind === 'appoint').length).toBeGreaterThanOrEqual(medium.filter((o) => o.type === 'civics' && o.action.kind === 'appoint').length)
    expect(turns.flatMap((t) => plan(2, t))).toEqual(hard)
    withValue(CIVICS, 'on', false, () => expect(turns.flatMap((t) => plan(2, t))).toEqual([]))
  })
})
