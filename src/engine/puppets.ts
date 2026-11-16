import { addOpinion } from '../ai/opinion'
import { DRAFT_LIMITS, LAW_SPECS, TAX_LIMITS } from '../data/unitTypes'
import { DEFAULT_TRIBUTE, LEVY_POOL, LIBERATE_TEXT, PUPPET, PUPPET_LAW_IDS, PUPPET_SPENDING_KEYS, TRIBUTE, TRIBUTE_FORMS } from '../data/puppets'
import { SPENDING } from '../data/people'
import { garrisonDivisions } from './deployment'
import { computeEconomy, type EconomyReport } from './economy'
import { lawProblem } from './empire'
import { addLog, atWar, clamp, enemiesOf, grantJustification, hasPact, justificationOf, pairKey, puppetsOf, regionsOf } from './helpers'
import { militaryPower } from './militaryStats'
import { cleanSpending } from './people'
import type { Rng } from './rng'
import type { GameState, LawId, Nation, NationId, Order, PuppetPatch, Spending, TributeForm, WorldMap } from './types'

/**
 * Puppet states, the whole rule set (numbers in `data/puppets.ts`).
 *
 * A puppet made by a peace deal has a loyalty (0 to 100). Its master RULES it: sets its tax and draft, a few laws, its welfare spending
 * and the form of the tribute it pays, once a month and for influence. Each month the loyalty moves by the PRESSURE of those choices and
 * is pulled back toward a neutral 60, so it settles at `neutral + pressure / settle`: a heavy hand ends in rebellion, a light one in
 * loyalty, and loyalty beyond 60 has to be paid for (aid, investment, a garrison, fair taxes) again every month.
 * A puppet with no `loyalty` (made before this existed) keeps the old flat rules until its master first rules it.
 */

type Ledger = Map<NationId, { gross: number; paid: number }>

export const isRuled = (n: Nation | undefined): n is Nation & { overlord: NationId; loyalty: number } => !!n?.overlord && n.loyalty !== undefined

/** The loyalty of a puppet, or undefined when it has none (a nation that is not a puppet, or an old puppet). */
export const loyaltyOf = (n: Nation | undefined): number | undefined => (n?.overlord ? n.loyalty : undefined)

/** Whether the puppet follows its master into a war: always, until loyalty is tracked and has fallen low. */
export const willFollow = (n: Nation | undefined): boolean => n?.loyalty === undefined || n.loyalty >= PUPPET.warLoyalty

/** How much of its tribute a puppet really pays: 0.7 when restive, 1.2 when devoted. */
export const compliance = (loyalty: number): number => PUPPET.complianceLow + (PUPPET.complianceHigh - PUPPET.complianceLow) * (clamp(loyalty, 0, 100) / 100)

export const tributeOf = (n: Nation): { form: TributeForm; share: number } => n.tribute ?? DEFAULT_TRIBUTE

/** What a puppet counts for toward its master's empire tier: half its countries, more when loyal, less when restive. */
export function countWeight(n: Nation): number {
  if (n.loyalty === undefined) return 0.5
  return n.loyalty >= PUPPET.high ? PUPPET.countHigh : n.loyalty < PUPPET.rebelBelow ? PUPPET.countLow : 0.5
}

/** What annexing costs, against the flat price: half for a devoted puppet, half as much again for a restive one. */
export function annexFactor(n: Nation | undefined): number {
  if (n?.loyalty === undefined) return 1
  return Math.max(PUPPET.annexMinCost, PUPPET.annexBase - n.loyalty / 100)
}

// ---- the rules a master sets -------------------------------------------------------------------------------------------------

/** The settings a master controls, as a plain object so a change can be tried out before it is ordered. */
export interface RuleView {
  taxRate: number
  draftRate: number
  laws: LawId[]
  spending: Spending
  tribute: { form: TributeForm; share: number }
}

export const viewOf = (n: Nation): RuleView => ({ taxRate: n.taxRate, draftRate: n.draftRate, laws: [...n.laws], spending: { ...n.spending }, tribute: { ...tributeOf(n) } })

/** The settings after a patch (assumed valid). */
export function applyPatchToView(v: RuleView, p: PuppetPatch): RuleView {
  const out: RuleView = { ...v, laws: [...v.laws], spending: { ...v.spending }, tribute: { ...v.tribute } }
  if (p.taxRate !== undefined) out.taxRate = p.taxRate
  if (p.draftRate !== undefined) out.draftRate = p.draftRate
  if (p.law) out.laws = p.law.on ? [...new Set([...out.laws, p.law.id])] : out.laws.filter((l) => l !== p.law!.id)
  if (p.spending) out.spending = cleanSpending({ ...out.spending, ...p.spending })
  if (p.tribute) out.tribute = { form: p.tribute.form, share: p.tribute.share }
  return out
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Influence a patch costs: so much for each thing it changes. Never throws, so a nonsense order only fails validation. */
export function governCost(s: GameState, o: Extract<Order, { type: 'governPuppet' }>): { capital: number; pp: number } {
  const p = o.patch
  const t = s.nations[o.target]
  if (!p || typeof p !== 'object' || !t) return { capital: 0, pp: 0 }
  let pp = 0
  if (p.taxRate !== undefined && !near(p.taxRate, t.taxRate)) pp += PUPPET.cost.tax
  if (p.draftRate !== undefined && !near(p.draftRate, t.draftRate)) pp += PUPPET.cost.draft
  if (p.law) pp += p.law.on ? PUPPET.cost.lawOn : PUPPET.cost.lawOff
  if (p.spending && typeof p.spending === 'object') for (const [k, v] of Object.entries(p.spending)) if (v !== t.spending?.[k as keyof Spending]) pp += PUPPET.cost.spending
  if (p.tribute) {
    const cur = tributeOf(t)
    pp += p.tribute.form !== cur.form ? PUPPET.cost.tributeForm : near(p.tribute.share, cur.share) ? 0 : PUPPET.cost.tributeShare
  }
  const capital = isNum(p.aid) ? p.aid : 0
  return { capital, pp }
}

/** The immediate shock to loyalty of a patch (negative for a harsh one). The monthly pressure that follows is `pressureOf`. */
export function governShock(s: GameState, o: Extract<Order, { type: 'governPuppet' }>, aidGainNow = 0): number {
  const p = o.patch
  const t = s.nations[o.target]
  if (!p || !t) return 0
  let v = 0
  if (isNum(p.taxRate)) v += p.taxRate > t.taxRate ? -(p.taxRate - t.taxRate) * PUPPET.tax.shock : (t.taxRate - p.taxRate) * (PUPPET.tax.shock / 2)
  if (isNum(p.draftRate)) v += p.draftRate > t.draftRate ? -(p.draftRate - t.draftRate) * PUPPET.draft.shock : 0
  const law = p.law && PUPPET.laws[p.law.id]
  if (p.law && law) v += p.law.on ? law.shock : -law.shock / 2
  if (p.spending) for (const [k, lv] of Object.entries(p.spending)) {
    const spec = PUPPET.spending[k as keyof Spending]
    if (spec && isNum(lv)) v += (lv - (t.spending?.[k as keyof Spending] ?? spec.standard)) * spec.weight * 2
  }
  return v + aidGainNow
}

/** Loyalty bought by aid: more for more money, but with a falling return against the puppet's size. Nothing past the ceiling. */
export function aidGain(s: GameState, map: WorldMap, puppetId: NationId, aid: number, e?: EconomyReport): number {
  const gross = (e ?? computeEconomy(s, map, puppetId)).gross
  const a = PUPPET.aid
  return a.gain * (1 - Math.exp(-aid / (a.scale + Math.max(0, gross) * a.perGross)))
}

// ---- pressure ---------------------------------------------------------------------------------------------------------------

export interface PressurePart {
  label: string
  value: number
}

/** What a master's way of ruling does to loyalty each month, part by part. The sum is the pressure. */
export function pressureOf(s: GameState, map: WorldMap, puppet: Nation, view: RuleView = viewOf(puppet), e?: EconomyReport): { total: number; parts: PressurePart[] } {
  const parts: PressurePart[] = []
  const add = (label: string, value: number) => {
    if (Math.abs(value) >= 0.005) parts.push({ label, value })
  }
  const t = PUPPET.tax
  add('Taxes', view.taxRate > t.neutral ? -(view.taxRate - t.neutral) * t.over : Math.min(t.relief, (t.neutral - view.taxRate) * t.under))
  add('The draft', view.draftRate > PUPPET.draft.neutral ? -(view.draftRate - PUPPET.draft.neutral) * PUPPET.draft.over : 0)
  for (const id of view.laws) {
    const law = PUPPET.laws[id]
    if (law) add(LAW_SPECS[id].name, law.held)
  }
  let sp = 0
  for (const k of PUPPET_SPENDING_KEYS) {
    const spec = PUPPET.spending[k]!
    sp += ((view.spending[k] ?? spec.standard) - spec.standard) * spec.weight
  }
  add('Spending on the people', clamp(sp, -PUPPET.spendingCap, PUPPET.spendingCap))
  const tr = TRIBUTE[view.tribute.form]
  const over = view.tribute.share - tr.easy
  add(`Tribute in ${tr.name.toLowerCase()}`, over > 0 ? -over * tr.burden : Math.min(tr.relief, -over * tr.burden))
  const master = puppet.overlord ? s.nations[puppet.overlord] : undefined
  if (master?.alive) {
    const mine = regionsOf(s, puppet.id).length
    const cover = clamp(garrisonDivisions(s, master.id, puppet.id) / Math.max(1, mine * PUPPET.garrison.perCountry), 0, 1)
    add('Garrison of the master', cover * PUPPET.garrison.pressure)
    const gross = Math.max(1, (e ?? computeEconomy(s, map, puppet.id)).gross)
    const stake = (s.investments ?? []).reduce((sum, i) => (i.investor === master.id && i.target === puppet.id ? sum + i.amount : sum), 0)
    add('Investment of the master', clamp(stake / (gross * PUPPET.invest.months), 0, 1) * PUPPET.invest.pressure)
    if (militaryPower(s, puppet.id) > militaryPower(s, master.id) * PUPPET.strongShare) add('Strong enough to break away', PUPPET.strongPressure)
  }
  if (puppet.resources.capital < 0) add('An empty treasury', PUPPET.redPressure)
  if (puppet.stability < PUPPET.stabilityBelow) add('Unrest at home', -(PUPPET.stabilityBelow - puppet.stability) * PUPPET.stabilityPerPoint)
  return { total: parts.reduce((t0, p) => t0 + p.value, 0), parts }
}

/** The loyalty a puppet settles at if its master changes nothing. */
export const equilibrium = (pressure: number): number => clamp(PUPPET.neutral + pressure / PUPPET.settle, 0, 100)

// ---- tribute ----------------------------------------------------------------------------------------------------------------

export interface Yield {
  form: TributeForm
  /** What is taken each month, in the form's own unit (money, oil, steel, thousands of soldiers). */
  amount: number
  /** The same worth in money, to weigh the forms against each other. */
  money: number
}

/** The tribute a puppet would pay each month at this loyalty (before the master's overall cap). */
export function yieldOf(s: GameState, map: WorldMap, puppet: Nation, tribute: { form: TributeForm; share: number }, loyalty = puppet.loyalty ?? PUPPET.start, e?: EconomyReport): Yield {
  const r = e ?? computeEconomy(s, map, puppet.id)
  let base = 0
  let cap = Infinity
  switch (tribute.form) {
    case 'money':
      base = Math.max(0, r.taxIncome + r.factoryIncome + r.tradeIncome + r.corporateIncome)
      cap = Math.max(0, puppet.resources.capital)
      break
    case 'oil':
      base = Math.max(0, r.oilProduction)
      cap = Math.max(0, puppet.resources.oil)
      break
    case 'steel':
      base = Math.max(0, r.steelProduction)
      cap = Math.max(0, puppet.resources.steel)
      break
    case 'levy':
      base = Math.max(0, puppet.militaryPool) * LEVY_POOL
      cap = Math.max(0, puppet.militaryPool)
      break
  }
  const amount = Math.min(base * tribute.share * compliance(loyalty), cap)
  return { form: tribute.form, amount, money: amount * TRIBUTE[tribute.form].value }
}

/** All of a master's puppets' tribute in money, now, and the cap it is held to. */
export function extraction(s: GameState, map: WorldMap, master: NationId): { total: number; cap: number } {
  const gross = computeEconomy(s, map, master).gross
  let total = 0
  for (const id of puppetsOf(s, master)) {
    const p = s.nations[id]
    total += yieldOf(s, map, p, tributeOf(p)).money
  }
  return { total, cap: Math.max(0, gross) * PUPPET.extractionCap }
}

// ---- the month --------------------------------------------------------------------------------------------------------------

/** Takes the tribute, moves the loyalty and deals with what follows from it. Called once a month for each puppet that has a loyalty. */
export function runPuppetMonth(s: GameState, map: WorldMap, puppet: Nation, master: Nation, rng: Rng, ledger: Ledger) {
  const e = computeEconomy(s, map, puppet.id)
  const loyalty = puppet.loyalty ?? PUPPET.start
  const tribute = tributeOf(puppet)
  const y = yieldOf(s, map, puppet, tribute, loyalty, e)
  let led = ledger.get(master.id)
  if (!led) ledger.set(master.id, (led = { gross: computeEconomy(s, map, master.id).gross, paid: 0 }))
  // Everything a master takes from all its puppets together is held to a share of its own gross: what is above that is paid at half.
  const cap = Math.max(0, led.gross) * PUPPET.extractionCap
  const room = Math.max(0, cap - led.paid)
  const factor = y.money <= room || y.money <= 0 ? 1 : (room + (y.money - room) * PUPPET.capRate) / y.money
  const amount = y.amount * factor
  led.paid += y.money * factor
  if (amount > 0) {
    if (tribute.form === 'money') {
      puppet.resources.capital -= amount
      master.resources.capital += amount
    } else if (tribute.form === 'levy') {
      puppet.militaryPool -= amount
      master.militaryPool += amount
    } else {
      puppet.resources[tribute.form] -= amount
      master.resources[tribute.form] += amount
    }
  }
  // Loyalty.
  const { total } = pressureOf(s, map, puppet, viewOf(puppet), e)
  puppet.loyalty = clamp(loyalty + total + (PUPPET.neutral - loyalty) * PUPPET.settle, 0, 100)
  const L = puppet.loyalty
  if (L < PUPPET.restive) puppet.stability = clamp(puppet.stability - (PUPPET.restive - L) * PUPPET.unrestPerPoint, 0, 100)
  if (L < PUPPET.rebelBelow && rng.chance(((PUPPET.rebelBelow - L) / PUPPET.rebelBelow) * PUPPET.rebelChance)) {
    const held = Object.values(s.regions).filter((r) => r.owner === puppet.id).sort((a, b) => (a.id < b.id ? -1 : 1))
    const away = held.filter((r) => r.id !== puppet.capital)
    const pool = away.length ? away : held
    if (pool.length) {
      rng.pick(pool).rebels += 1
      addLog(s, 'event', `Rebels rose in ${puppet.name} against ${master.name}'s rule.`, [puppet.id, master.id])
    }
  }
  if (L < PUPPET.freeBelow) {
    const garrisoned = garrisonDivisions(s, master.id, puppet.id) >= 1
    const chance = (PUPPET.freeChance + (PUPPET.freeBelow - L) * PUPPET.freeStep) * (garrisoned && PUPPET.garrison.freeHalved ? 0.5 : 1)
    if (rng.chance(chance)) {
      freePuppet(s, puppet.id)
      addLog(s, 'war', `${puppet.name} threw off ${master.name}'s rule and is independent again.`, [puppet.id, master.id])
      return
    }
  }
  if (L < PUPPET.liberate.below) callForHelp(s, map, puppet, master, rng)
  else if (willFollow(puppet)) joinMasterWars(s, puppet, master)
}

/** A very restive puppet cries out: neighbors of either side and the master's enemies get a reason to free it, and think less of the master. */
function callForHelp(s: GameState, map: WorldMap, puppet: Nation, master: Nation, rng: Rng) {
  const L = PUPPET.liberate
  const first = (puppet.calledOut ?? -999) + L.again <= s.turn
  const reason = LIBERATE_TEXT.cause(puppet.name, master.name)
  if (first) {
    puppet.calledOut = s.turn
    const near = new Set<NationId>()
    for (const r of Object.values(s.regions)) {
      if (r.owner !== puppet.id && r.owner !== master.id) continue
      for (const nb of map.regions[r.id]?.neighbors ?? []) {
        const o = s.regions[nb]?.owner
        if (o && o !== puppet.id && o !== master.id) near.add(o)
      }
    }
    const friends = [...new Set([...near, ...enemiesOf(s, master.id)])].sort().filter((id) => {
      const n = s.nations[id]
      return n?.alive && !id.startsWith('free-') && id !== master.id && !hasPact(s, id, master.id) && !s.alliances.includes(pairKey(id, master.id)) && n.overlord !== master.id
    })
    for (const id of friends.slice(0, 6)) {
      grantJustification(s, id, master.id, reason, L.reasonMonths)
      addOpinion(s, id, master.id, 'Holds a puppet in chains', -8, 0.25)
    }
    addOpinion(s, puppet.id, master.id, 'Our oppressor', -20, 0.2)
    addLog(s, 'war', `${puppet.name} cries out against ${master.name}. ${friends.length ? `${friends.length === 1 ? 'A nation has' : `${friends.length} nations have`} a reason to free it.` : 'No one answers.'}`, [puppet.id, master.id, ...friends.slice(0, 3)])
  }
  // A nation at war with the master that holds the reason may free the puppet outright.
  for (const foe of enemiesOf(s, master.id).sort()) {
    const j = justificationOf(s, foe, master.id)
    if (!s.nations[foe]?.alive || !j || j.reason !== reason) continue
    if (rng.chance(L.free)) {
      freePuppet(s, puppet.id)
      addOpinion(s, puppet.id, foe, 'Freed us', 40, 0.1)
      addLog(s, 'war', `${s.nations[foe].name} freed ${puppet.name} from ${master.name}.`, [foe, puppet.id, master.id])
      return
    }
  }
}

/** A loyal puppet fights beside its master in wars begun before it became a puppet or while it was unwilling. Same rules as declaring: pacts fall. */
function joinMasterWars(s: GameState, puppet: Nation, master: Nation) {
  for (const foe of enemiesOf(s, master.id).sort()) {
    if (foe === puppet.id || atWar(s, puppet.id, foe) || !s.nations[foe]?.alive || foe.startsWith('free-')) continue
    if (s.nations[foe].overlord === master.id) continue
    puppetJoinsWar(s, puppet.id, master.id, foe)
  }
}

/** A puppet takes its master's side in a war with `foe`. */
export function puppetJoinsWar(s: GameState, puppet: NationId, side: NationId, foe: NationId) {
  const pk = pairKey(puppet, foe)
  s.wars.push(pk)
  s.wars.sort()
  s.warStarted[pk] = s.turn
  delete s.pacts[pk]
  addLog(s, 'war', `${s.nations[puppet].name} follows its overlord ${s.nations[side].name} into the war against ${s.nations[foe].name}.`, [puppet, side, foe])
}

// ---- becoming a puppet, and ceasing to be one -------------------------------------------------------------------------------

/** Makes `puppet` a puppet of `master`, with loyalty. Anything the new puppet itself ruled passes up to the master. */
export function bindPuppet(s: GameState, puppetId: NationId, masterId: NationId) {
  const p = s.nations[puppetId]
  for (const id of puppetsOf(s, puppetId)) {
    const q = s.nations[id]
    if (id === masterId) continue
    q.overlord = masterId
    q.overlordSince = s.turn
    if (q.loyalty !== undefined) q.loyalty = Math.max(0, q.loyalty - 10)
  }
  p.overlord = masterId
  p.overlordSince = s.turn
  p.loyalty = PUPPET.start
  delete p.tribute
  delete p.ruledAt
  delete p.calledOut
}

/** The wars `holder` went into to free puppets of `master`, as the ids of the puppets. */
export const liberationWarFor = (s: GameState, holder: NationId, master: NationId): NationId[] => s.liberationWars?.[`${holder}>${master}`] ?? []

/** Why `holder` may not free `puppet` (a puppet of `master`, the nation it is at war with) at the peace table, or null. The cause: it went to war to free that puppet, or the puppet cries out (loyalty below `liberate.below`). */
export function liberationProblem(s: GameState, holder: NationId, master: NationId, puppet: NationId): string | null {
  const p = typeof puppet === 'string' ? s.nations[puppet] : undefined
  if (!p?.alive || p.overlord !== master) return 'They are not a puppet of that nation'
  if (!atWar(s, holder, master)) return 'You are not at war with its master'
  if (s.nations[holder]?.overlord) return 'A puppet cannot free puppets'
  if (puppet === holder) return 'You cannot free yourself this way'
  const wentToWar = liberationWarFor(s, holder, master).includes(puppet)
  const cries = p.loyalty !== undefined && p.loyalty < PUPPET.liberate.below
  if (!wentToWar && !cries) return `You have no cause to free ${p.name}: you did not go to war for it and it does not cry out`
  return null
}

/** The puppets of `master` that `holder` may free at the peace table now. */
export const liberablePuppets = (s: GameState, holder: NationId, master: NationId): NationId[] => puppetsOf(s, master).filter((id) => liberationProblem(s, holder, master, id) === null).sort()

/** Ends a puppet's subjection: the loyalty and everything the master set on it as tribute are cleared. */
export function freePuppet(s: GameState, puppetId: NationId) {
  const p = s.nations[puppetId]
  if (!p) return
  p.overlord = null
  clearPuppetFields(p)
}

export function clearPuppetFields(p: Nation) {
  delete p.loyalty
  delete p.tribute
  delete p.ruledAt
  delete p.calledOut
}

// ---- ruling a puppet: validation and execution ------------------------------------------------------------------------------

type Govern = Extract<Order, { type: 'governPuppet' }>
const PATCH_KEYS = ['taxRate', 'draftRate', 'law', 'spending', 'tribute', 'aid']

/** Why `o.nationId` may not rule this puppet this way now, or null. A nonsense patch is refused with a reason that reads. */
export function governProblem(s: GameState, o: Govern, pending: Order[]): string | null {
  const t = s.nations[o.target]
  if (typeof o.target !== 'string' || !t?.alive || t.overlord !== o.nationId) return 'They are not your puppet'
  if (s.humans.includes(o.target)) return `${t.name} is run by another player. Its government is theirs to rule.`
  if (atWar(s, o.target, o.nationId)) return 'They are at war with you'
  const p = o.patch
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'Choose what to change'
  const keys = Object.keys(p)
  if (keys.length === 0) return 'Choose what to change'
  const stray = keys.find((k) => !PATCH_KEYS.includes(k))
  if (stray) return `Nothing called "${stray}" can be changed`
  if (t.ruledAt === s.turn || pending.some((x) => x.type === 'governPuppet' && x.target === o.target)) return `${t.name}'s rules were already changed this month`
  let changes = 0
  const laws = new Set(t.laws)
  if (p.law !== undefined) {
    const l = p.law
    if (!l || typeof l !== 'object' || typeof l.on !== 'boolean' || typeof l.id !== 'string') return 'Choose a law'
    if (!PUPPET_LAW_IDS.includes(l.id)) return 'A puppet can only be given Martial Law, Conscription, Free Trade, Austerity, Rationing or Press Control'
    if (l.on) {
      if (t.laws.length >= PUPPET.maxLaws) return `${t.name} can keep only ${PUPPET.maxLaws} laws you set. Repeal one.`
      const why = lawProblem(t, l.id)
      if (why) return why.startsWith('You have room') ? `${t.name} has no room for another law` : why
      laws.add(l.id)
    } else {
      if (!t.laws.includes(l.id)) return 'That law is not in force'
      laws.delete(l.id)
    }
    changes++
  }
  if (p.taxRate !== undefined) {
    if (!isNum(p.taxRate)) return 'The tax rate must be a number'
    if (p.taxRate < TAX_LIMITS.min - 1e-9 || p.taxRate > PUPPET.maxTax + 1e-9) return `A puppet's tax goes from ${Math.round(TAX_LIMITS.min * 100)}% to ${Math.round(PUPPET.maxTax * 100)}%`
    if (!near(p.taxRate, t.taxRate)) changes++
  }
  if (p.draftRate !== undefined) {
    if (!isNum(p.draftRate)) return 'The draft rate must be a number'
    const max = laws.has('conscription_act') ? PUPPET.maxDraft : DRAFT_LIMITS.max
    if (p.draftRate < DRAFT_LIMITS.min - 1e-9 || p.draftRate > max + 1e-9) return `A puppet's draft goes from ${Math.round(DRAFT_LIMITS.min * 100)}% to ${Math.round(max * 100)}%${laws.has('conscription_act') ? '' : ' (25% with Conscription)'}`
    if (!near(p.draftRate, t.draftRate)) changes++
  }
  if (p.spending !== undefined) {
    if (!p.spending || typeof p.spending !== 'object' || Array.isArray(p.spending)) return 'Choose spending levels'
    const entries = Object.entries(p.spending)
    if (entries.length === 0) return 'Choose spending levels'
    for (const [k, v] of entries) {
      const spec = PUPPET.spending[k as keyof Spending]
      if (!spec) return 'A puppet\'s schools, health, pensions, jobless support and housing can be set'
      const max = SPENDING[k as keyof Spending].max
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > max) return `${SPENDING[k as keyof Spending].name} goes from 0 to ${max}`
      if (v !== t.spending[k as keyof Spending]) changes++
    }
  }
  if (p.tribute !== undefined) {
    const tr = p.tribute
    if (!tr || typeof tr !== 'object' || !TRIBUTE_FORMS.includes(tr.form)) return 'Choose money, oil, steel or soldiers as tribute'
    const spec = TRIBUTE[tr.form]
    if (!isNum(tr.share) || tr.share < spec.min - 1e-9 || tr.share > spec.max + 1e-9) return `Tribute in ${spec.name.toLowerCase()} goes from ${Math.round(spec.min * 100)}% to ${Math.round(spec.max * 100)}% of ${spec.of}`
    const cur = tributeOf(t)
    if (tr.form !== cur.form || !near(tr.share, cur.share)) changes++
  }
  if (p.aid !== undefined) {
    if (!isNum(p.aid) || p.aid < PUPPET.aid.min || p.aid > PUPPET.aid.max) return `Aid goes from ${PUPPET.aid.min} to ${PUPPET.aid.max} money`
    if ((t.loyalty ?? PUPPET.start) >= PUPPET.aid.ceiling) return `${t.name} could hardly be more loyal`
    changes++
  }
  if (changes === 0) return 'That changes nothing'
  return null
}

/** Carries out a validated patch. Mutates `s`. A puppet without loyalty gains it now (the master takes it in hand). */
export function applyGovern(s: GameState, map: WorldMap, o: Govern) {
  const t = s.nations[o.target]
  const m = s.nations[o.nationId]
  const p = o.patch
  t.loyalty ??= PUPPET.start
  let shock = governShock(s, o)
  if (p.aid !== undefined) {
    const g = aidGain(s, map, t.id, p.aid)
    shock += g
    t.resources.capital += p.aid * PUPPET.aid.reaches
  }
  if (p.taxRate !== undefined) t.taxRate = p.taxRate
  if (p.draftRate !== undefined) t.draftRate = p.draftRate
  if (p.law) {
    if (p.law.on) t.laws.push(p.law.id)
    else {
      t.laws = t.laws.filter((l) => l !== p.law!.id)
      if (p.law.id === 'conscription_act') t.draftRate = Math.min(t.draftRate, DRAFT_LIMITS.max)
    }
  }
  if (p.spending) t.spending = cleanSpending({ ...t.spending, ...p.spending })
  if (p.tribute) t.tribute = { form: p.tribute.form, share: p.tribute.share }
  t.loyalty = clamp(t.loyalty + shock, 0, 100)
  t.ruledAt = s.turn
  if (m.isPlayer || s.humans.includes(m.id)) addLog(s, 'diplomacy', `You ruled ${t.name}: ${describePatch(s, o)}. Its loyalty is now ${Math.round(t.loyalty)}.`, [o.nationId, o.target])
}

/** The patch in words, for the news and the order list. */
export function describePatch(s: GameState, o: Govern): string {
  const p = o.patch
  const t = s.nations[o.target]
  if (!p || typeof p !== 'object' || !t) return 'rules'
  const parts: string[] = []
  if (p.taxRate !== undefined) parts.push(`tax ${Math.round(p.taxRate * 100)}%`)
  if (p.draftRate !== undefined) parts.push(`draft ${Math.round(p.draftRate * 100)}%`)
  if (p.law) parts.push(`${p.law.on ? 'enact' : 'repeal'} ${LAW_SPECS[p.law.id]?.name ?? 'a law'}`)
  if (p.spending) parts.push(`spending on ${Object.keys(p.spending).map((k) => SPENDING[k as keyof Spending]?.name.toLowerCase() ?? k).join(', ')}`)
  if (p.tribute) parts.push(`tribute ${Math.round(p.tribute.share * 100)}% in ${TRIBUTE[p.tribute.form]?.name.toLowerCase() ?? 'something'}`)
  if (p.aid !== undefined) parts.push(`aid ${Math.round(p.aid)}`)
  return parts.join(', ')
}

export interface Preview {
  cost: { capital: number; pp: number }
  /** Loyalty change at once. */
  shock: number
  loyalty: number
  /** The monthly pressure and the loyalty it settles at, now and after the change. */
  pressureNow: number
  pressureAfter: number
  settlesNow: number
  settlesAfter: number
  yieldNow: Yield
  yieldAfter: Yield
  partsAfter: PressurePart[]
}

/** What a patch would do, worked out without changing anything, for the screen to show before the order is given. */
export function previewGovern(s: GameState, map: WorldMap, masterId: NationId, puppetId: NationId, patch: PuppetPatch): Preview {
  const t = s.nations[puppetId]
  const o: Govern = { type: 'governPuppet', nationId: masterId, target: puppetId, patch }
  const e = computeEconomy(s, map, puppetId)
  const now = viewOf(t)
  const after = applyPatchToView(now, patch)
  if (patch.law && !patch.law.on && patch.law.id === 'conscription_act') after.draftRate = Math.min(after.draftRate, DRAFT_LIMITS.max)
  const gain = patch.aid !== undefined && isNum(patch.aid) ? aidGain(s, map, puppetId, patch.aid, e) : 0
  const shock = governShock(s, o, gain)
  const loyalty = t.loyalty ?? PUPPET.start
  const pn = pressureOf(s, map, t, now, e)
  const pa = pressureOf(s, map, t, after, e)
  return {
    cost: governCost(s, o),
    shock,
    loyalty,
    pressureNow: pn.total,
    pressureAfter: pa.total,
    settlesNow: equilibrium(pn.total),
    settlesAfter: equilibrium(pa.total),
    yieldNow: yieldOf(s, map, t, now.tribute, loyalty, e),
    yieldAfter: yieldOf(s, map, t, after.tribute, clamp(loyalty + shock, 0, 100), e),
    partsAfter: pa.parts,
  }
}

/** The master may not have its puppet's own bot or a hand-written plan change what it rules. */
export function lockedByMaster(s: GameState, n: Nation | undefined): boolean {
  return !!n && isRuled(n) && !s.humans.includes(n.id)
}
