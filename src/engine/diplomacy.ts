import { militaryPower } from './economy'
import { addLog, atWar, pairKey } from './helpers'
import type { Rng } from './rng'
import type { GameState, NationId } from './types'

export const TRUCE_TURNS = 12
export const PACT_TURNS = 24

export function declareWar(s: GameState, a: NationId, b: NationId) {
  const key = pairKey(a, b)
  if (s.wars.includes(key)) return
  s.wars.push(key)
  s.wars.sort()
  delete s.casusBelli[`${a}|${b}`]
  s.nations[b].warWeariness = Math.max(0, s.nations[b].warWeariness - 5)
  addLog(s, 'war', `${s.nations[a].name} has declared war on ${s.nations[b].name}!`, [a, b])
}

export function makePeace(s: GameState, a: NationId, b: NationId) {
  const key = pairKey(a, b)
  s.wars = s.wars.filter((k) => k !== key)
  s.pacts[key] = s.turn + TRUCE_TURNS
  s.peaceOffers = s.peaceOffers.filter((o) => !(o.from === a && o.to === b) && !(o.from === b && o.to === a))
  for (const id of [a, b]) s.nations[id].warWeariness = Math.max(0, s.nations[id].warWeariness - 10)
  addLog(s, 'diplomacy', `${s.nations[a].name} and ${s.nations[b].name} have signed a peace treaty (truce for ${TRUCE_TURNS} months).`, [a, b])
}

export function botAcceptsPeace(s: GameState, bot: NationId, from: NationId, rng: Rng): boolean {
  const me = s.nations[bot]
  const myPower = militaryPower(s, bot)
  const theirPower = militaryPower(s, from)
  if (me.warWeariness > 25) return true
  if (myPower < theirPower * 0.8) return true
  return rng.chance(0.15)
}

export function botAcceptsPact(s: GameState, bot: NationId, from: NationId, rng: Rng): boolean {
  if (atWar(s, bot, from)) return false
  const myPower = militaryPower(s, bot)
  const theirPower = militaryPower(s, from)
  if (theirPower >= myPower * 0.7) return true
  return rng.chance(0.4)
}

export function offerPeace(s: GameState, from: NationId, to: NationId, rng: Rng) {
  const target = s.nations[to]
  if (target.isPlayer) {
    if (!s.peaceOffers.some((o) => o.from === from && o.to === to)) s.peaceOffers.push({ from, to, turn: s.turn + 1 })
    addLog(s, 'diplomacy', `${s.nations[from].name} is suing for peace.`, [from, to])
    return
  }
  if (botAcceptsPeace(s, to, from, rng)) makePeace(s, from, to)
  else addLog(s, 'diplomacy', `${target.name} rejected ${s.nations[from].name}'s peace offer.`, [from, to])
}

export function offerPact(s: GameState, from: NationId, to: NationId, rng: Rng) {
  const target = s.nations[to]
  if (botAcceptsPact(s, to, from, rng)) {
    s.pacts[pairKey(from, to)] = s.turn + PACT_TURNS
    addLog(s, 'diplomacy', `${s.nations[from].name} and ${target.name} signed a non-aggression pact for ${PACT_TURNS} months.`, [from, to])
  } else {
    addLog(s, 'diplomacy', `${target.name} refused a non-aggression pact with ${s.nations[from].name}.`, [from, to])
  }
}

export function expireDiplomacy(s: GameState) {
  for (const [k, until] of Object.entries(s.pacts)) if (until < s.turn) delete s.pacts[k]
  for (const [k, until] of Object.entries(s.casusBelli)) if (until < s.turn) delete s.casusBelli[k]
  s.peaceOffers = s.peaceOffers.filter((o) => o.turn > s.turn)
}
