import { GROUP_SPECS, GROUPS, type CivicEffect, type GroupId } from '../../../data/civics'

const pctOf = (v: number, digits = 0) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`
const pts = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)} pts`

/** Plain words for what an effect does, at a given power (1 is full). Small numbers are left out. */
export function effectWords(e: CivicEffect, power = 1): string[] {
  const out: string[] = []
  const v = (k: keyof CivicEffect) => (e[k] ?? 0) * power
  const say = (k: keyof CivicEffect, text: (x: number) => string, min = 1e-4) => {
    const x = v(k)
    if (Math.abs(x) >= min) out.push(text(x))
  }
  say('stability', (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)} stability`, 0.05)
  say('treasury', (x) => `${pctOf(x, 1)} of income`)
  say('jobs', (x) => `${pts(x)} unemployment`)
  say('output', (x) => `${pctOf(x, 1)} output`)
  say('factory', (x) => `${pctOf(x)} factory output`)
  say('research', (x) => `${pctOf(x)} research`)
  say('growth', (x) => `${pctOf(x)} business growth`)
  say('trade', (x) => `${pctOf(x)} trade capacity`)
  say('upkeep', (x) => `${pctOf(x)} upkeep`)
  say('influence', (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)} influence a month`, 0.01)
  say('health', (x) => `${pts(x)} health`)
  say('schooling', (x) => `${pts(x)} schooling`)
  say('admin', (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)} countries the officials can run`, 0.05)
  say('talent', (x) => `${pctOf(x)} talent`)
  say('taxSensitivity', (x) => `${pctOf(x)} anger at high taxes`)
  say('weariness', (x) => `${pctOf(x)} war weariness`)
  return out
}

/** "Business +8, Labour -6" for a set of group reactions. */
export function groupWords(g: Partial<Record<GroupId, number>>, power = 1): { id: GroupId; text: string; value: number }[] {
  return GROUPS.filter((k) => Math.abs((g[k] ?? 0) * power) >= 0.5).map((k) => {
    const value = (g[k] ?? 0) * power
    return { id: k, value, text: `${GROUP_SPECS[k].name} ${value >= 0 ? '+' : ''}${Math.round(value)}` }
  })
}

/** Thousands of people, readable: 3.2k, 48k, 1.2M. */
export function people(thousands: number): string {
  if (thousands >= 1000) return `${(thousands / 1000).toFixed(thousands >= 10000 ? 0 : 1)}M`
  if (thousands >= 10) return `${Math.round(thousands)}k`
  if (thousands >= 1) return `${thousands.toFixed(1)}k`
  return `${Math.round(thousands * 1000)}`
}

/** Millions of people, readable. */
export const millions = (m: number) => (m >= 100 ? `${Math.round(m)}M` : m >= 10 ? `${m.toFixed(1)}M` : m >= 1 ? `${m.toFixed(2)}M` : `${Math.round(m * 1000)}k`)

export const toneOf = (coverage: number) => (coverage >= 1 ? 'good' : coverage >= 0.8 ? 'warn' : 'bad')
