import { CABINET, CIVICS, JOBS_HISTORY, MINISTRIES, MINISTRY_SPECS, PIPELINE, POLICY_AREAS, POLICY_SPECS, SECTORS_ORDER, TALENT } from '../data/civics'
import { computeEconomy } from './economy'
import { draftSpeed, employmentOf, groupReport, nationPopulation, newCivics, passChance } from './civics'
import { addLog, clamp } from './helpers'
import { createRng } from './rng'
import type { GameState, Nation, WorldMap } from './types'

/** The desk's own random stream, so nothing it draws moves any other roll of the month. */
const SALT = 0x6c1c5
function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * The month end of the government desk, after the economy: every human nation gets a neutral desk if it has none; ministers gain
 * experience, drift in loyalty with approval, may be caught in a scandal or resign; drafts progress and bills are voted on; passed
 * policies phase in; brain drain strikes or heals; and human nations record the jobs picture for the charts.
 */
export function runCivics(s: GameState, map: WorldMap) {
  if (!CIVICS.on) return
  for (const id of Object.keys(s.nations).sort()) {
    const n = s.nations[id]
    if (!n?.alive) continue
    const human = s.humans?.includes(id) ?? false
    if (!n.civics && human) n.civics = newCivics()
    if (!n.civics) continue
    civicsMonth(s, map, n, human)
  }
}

function tell(s: GameState, n: Nation, human: boolean, text: string) {
  if (human || n.isPlayer) addLog(s, 'event', text, [n.id])
}

function civicsMonth(s: GameState, map: WorldMap, n: Nation, human: boolean) {
  const c = n.civics!
  const rng = createRng((s.seed ^ SALT) >>> 0, s.turn * 100003 + hashString(n.id))
  c.force = Math.max(0.01, nationPopulation(s, n.id) * TALENT.participation)
  const { approval } = groupReport(s, n)

  // Ministers: experience, loyalty, scandals and resignations.
  const anti = c.policies.antiCorruption
  const scandalMult = anti ? 1 - (anti.option === 'purge' ? 0.8 : anti.option === 'agency' ? 0.5 : 0) * anti.phase : 1
  for (const id of MINISTRIES) {
    const m = c.cabinet[id]
    if (!m) continue
    m.competence = Math.min(CABINET.competenceCap, Math.max(m.competence, m.competence + CABINET.experience))
    if (approval < CABINET.unhappyApproval) m.loyalty = clamp(m.loyalty - CABINET.loyaltyDrift, 0, 100)
    else if (approval > CABINET.happyApproval) m.loyalty = clamp(m.loyalty + CABINET.loyaltyDrift, 0, 100)
    const title = MINISTRY_SPECS[id].title
    if (rng.chance((m.corruption / 100) * CABINET.scandalChance * scandalMult)) {
      const hit = CABINET.scandalStability * (0.5 + m.popularity / 100)
      n.stability = clamp(n.stability - hit, 0, 100)
      m.popularity = clamp(m.popularity - CABINET.scandalPopularity, 0, 100)
      if (m.popularity < CABINET.resignPopularity) {
        delete c.cabinet[id]
        c.vacantUntil[id] = s.turn + 1 + CABINET.vacancyMonths
        tell(s, n, human, `Scandal: ${m.name}, ${title}, is caught taking money and resigns. Stability -${hit.toFixed(1)}.`)
      } else tell(s, n, human, `Scandal: ${m.name}, ${title}, is accused of graft but stays on. Stability -${hit.toFixed(1)}.`)
      continue
    }
    if (m.loyalty < CABINET.disloyal && rng.chance(CABINET.resignChance)) {
      delete c.cabinet[id]
      c.vacantUntil[id] = s.turn + 1 + CABINET.vacancyMonths
      tell(s, n, human, `${m.name} resigns as ${title}, unhappy with the government.`)
    }
  }

  // The pipeline: drafting, then a vote a month later, then the policy phases in.
  for (const b of [...c.bills]) {
    const spec = POLICY_SPECS[b.area]
    if (b.stage === 'drafting') {
      b.left = Math.max(0, b.left - draftSpeed(n, b.area))
      if (b.left <= 1e-9) {
        b.stage = 'vote'
        b.left = PIPELINE.voteMonths
        tell(s, n, human, `The ${spec.name.toLowerCase()} bill is drafted. ${PIPELINE.body[n.government] ?? 'The council'} votes next month (${Math.round(passChance(s, n, b) * 100)}% to pass now; lobbying helps).`)
      }
      continue
    }
    b.left -= 1
    if (b.left > 1e-9) continue
    const chance = passChance(s, n, b)
    c.bills = c.bills.filter((x) => x.id !== b.id)
    if (rng.chance(chance)) {
      if (b.option === spec.standard) delete c.policies[b.area]
      else c.policies[b.area] = { option: b.option, phase: 0, since: s.turn }
      tell(s, n, human, `${PIPELINE.body[n.government] ?? 'The council'} passed the ${spec.name.toLowerCase()} bill: ${spec.options[b.option]?.name ?? b.option}. It phases in over ${PIPELINE.phaseMonths} months.`)
    } else tell(s, n, human, `${PIPELINE.body[n.government] ?? 'The council'} voted down the ${spec.name.toLowerCase()} bill (${Math.round(chance * 100)}% chance). It can be drafted again.`)
  }
  for (const area of POLICY_AREAS) {
    const p = c.policies[area]
    if (p && p.phase < 1) p.phase = Math.min(1, p.phase + 1 / PIPELINE.phaseMonths)
  }

  // Brain drain: while people leave, professionals may go in a wave. It heals slowly.
  c.drain = Math.max(0, c.drain - TALENT.drainHeal)
  if ((n.people?.migration ?? 0) < TALENT.drainMigration && rng.chance(TALENT.drainChance)) {
    c.drain = Math.min(TALENT.drainMax, c.drain + TALENT.drainStep)
    tell(s, n, human, `Brain drain: engineers, doctors and officials are leaving ${n.name} for a better life abroad. Talent -${Math.round(TALENT.drainStep * 100)}%.`)
  }

  if (human) {
    const job = employmentOf(n, computeEconomy(s, map, n.id))
    c.history.push({ turn: s.turn, force: job.force, sectors: SECTORS_ORDER.map((k) => job.sectors[k]), unemployment: job.rate })
    if (c.history.length > JOBS_HISTORY) c.history.splice(0, c.history.length - JOBS_HISTORY)
  }
}
