import { MW, rungOf } from '../data/missileWar'
import { buildRoom, buildRoomFor, missileStock, programLevel } from '../engine/missiles'
import { defenseCost, doctrineOf, interceptorCap, interceptorsOf, launchersSeen, mobileLevel, missilesInStore, radarLevel, raidPlan, tensionOf, truceAnswer, trucePair } from '../engine/missileWar'
import { freeUnits } from '../engine/deployment'
import { enemiesOf } from '../engine/helpers'
import type { Rng } from '../engine/rng'
import type { GameState, MissileType, NationId, Order, WorldMap } from '../engine/types'

/**
 * How a rival plays the missile war. It is a list of orders, best first; the bot adds the first one that is legal.
 *
 * Easy (skill 0) does nothing of it. Normal wants a retaliation doctrine, some radar and interceptors, and now and then a raid on a launch
 * site. Hard runs the whole war: counterforce on a big enemy store, decoys before a salvo into a full shield, bomber raids on the launchers,
 * recon against mobile launchers, batteries, mobile launchers of its own, launch on warning once it has the radar to trust it, and ceasefires
 * as the tension climbs. Everyone stops opening new salvos at the brink (the top rung): from there only doctrines answer.
 * Nuclear weapons keep their own rules (aiNuclearOrder): nothing here builds or fires a warhead.
 */
export function missileWarOrders(s: GameState, map: WorldMap, id: NationId, skill: 0 | 1 | 2, rng: Rng, phase: 'strike' | 'prepare'): Order[] {
  if (!MW.enabled || skill < 1) return []
  const n = s.nations[id]
  const foes = enemiesOf(s, id).filter((e) => s.nations[e]?.alive)
  if (!foes.length) return []
  // Two calls per decision: `strike` (ceasefire offers, counterforce, raids, recon) runs before the older answer-and-strike logic so a Hard rival goes for the
  // launchers first; `prepare` (doctrine, radar, rounds, batteries, decoys) runs after it, so that logic keeps its turn.
  const out: Order[] = []
  const prep: Order[] = []
  const money = n.resources.capital
  const tension = tensionOf(s)
  const rung = rungOf(tension)
  const mine = missilesInStore(n)
  const theirs = Math.max(0, ...foes.map((e) => missilesInStore(s.nations[e])))
  const hasWar = Object.keys(n.arsenal ?? {}).length > 0 || n.military.units.missile > 0 || programLevel(n) > 0
  const home = Object.values(s.regions).filter((r) => r.owner === id).sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1))

  // 1. De-escalation: as the world climbs the ladder, offer a ceasefire to a rival that would take it.
  // The offer is made once the tension reaches what a rival of this difficulty would accept (and only to a rival that would).
  if (tension >= MW.truceTension[skill]) {
    for (const e of foes) if (trucePair(s, id, e) === null && !s.humans.includes(e) && truceAnswer(s, e).accepts) out.push({ type: 'missileTruce', nationId: id, target: e })
  }

  // 2. Doctrine. A nation with missiles answers a strike; one with good radar and a calm world fires on warning. Never on warning at the top of the ladder.
  const doctrine = doctrineOf(n)
  if (mine >= 3 || theirs >= 3) {
    const wanted = skill === 2 && radarLevel(n) >= 2 && rung < 3 && mine >= 4 ? 'warning' : 'retaliate'
    if (doctrine !== wanted && !(doctrine === 'retaliate' && wanted === 'warning' && rng.chance(0.5))) prep.push({ type: 'setDoctrine', nationId: id, doctrine: wanted })
  }
  if (doctrine === 'warning' && rung >= 3) prep.push({ type: 'setDoctrine', nationId: id, doctrine: 'retaliate' })

  // 3. Defence, once an enemy has missiles to fear.
  if (theirs >= 3) {
    const cap = skill === 2 ? 3 : 1
    if (radarLevel(n) < cap && (n.missileWar?.radar ?? 0) < cap && money > defenseCost(s, { type: 'missileDefense', nationId: id, item: 'radar' }).capital + 200) prep.push({ type: 'missileDefense', nationId: id, item: 'radar' })
    const room = interceptorCap(n) - interceptorsOf(n)
    if (interceptorCap(n) > 0 && room >= 4 && money > room * MW.roundCost + 150) prep.push({ type: 'missileDefense', nationId: id, item: 'interceptors', count: Math.min(room, MW.roundsMaxOrder) })
    if (skill === 2 && home.length && money > MW.batteryMoney + 250) {
      // A battery where the people are.
      const place = home.find((r) => (n.missileWar?.batteries?.[r.id] ?? 0) < 1)
      if (place) prep.push({ type: 'missileDefense', nationId: id, item: 'battery', regionId: place.id })
    }
    if (skill === 2 && mine >= 6 && mobileLevel(n) < 1 && money > MW.mobileMoney[0] + 300) prep.push({ type: 'missileDefense', nationId: id, item: 'mobile' })
  }

  // 4. Offence, never opening new salvos at the brink, and not at all without something to fire.
  if (rung < MW.ladder.length - 1 && hasWar) {
    const stock = (k: MissileType) => missileStock(n, k)
    // Counterforce: an enemy store worth destroying, hit at its launch site with the precise kinds.
    if (skill === 2 && theirs >= 6 && rng.chance(0.55)) {
      const foe = foes.filter((e) => trucePair(s, id, e) === null).sort((a, b) => missilesInStore(s.nations[b]) - missilesInStore(s.nations[a]) || (a < b ? -1 : 1))[0]
      if (foe) {
        const sites = Object.values(s.regions).filter((r) => r.owner === foe && r.buildings.factory > 0 && (s.nations[foe].missileWar?.down?.[r.id] ?? -1) < s.turn).sort((a, b) => b.buildings.factory - a.buildings.factory || (a.id < b.id ? -1 : 1))
        const foeCap = interceptorCap(s.nations[foe])
        // A full shield first meets decoys: it burns rounds, so the real salvo behind it lands.
        if (foeCap > 0 && stock('decoy') >= 6 && interceptorsOf(s.nations[foe]) > foeCap * 0.5 && sites[0]) out.push({ type: 'strike', nationId: id, target: sites[0].id, weapon: 'missile', kind: 'decoy', count: Math.min(stock('decoy'), Math.max(6, Math.ceil(foeCap * 0.5))), aim: 'site' })
        for (const kind of ['tactical', 'hypersonic', 'cruise'] as MissileType[]) {
          const have = stock(kind)
          if (have < 3) continue
          for (const site of sites.slice(0, 3)) out.push({ type: 'strike', nationId: id, target: site.id, weapon: 'missile', kind, count: Math.min(8, have), aim: 'site' })
        }
        if (!launchersSeen(s, n, foe) && (s.nations[foe].missileWar?.mobile ?? 0) > 0) out.push({ type: 'recon', nationId: id, target: foe })
      }
    }
    // Raids: Hard against launchers when the enemy has a store, Normal now and then against a worn line.
    const free = freeUnits(s, id)
    if (free.air >= 0.5 && (skill === 2 || rng.chance(0.2))) {
      for (const foe of foes) {
        if (trucePair(s, id, foe) !== null) continue
        const regions = Object.values(s.regions).filter((r) => r.owner === foe)
        const sites = regions.filter((r) => r.buildings.factory > 0).sort((a, b) => b.buildings.factory - a.buildings.factory || (a.id < b.id ? -1 : 1))
        const target = theirs >= 4 && skill === 2 ? sites[0] : regions.sort((a, b) => b.line - a.line || (a.id < b.id ? -1 : 1))[0]
        if (!target) continue
        const plan = raidPlan(s, map, { nationId: id, target: target.id })
        // Only raids that come home: at most a third of the bombers lost.
        if (plan.loss <= 0.35) out.push({ type: 'raid', nationId: id, target: target.id, ...(theirs >= 4 && skill === 2 && target.buildings.factory > 0 ? { aim: 'site' as const } : {}) })
      }
    }
    // Building up, so there is something to fire: decoys for a Hard rival that faces a shield.
    if (skill === 2 && programLevel(n) >= 1 && buildRoom(n, s.turn) > 0 && money > 300 && foes.some((e) => interceptorCap(s.nations[e]) > 0) && stock('decoy') < 12) {
      prep.push({ type: 'buildMissiles', nationId: id, kind: 'decoy', count: Math.min(12, buildRoomFor(n, s.turn, 'decoy')) })
    }
  }
  return phase === 'strike' ? out : prep
}
