import { NO_EFFECTS, type PolicyEffects } from '../data/government'
import { PROJECT_IDS, PROJECT_LEVELS, PROJECTS } from '../data/projects'
import { CAMPAIGNS, CAMPAIGN_IDS, LEVEL_NAMES, MAX_LEVEL, NO_SOCIAL, SOCIAL, SOCIAL_FIELDS, SOCIAL_IDS, SOCIAL_RULES, campaignCost, powerOf, type SocialEffect, type SocialEffects } from '../data/society'
import { tierGate } from './empire'
import { addLog, clamp } from './helpers'
import type { CampaignId, GameState, Nation, NationId, SocialId } from './types'

/** The fields of `PolicyEffects` that a program can carry. Stability is counted on its own, with a ceiling, so it is left out here. */
const POLICY_FIELDS = (Object.keys(NO_EFFECTS) as (keyof PolicyEffects)[]).filter((k) => k !== 'stability')

export interface SocietySource {
  /** 'policy:clinics', 'campaign:celebration' and so on. */
  id: string
  name: string
  /** Stability this source adds before the ceiling. */
  stability: number
}

export interface SocietyReport {
  /** Output, money, research and the rest, ready to add to what the government and laws give. Its stability is 0: see `stability`. */
  policy: PolicyEffects
  /** What the people themselves feel: health, schooling, jobs, births, calm. */
  social: SocialEffects
  /** Stability from all programs and campaigns, after the ceiling. */
  stability: number
  /** The same before the ceiling. */
  rawStability: number
  sources: SocietySource[]
}

const NONE: SocietyReport = Object.freeze({ policy: Object.freeze({ ...NO_EFFECTS }) as PolicyEffects, social: Object.freeze({ ...NO_SOCIAL }) as SocialEffects, stability: 0, rawStability: 0, sources: [] }) as SocietyReport

/** Care helps a great deal at first and less and less, and can never pin stability at the top: 18 at the very most, approached but never reached. */
export function softCap(raw: number): number {
  if (raw <= 0) return raw
  const cap = SOCIAL_RULES.stabilityCap
  return cap * (1 - Math.exp(-raw / cap))
}

const CAPPED_SHARES: (keyof SocialEffects)[] = ['famine', 'epidemic', 'order']

type Held = Pick<Nation, 'social' | 'campaigns'> & Partial<Pick<Nation, 'projects'>>

/** Everything a nation's programs and running campaigns do, added up. A nation with none gets the same zeros every time, at no cost. */
export function societyEffects(n: Held): SocietyReport {
  if (!hasSociety(n)) return NONE
  const policy: PolicyEffects = { ...NO_EFFECTS }
  const social: SocialEffects = { ...NO_SOCIAL }
  const sources: SocietySource[] = []
  let raw = 0
  const add = (e: SocialEffect, power: number, id: string, name: string) => {
    for (const k of POLICY_FIELDS) policy[k] += (e[k] ?? 0) * power
    for (const k of SOCIAL_FIELDS) social[k] += (e[k] ?? 0) * power
    const st = (e.stability ?? 0) * power
    raw += st
    if (st !== 0) sources.push({ id, name, stability: st })
  }
  for (const id of SOCIAL_IDS) {
    const state = n.social?.[id]
    if (state && state.strength > 0) add(SOCIAL[id].effects, powerOf(state.strength), `policy:${id}`, SOCIAL[id].name)
  }
  for (const id of CAMPAIGN_IDS) {
    const c = n.campaigns?.[id]
    if (c && c.left > 0) add(CAMPAIGNS[id].effects, 1, `campaign:${id}`, CAMPAIGNS[id].name)
  }
  // National projects whose effects are written as data (the seven older ones have theirs in the economy itself).
  for (const id of PROJECT_IDS) {
    const spec = PROJECTS[id]
    const p = n.projects?.[id]
    if (!spec.effects || !p) continue
    const level = p.level ?? (p.done ? 1 : 0)
    if (level >= 1) add(spec.effects, PROJECT_LEVELS.power[level], `project:${id}`, spec.name)
  }
  // These are shares of a trouble that goes away (hunger, plague, rebels): stacked programs, projects and campaigns could pass 100% and turn it into a gain.
  for (const k of CAPPED_SHARES) social[k] = Math.min(SOCIAL_RULES.shareCap, social[k])
  return { policy, social, stability: softCap(raw), rawStability: raw, sources }
}

/** Whether a nation has any program or campaign at all (running, phasing out or cooling down). */
export function hasSociety(n: Held): boolean {
  const programs = n.social ? Object.keys(n.social).length : 0
  const campaigns = n.campaigns ? Object.keys(n.campaigns).length : 0
  if (programs + campaigns > 0) return true
  return !!n.projects && PROJECT_IDS.some((id) => PROJECTS[id].effects && n.projects![id])
}

/** The level a program is set to. */
export const socialLevel = (n: Held, id: SocialId) => n.social?.[id]?.level ?? 0

/** Money a month for all programs, from each one's level and the size of the workforce. */
export function societyBill(n: Held, workforce: number): { total: number; byPolicy: Partial<Record<SocialId, number>> } {
  const byPolicy: Partial<Record<SocialId, number>> = {}
  let total = 0
  if (!n.social) return { total, byPolicy }
  for (const id of SOCIAL_IDS) {
    const level = n.social[id]?.level ?? 0
    if (level <= 0) continue
    const cost = SOCIAL[id].cost * level * workforce
    byPolicy[id] = cost
    total += cost
  }
  return { total, byPolicy }
}

/**
 * How big a nation is for pricing a campaign: the same curve as the workforce (population to the power 0.6), added up over its
 * countries. It needs no map, so a price is the same wherever it is asked.
 */
export function nationSize(s: GameState, nationId: NationId): number {
  let size = 0
  for (const r of Object.values(s.regions)) if (r.owner === nationId) size += Math.pow(Math.max(0.05, r.population), 0.6)
  return size
}

// ---- Orders ----

/** Influence to take a program from one level to another: each step up is paid for, a step down is free. */
export function socialCost(n: Held, id: SocialId, level: number): number {
  const spec = SOCIAL[id]
  if (!spec) return 0
  let pp = 0
  for (let l = socialLevel(n, id) + 1; l <= level && l <= MAX_LEVEL; l++) pp += spec.enact[l - 1]
  return pp
}

export function campaignPrice(s: GameState, n: Nation, id: CampaignId): number {
  return CAMPAIGNS[id] ? campaignCost(id, nationSize(s, n.id)) : 0
}

/** Why a program cannot be set to this level now, or null. */
export function socialProblem(s: GameState, n: Nation, id: SocialId, level: number): string | null {
  const spec = SOCIAL[id]
  if (!spec) return 'Unknown program'
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) return 'A program is Off, Pilot, National or Universal'
  const state = n.social?.[id]
  if ((state?.level ?? 0) === level) return `Already ${LEVEL_NAMES[level].toLowerCase()}`
  // The bigger programs need a bigger state to run them.
  if (level === MAX_LEVEL) {
    const gate = tierGate(s, n.id, 2)
    if (gate) return gate
  }
  if (state && state.changed === s.turn) return 'Already changed this month'
  return null
}

/** Why a campaign cannot be run now, or null. */
export function campaignProblem(n: Nation, id: CampaignId): string | null {
  if (!CAMPAIGNS[id]) return 'Unknown campaign'
  const c = n.campaigns?.[id]
  if (c && c.left > 0) return `Already running: ${c.left} month${c.left === 1 ? '' : 's'} left`
  if (c && c.cooldown > 0) return `Ready again in ${c.cooldown} month${c.cooldown === 1 ? '' : 's'}`
  return null
}

/** Sets a program's level. Cutting one costs stability at once: people do not forgive losing what they were given. */
export function applySocial(s: GameState, n: Nation, id: SocialId, level: number) {
  const states = (n.social ??= {})
  const state = (states[id] ??= { level: 0, strength: 0, changed: -1 })
  const before = state.level
  if (level < before) n.stability = clamp(n.stability - (before - level) * SOCIAL_RULES.cutStability, 0, 100)
  state.level = level
  state.changed = s.turn
  if (n.isPlayer) addLog(s, 'economy', `${n.name} ${level > before ? 'raised' : 'cut'} ${SOCIAL[id].name.toLowerCase()} to ${LEVEL_NAMES[level].toLowerCase()}.`, [n.id])
}

/** Starts a campaign: its effect for its months, a wait before the next, and what it does at once. */
export function applyCampaign(s: GameState, n: Nation, id: CampaignId) {
  const spec = CAMPAIGNS[id]
  ;(n.campaigns ??= {})[id] = { left: spec.months, cooldown: spec.cooldown }
  if (spec.instant?.stability) n.stability = clamp(n.stability + spec.instant.stability, 0, 100)
  if (spec.instant?.epidemic && n.people) n.people.epidemic *= 1 - spec.instant.epidemic
  if (n.isPlayer) addLog(s, 'economy', `${n.name} began a ${spec.name.toLowerCase()}.`, [n.id])
}

/**
 * A month of the people's programs: each one's effect moves toward its level, a campaign runs down, and what has finished is
 * forgotten. Runs inside the economy, so turns and live days agree.
 */
export function runSociety(n: Nation) {
  if (n.social) {
    for (const id of Object.keys(n.social) as SocialId[]) {
      const st = n.social[id]!
      st.strength += clamp(st.level - st.strength, -SOCIAL_RULES.phaseIn, SOCIAL_RULES.phaseIn)
      if (st.level === 0 && st.strength < 0.01) delete n.social[id]
    }
  }
  if (n.campaigns) {
    for (const id of Object.keys(n.campaigns) as CampaignId[]) {
      const c = n.campaigns[id]!
      c.left = Math.max(0, c.left - 1)
      c.cooldown = Math.max(0, c.cooldown - 1)
      if (c.left === 0 && c.cooldown === 0) delete n.campaigns[id]
    }
  }
}
