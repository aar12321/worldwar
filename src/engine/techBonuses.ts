import { TECH_BY_ID } from '../data/techTree'
import type { Nation, UnitType } from './types'
import { UNIT_TYPES } from './types'
import { UNIT_SPECS } from '../data/unitTypes'

export interface BonusLine {
  label: string
  /** Already formatted, such as "+25%". */
  value: string
  /** The technologies that give it. */
  from: string[]
}

export interface BonusGroup {
  title: string
  lines: BonusLine[]
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`

/** Everything the technologies a nation owns give it, in plain words and grouped, with where each bonus comes from. */
export function techBonuses(n: Pick<Nation, 'techs'>): BonusGroup[] {
  type Sum = { total: number; from: string[] }
  const sums = new Map<string, Sum>()
  const add = (key: string, value: number | undefined, from: string) => {
    if (!value) return
    const cur = sums.get(key) ?? { total: 0, from: [] }
    cur.total += value
    if (!cur.from.includes(from)) cur.from.push(from)
    sums.set(key, cur)
  }
  const unlocked: string[] = []
  const abilities: BonusLine[] = []
  let ignoreMountains: string | null = null
  for (const id of n.techs) {
    const t = TECH_BY_ID[id]
    if (!t) continue
    const m = t.modifiers
    for (const u of UNIT_TYPES) {
      add(`atk:${u}`, m.unitAttack?.[u], t.name)
      add(`def:${u}`, m.unitDefense?.[u], t.name)
    }
    add('combined', m.combinedArms, t.name)
    add('amphibious', m.amphibiousPenaltyReduction, t.name)
    if (m.ignoreMountainPenalty) ignoreMountains = t.name
    add('research', (m.researchOutput ?? 0) + (m.policy?.research ?? 0), t.name)
    add('factory', (m.factoryOutput ?? 0) + (m.policy?.factory ?? 0), t.name)
    add('food', m.foodOutput, t.name)
    add('output', (m.allOutput ?? 0) + (m.policy?.output ?? 0), t.name)
    add('growth', m.policy?.growth, t.name)
    add('trade', m.policy?.trade, t.name)
    add('money', m.policy?.money, t.name)
    add('jobs', m.jobsReduction, t.name)
    add('stability', (m.stability ?? 0) + (m.policy?.stability ?? 0), t.name)
    add('influence', (m.ppPerTurn ?? 0) + (m.policy?.influence ?? 0), t.name)
    add('agency', m.agencyBonus, t.name)
    if (t.unlocksUnit) unlocked.push(UNIT_SPECS[t.unlocksUnit].name)
    for (const text of t.unlocks ?? []) abilities.push({ label: text, value: 'unlocked', from: [t.name] })
  }
  const line = (key: string, label: string, fmt: (v: number) => string = pct): BonusLine | null => {
    const s = sums.get(key)
    return s && Math.abs(s.total) > 1e-9 ? { label, value: fmt(s.total), from: s.from } : null
  }
  const keep = (list: (BonusLine | null)[]) => list.filter((x): x is BonusLine => !!x)

  const combat: BonusLine[] = []
  for (const u of UNIT_TYPES as readonly UnitType[]) {
    const a = sums.get(`atk:${u}`)
    const d = sums.get(`def:${u}`)
    if (!a && !d) continue
    const parts = [a ? `attack ${pct(a.total)}` : '', d ? `defense ${pct(d.total)}` : ''].filter(Boolean)
    combat.push({ label: UNIT_SPECS[u].name, value: parts.join(', '), from: [...new Set([...(a?.from ?? []), ...(d?.from ?? [])])] })
  }
  combat.push(...keep([line('combined', 'Combined arms'), line('amphibious', 'Sea and air landings lose less strength', (v) => `-${Math.round(v * 100)}% penalty`)]))
  if (ignoreMountains) combat.push({ label: 'Mountains no longer slow your infantry', value: 'yes', from: [ignoreMountains] })

  const economy = keep([
    line('research', 'Research'),
    line('factory', 'Factory output'),
    line('food', 'Food'),
    line('output', 'All economic output'),
    line('growth', 'Business growth'),
    line('trade', 'Room to trade'),
    line('money', 'Income'),
    line('jobs', 'Jobs needed', (v) => `-${Math.round(v * 100)}%`),
    line('stability', 'Stability', (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}`),
    line('influence', 'Influence a month', (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`),
  ])
  const spies = keep([line('agency', 'Odds of every agency operation')])

  const groups: BonusGroup[] = [
    { title: 'Units unlocked', lines: unlocked.length ? [{ label: [...new Set(unlocked)].join(', '), value: '', from: [] }] : [] },
    { title: 'In battle', lines: combat },
    { title: 'Your economy', lines: economy },
    { title: 'Your agencies', lines: spies },
    { title: 'New abilities', lines: abilities },
  ]
  return groups.filter((g) => g.lines.length > 0)
}
