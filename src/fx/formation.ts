import type { UnitCounts, UnitType } from '../engine/types'

/**
 * A force as a formation of squads: how many squads and of what kind, laid out in rows. Pure (no drawing), so the globe, the battle scene
 * and the War Room preview all show the same army the same way, and a bigger army always shows at least as many squads.
 */
export type SquadKind = 'infantry' | 'armor' | 'artillery' | 'air' | 'naval' | 'drone' | 'robot' | 'missile'

export interface Squad {
  kind: SquadKind
  /** Position in squad spacings: x across the line of march (left negative), y along it (front negative, rear positive). */
  x: number
  y: number
}

const KIND_OF: Record<UnitType, SquadKind> = { infantry: 'infantry', armor: 'armor', artillery: 'artillery', fighter: 'air', air: 'air', naval: 'naval', drone: 'drone', robot: 'robot', missile: 'missile' }
/** Front to back. */
const ROW_ORDER: SquadKind[] = ['armor', 'robot', 'infantry', 'drone', 'artillery', 'missile', 'air', 'naval']

export const MAX_SQUADS = 12

/** Total divisions in a force. */
export const totalOf = (u: Partial<UnitCounts>) => Object.values(u).reduce<number>((a, b) => a + (typeof b === 'number' && b > 0 ? b : 0), 0)

/** Squads for a force: 1 for a sliver, growing with the square root of its size (so a huge army fills the screen slowly). */
export function squadCount(total: number, max = MAX_SQUADS): number {
  if (total < 0.05) return 0
  return Math.max(1, Math.min(max, Math.round(Math.sqrt(total) * 1.9)))
}

/** The force's mix as squads of each kind (largest remainder), then laid out front to back in rows of up to four. */
export function formationOf(units: Partial<UnitCounts>, max = MAX_SQUADS): Squad[] {
  const total = totalOf(units)
  const n = squadCount(total, max)
  if (n === 0) return []
  const share = new Map<SquadKind, number>()
  for (const [k, v] of Object.entries(units)) {
    if (typeof v !== 'number' || v <= 0) continue
    const kind = KIND_OF[k as UnitType]
    if (kind) share.set(kind, (share.get(kind) ?? 0) + v)
  }
  const kinds = ROW_ORDER.filter((k) => share.has(k))
  const counts = new Map<SquadKind, number>()
  let used = 0
  const rem: { k: SquadKind; r: number }[] = []
  for (const k of kinds) {
    const exact = ((share.get(k) ?? 0) / total) * n
    const base = Math.floor(exact)
    counts.set(k, base)
    used += base
    rem.push({ k, r: exact - base })
  }
  rem.sort((a, b) => b.r - a.r)
  for (let i = 0; used < n; i++, used++) counts.set(rem[i % rem.length].k, (counts.get(rem[i % rem.length].k) ?? 0) + 1)
  // A kind present in the force always shows at least once while there is room, so a few tanks among many infantry still read.
  for (const k of kinds) if ((counts.get(k) ?? 0) === 0 && n >= kinds.length) {
    const biggest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (biggest && biggest[1] > 1) {
      counts.set(biggest[0], biggest[1] - 1)
      counts.set(k, 1)
    }
  }
  const order: SquadKind[] = []
  for (const k of kinds) for (let i = 0; i < (counts.get(k) ?? 0); i++) order.push(k)
  const perRow = n <= 2 ? n : n <= 6 ? 3 : 4
  const rows = Math.ceil(order.length / perRow)
  const out: Squad[] = []
  order.forEach((kind, i) => {
    const row = Math.floor(i / perRow)
    const inRow = Math.min(perRow, order.length - row * perRow)
    const col = i % perRow
    out.push({ kind, x: col - (inRow - 1) / 2, y: row - (rows - 1) / 2 })
  })
  // Front rows lead the march: the first row is the most negative y.
  return out
}

/** Which unit icon to show for a squad (the icon ids in the art pack). */
export const SQUAD_ICON: Record<SquadKind, string> = {
  infantry: 'icon.mono.infantry',
  armor: 'icon.mono.armor',
  artillery: 'icon.mono.artillery',
  air: 'icon.mono.fighter',
  naval: 'icon.mono.patrol',
  drone: 'icon.mono.drone',
  robot: 'icon.mono.robot',
  missile: 'icon.mono.launcher',
}

/** The kinds in a force, biggest first, at most `n`: for the small row of icons over an army. */
export function mixIcons(units: Partial<UnitCounts>, n = 3): SquadKind[] {
  const share = new Map<SquadKind, number>()
  for (const [k, v] of Object.entries(units)) {
    if (typeof v !== 'number' || v <= 0) continue
    const kind = KIND_OF[k as UnitType]
    if (kind) share.set(kind, (share.get(kind) ?? 0) + v)
  }
  return [...share.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
}
