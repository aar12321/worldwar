import { CHIEF, CHIEF_TRAITS, DEVS, DEV_IDS, FACILITIES, FACILITY_IDS, MPROG, PROGRAM_CAPS, PROGRAM_RULES, STAFF, STAFF_FX, STAFF_ROLES, type DevBranch, type MissileProgramState, type ProgramEffectKey, type ProgramEffects, type StaffRole } from '../data/missileProgram'
import type { MissileType, Nation } from './types'

/**
 * What a nation's missile program adds up to: its facilities, finished developments, staff, chief designer and experience. Pure and
 * dependency-free so the strike rules (missiles.ts, missileWar.ts) can read it without a cycle. A nation with no program, or any nation
 * while the program is switched off (MPROG.on), gets `undefined`, and every caller then takes its old path exactly.
 */

const KEYS = Object.keys(PROGRAM_CAPS) as ProgramEffectKey[]
const zero = (): ProgramEffects => Object.fromEntries(KEYS.map((k) => [k, 0])) as unknown as ProgramEffects

type P = Pick<Nation, 'mprog'>

export const programOf = (n: P | undefined): MissileProgramState | undefined => (MPROG.on ? n?.mprog : undefined)

export const facilityLevel = (n: P, id: keyof MissileProgramState['fac']): number => n.mprog?.fac[id] ?? 0
export const staffCount = (n: P, role: StaffRole): number => n.mprog?.staff[role] ?? 0
/** Every head on the program's staff (the chief designer not included). */
export const programStaff = (n: P | undefined): number => (n?.mprog ? STAFF_ROLES.reduce((sum, r) => sum + (n.mprog!.staff[r] ?? 0), 0) : 0)
/** Heads of a role that still add something. */
export const usefulStaff = (n: P, role: StaffRole): number => Math.min(STAFF[role].useful, staffCount(n, role))

/** How strongly the chief designer's trait works: 0.8 at skill 1 to 1.2 at skill 5. */
export const chiefScale = (skill: number): number => 0.7 + 0.1 * Math.max(1, Math.min(CHIEF.maxSkill, skill))

/** The program's effects, held to their caps. Undefined without a program. */
export function programFx(n: P | undefined): ProgramEffects | undefined {
  const p = programOf(n)
  if (!p) return undefined
  const fx = zero()
  const add = (e: Partial<ProgramEffects>, times = 1) => {
    for (const k of KEYS) if (e[k]) fx[k] += e[k]! * times
  }
  for (const id of FACILITY_IDS) if (p.fac[id]) add(FACILITIES[id].effects, p.fac[id])
  for (const id of DEV_IDS) if (p.devs[id]?.state === 'done') add(DEVS[id].effects)
  fx.harm += STAFF_FX.guidanceHarm * usefulStaff(n!, 'guidance')
  fx.capacity += STAFF_FX.productionCapacity * usefulStaff(n!, 'production')
  fx.cost += STAFF_FX.productionCost * usefulStaff(n!, 'production')
  fx.speed += STAFF_FX.engineerSpeed * usefulStaff(n!, 'engineer') + PROGRAM_RULES.expSpeed * (p.exp / 100)
  fx.reliability += STAFF_FX.crewReliability * usefulStaff(n!, 'crew') + PROGRAM_RULES.expReliability * (p.exp / 100)
  if (p.chief) add(CHIEF_TRAITS[p.chief.trait].effects, chiefScale(p.chief.skill))
  for (const k of KEYS) fx[k] = Math.max(k === 'reliability' || k === 'speed' ? -0.5 : 0, Math.min(PROGRAM_CAPS[k], fx[k]))
  return fx
}

/** Extra development speed on one branch: its specialists and a chief designer of that bent. */
export function branchSpeed(n: P, branch: DevBranch): number {
  const p = programOf(n)
  if (!p) return 0
  let v = 0
  if (branch === 'propulsion') v += STAFF_FX.branchSpeed * usefulStaff(n, 'propulsion')
  if (branch === 'guidance' || branch === 'payload') v += STAFF_FX.branchSpeed * usefulStaff(n, 'guidance')
  const b = p.chief ? CHIEF_TRAITS[p.chief.trait].branch : undefined
  if (b && b.branch === branch) v += b.speed * chiefScale(p.chief!.skill)
  return v
}

/** Whether a kind is one the program makes (and so gains its range). */
const programKind = (kind: MissileType) => kind !== 'hypersonic'

/** The range of a kind for a nation, in km: the table's, plus what its program adds. */
export function rangeKm(n: P | undefined, kind: MissileType, km: number): number {
  const fx = programFx(n)
  return fx && fx.range > 0 && programKind(kind) ? Math.round(km * (1 + fx.range)) : km
}

/** What the attacker's program and the defender's do to a salvo's interception: undefined when neither side has a program. */
export function salvoBoost(attacker: P | undefined, defender: P | undefined): { evade: number; intercept: number } | undefined {
  const a = programFx(attacker)
  const d = programFx(defender)
  if (!a && !d) return undefined
  const evade = a?.evade ?? 0
  const intercept = d?.intercept ?? 0
  return evade > 0 || intercept > 0 ? { evade, intercept } : undefined
}

/** Harm per missile that lands (accuracy and payload) and the share of a store saved from counterforce. Undefined when neither applies. */
export function harmBoost(attacker: P | undefined, defender: P | undefined): { harm: number; harden: number } | undefined {
  const harm = programFx(attacker)?.harm ?? 0
  const harden = programFx(defender)?.harden ?? 0
  return harm > 0 || harden > 0 ? { harm, harden } : undefined
}

/** The share of the interception still working after the program's effects, applied to a salvo's `through` share. */
export function boostThrough(through: number, b: { evade: number; intercept: number } | undefined): number {
  if (!b) return through
  const passed = 1 - (1 - through) * (1 - b.evade)
  return Math.max(0.05, Math.min(1, passed * (1 - b.intercept)))
}

/** Interceptor rounds added by the program, as a multiplier on the store. 1 without one. */
export const roundsMult = (n: P | undefined): number => 1 + (programFx(n)?.rounds ?? 0)
/** Radar and mobile-launcher levels added by the program. */
export const programRadar = (n: P | undefined): number => programFx(n)?.radar ?? 0
export const programMobile = (n: P | undefined): number => programFx(n)?.mobile ?? 0
/** Missiles a month and stores the program adds, and the share off each missile's price. */
export const programCapacity = (n: P | undefined): number => programFx(n)?.capacity ?? 0
export const programStorage = (n: P | undefined): number => programFx(n)?.storage ?? 0
export const programCostCut = (n: P | undefined): number => programFx(n)?.cost ?? 0
