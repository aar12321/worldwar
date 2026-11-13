import { militaryPower } from './militaryStats'
import type { GameState, NationId } from './types'

export interface Bloc {
  /** The strongest member, who gives the bloc its name. */
  leader: NationId
  name: string
  members: NationId[]
  power: number
}

/** Groups of nations tied together by alliances, two or more strong. Computed from the alliance list, so it is never out of date. */
export function blocsOf(s: GameState): Bloc[] {
  const links = new Map<NationId, Set<NationId>>()
  const add = (a: NationId, b: NationId) => {
    if (!s.nations[a]?.alive || !s.nations[b]?.alive) return
    if (!links.has(a)) links.set(a, new Set())
    links.get(a)!.add(b)
  }
  for (const key of s.alliances) {
    const i = key.indexOf('|')
    const a = key.slice(0, i)
    const b = key.slice(i + 1)
    add(a, b)
    add(b, a)
  }
  const seen = new Set<NationId>()
  const out: Bloc[] = []
  for (const start of [...links.keys()].sort()) {
    if (seen.has(start)) continue
    const members: NationId[] = []
    const stack = [start]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      members.push(id)
      for (const next of links.get(id) ?? []) if (!seen.has(next)) stack.push(next)
    }
    if (members.length < 2) continue
    members.sort()
    const power = members.reduce((sum, id) => sum + militaryPower(s, id), 0)
    const leader = [...members].sort((a, b) => militaryPower(s, b) - militaryPower(s, a) || (a < b ? -1 : 1))[0]
    out.push({ leader, name: `${s.nations[leader].name} bloc`, members, power })
  }
  return out.sort((a, b) => b.power - a.power || (a.leader < b.leader ? -1 : 1))
}

/** The bloc a nation belongs to, if any. */
export function blocOf(s: GameState, id: NationId): Bloc | null {
  return blocsOf(s).find((b) => b.members.includes(id)) ?? null
}
