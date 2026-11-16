import { describe, expect, it } from 'vitest'
import { TIERS } from '../../data/empire'
import { CAMPAIGNS, SOCIAL, SOCIAL_RULES } from '../../data/society'
import { BUILDING_SPECS, DIPLOMACY, MARKET } from '../../data/unitTypes'
import { TECHS } from '../../data/techTree'
import { ECON, computeEconomy } from '../economy'
import { societyEffects } from '../society'
import { lineMap, startState } from './fixtures'

/** Value audit (docs/VALUE_AUDIT.md): every number the game shows or tunes does something. */

const RAW = import.meta.glob(['../../**/*.ts', '../../**/*.tsx', '!../../**/__tests__/**', '!../../**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const FILES = Object.entries(RAW).map(([path, text]) => ({ path, text }))

describe('no inert tunables', () => {
  // Words the game says through a variable, or tables keyed by id that are read as a whole.
  const ALLOWED = new Set(['LIBERATE_TEXT.term', 'LIBERATE_TEXT.short', 'LIBERATE_TEXT.hint', 'LIBERATE_TEXT.none', 'COMPANIES.meridian', 'COMPANIES.apex', 'COMPANIES.titan', 'COMPANIES.helios'])

  it('every key of every rules constant in src/data is read somewhere', () => {
    const all = FILES.map((f) => f.text).join('\n')
    const dead: string[] = []
    for (const { text } of FILES.filter((f) => f.path.includes('/data/'))) {
      const consts = /^export const ([A-Z][A-Z0-9_]*)(?::[^=]+)? = \{\n([\s\S]*?)^\}/gm
      let m: RegExpExecArray | null
      while ((m = consts.exec(text))) {
        const [, name, body] = m
        for (const k of [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((x) => x[1])) {
          if (ALLOWED.has(`${name}.${k}`)) continue
          const read = new RegExp(`\\b${name}\\??\\.${k}\\b|\\b${name}\\[`).test(all) || new RegExp(`\\{[^}]*\\b${k}\\b[^}]*\\}\\s*=\\s*${name}\\b`).test(all)
          if (!read) dead.push(`${name}.${k}`)
        }
      }
    }
    expect(dead).toEqual([])
  })

  it('the table fields that once sat unused are gone', () => {
    expect('maxMonths' in DIPLOMACY.loan).toBe(false)
    expect('short' in MARKET.oil).toBe(false)
  })
})

describe('shares of a trouble never pass the cap', () => {
  it('hunger, plague and rebellion relief from every program, campaign and project together stay under the cap', () => {
    const n = startState(lineMap(2)).nations.r0
    n.social = {}
    for (const id of Object.keys(SOCIAL)) (n.social as Record<string, unknown>)[id] = { level: 3, strength: 3 }
    n.campaigns = {}
    for (const id of Object.keys(CAMPAIGNS)) (n.campaigns as Record<string, unknown>)[id] = { left: 3, until: 99 }
    n.projects = { grainReserve: { level: 3, done: true }, waterNetwork: { level: 3, done: true } } as never
    const fx = societyEffects(n)
    // Without the cap these add up to well over 100%, which would turn hunger into a gain of stability.
    for (const k of ['famine', 'epidemic'] as const) expect(fx.social[k]).toBeCloseTo(SOCIAL_RULES.shareCap, 9)
    expect(fx.social.order).toBeLessThanOrEqual(SOCIAL_RULES.shareCap)
    expect(fx.social.order).toBeGreaterThan(0.5)
  })
})

describe('what the screens say matches the engine', () => {
  it('building effect lines quote the real rates', () => {
    expect(BUILDING_SPECS.factory.effect).toContain(`+${ECON.factoryOutput} money`)
    expect(BUILDING_SPECS.farm.effect).toContain(`+${ECON.foodPerFarm} food`)
    expect(BUILDING_SPECS.university.effect).toContain(`+${ECON.tpPerUniversity} research`)
    expect(BUILDING_SPECS.port.effect).toContain(`+${ECON.portTrade} money`)
  })

  it('a station-keeping nation computes an economy with finite numbers', () => {
    const map = lineMap(2)
    const s = startState(map)
    const e = computeEconomy(s, map, 'r0')
    for (const v of [e.netCapital, e.netFood, e.taxIncome, e.factoryIncome, e.tradeIncome]) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('tables grow the way their names say', () => {
  it('empire tiers never lose a right as they grow, except trust, where lower is better', () => {
    for (const k of Object.keys(TIERS[0]) as (keyof (typeof TIERS)[0])[]) {
      if (k === 'credibility' || k === 'council' || typeof TIERS[0][k] !== 'number') continue
      for (let i = 1; i < TIERS.length; i++) expect(TIERS[i][k] as number, `${String(k)} at tier ${i + 1}`).toBeGreaterThanOrEqual(TIERS[i - 1][k] as number)
    }
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i].credibility).toBeLessThan(TIERS[i - 1].credibility)
  })

  it('technology costs never fall with the tier, and a technology never needs a later one', () => {
    for (const t of TECHS) {
      for (const r of t.requires) {
        const need = TECHS.find((x) => x.id === r)!
        expect(need.tier, `${t.id} needs ${r}`).toBeLessThanOrEqual(t.tier)
        expect(need.cost).toBeLessThanOrEqual(t.cost)
      }
    }
  })

  it('social program levels cost more influence each step', () => {
    for (const [id, p] of Object.entries(SOCIAL)) expect(p.enact[0] <= p.enact[1] && p.enact[1] <= p.enact[2], id).toBe(true)
  })
})
