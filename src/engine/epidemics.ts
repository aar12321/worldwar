import { EPIDEMIC, MEDICINE } from '../data/people'
import { addLog, clamp } from './helpers'
import { createRng } from './rng'
import { societyEffects } from './society'
import type { GameState, NationId, WorldMap } from './types'

/** How fast a nation's epidemic eases each month. */
export function recoveryRate(s: GameState, id: NationId, doctorCoverage: number): number {
  const n = s.nations[id]
  let vaccines = 0
  for (const t of n.techs) vaccines += MEDICINE[t]?.recovery ?? 0
  return (
    EPIDEMIC.recoveryBase +
    EPIDEMIC.recoveryHealth * n.people.health +
    EPIDEMIC.recoveryDoctors * Math.min(1.5, doctorCoverage) +
    (n.programs?.quarantine ? EPIDEMIC.recoveryQuarantine : 0) +
    (n.projects?.medCentre?.done ? EPIDEMIC.recoveryCentre : 0) +
    vaccines +
    // Clinics, clean water and vaccination drives help a sick country mend sooner.
    societyEffects(n).social.epidemic * 0.25
  )
}

/** Chance of a fresh outbreak this month: higher in poor health, lower with sanitation. */
export function outbreakChance(s: GameState, id: NationId): number {
  const n = s.nations[id]
  let risk = 0
  for (const t of n.techs) risk += MEDICINE[t]?.epidemicRisk ?? 0
  return (EPIDEMIC.baseChance + EPIDEMIC.sickChance * Math.max(0, 0.6 - n.people.health)) * Math.max(0.2, 1 + risk) * (1 - societyEffects(n).social.epidemic)
}

/**
 * The month's epidemics: outbreaks start where health is poor, cross borders, and ease with health, doctors, quarantine and medicine.
 * A sick nation loses people, output, calm and recruits (the economy reads the severity). Its own random stream, so turning
 * epidemics on changes no other roll.
 */
export function runEpidemics(s: GameState, map: WorldMap, neighbors: Map<NationId, Set<NationId>>, doctors: Map<NationId, number>) {
  const rng = createRng((s.seed ^ EPIDEMIC.salt) >>> 0, s.turn)
  const ids = Object.values(s.nations)
    .filter((n) => n.alive)
    .map((n) => n.id)
    .sort()
  const sickBefore = new Set(ids.filter((id) => s.nations[id].people.epidemic > 0))
  for (const id of ids) {
    const n = s.nations[id]
    const p = n.people
    if (p.epidemic > 0) {
      // Easing, and the toll.
      for (const r of Object.values(s.regions)) if (r.owner === id) r.population *= 1 - EPIDEMIC.popLoss * p.epidemic * (1 - p.health * 0.6)
      p.epidemic = Math.max(0, p.epidemic * (1 - clamp(recoveryRate(s, id, doctors.get(id) ?? 1), 0.05, 0.9)))
      if (p.epidemic < EPIDEMIC.end) {
        p.epidemic = 0
        addLog(s, 'news', `The epidemic in ${n.name} is over.`, [id])
      }
      continue
    }
    let chance = outbreakChance(s, id)
    for (const other of [...(neighbors.get(id) ?? [])].sort()) {
      if (!sickBefore.has(other)) continue
      const guard = n.programs?.quarantine ? EPIDEMIC.quarantineSpread : 1
      const theirs = s.nations[other]?.programs?.quarantine ? EPIDEMIC.quarantineSpread : 1
      chance += EPIDEMIC.spreadChance * (1 - p.health * 0.5) * guard * theirs * (1 - societyEffects(n).social.epidemic)
    }
    if (rng.chance(Math.min(0.5, chance))) startEpidemic(s, id, EPIDEMIC.startSeverity)
  }
  void map
}

export function startEpidemic(s: GameState, id: NationId, severity: number) {
  const n = s.nations[id]
  if (!n?.alive) return
  n.people.epidemic = clamp(Math.max(n.people.epidemic, severity), 0, 1)
  addLog(s, 'news', `An epidemic has broken out in ${n.name}.`, [id])
}
