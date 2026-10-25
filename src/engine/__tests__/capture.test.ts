import { geoArea, geoContains } from 'd3-geo'
import { describe, expect, it } from 'vitest'
import { getWorld } from '../../map/world'
import { buildTerritoryMesh } from '../../map/territoryMesh'
import { UPGRADE_SPECS } from '../../data/development'
import { indexTerritories } from '../../data/territories'
import { TRAIN_SECONDS } from '../pace'
import { advance, applyImmediate } from '../realtime'
import { developmentBonus } from '../development'
import { resolveTurn } from '../resolveTurn'
import { territoryOwner } from '../territory'
import { lineMap, startState } from './fixtures'
import type { Territory, WorldMap } from '../types'

function borderMap(): WorldMap {
  const map = lineMap(2)
  const region = map.regions.r1
  const sites: Territory[] = [
    { id: 'r1:0', regionId: 'r1', name: 'Heart', lat: region.lat, lng: region.lng, index: 0 },
    { id: 'r1:1', regionId: 'r1', name: 'North', lat: region.lat + 3, lng: region.lng, index: 1 },
    { id: 'r1:2', regionId: 'r1', name: 'South', lat: region.lat - 3, lng: region.lng, index: 2 },
  ]
  const indexed = indexTerritories([...Object.values(map.territories).filter((t) => t.regionId !== 'r1'), ...sites])
  return { ...map, ...indexed }
}

describe('territory map', () => {
  it('gives every territory a shape on the globe', () => {
    const world = getWorld()
    const mesh = buildTerritoryMesh(world.features, world.map)
    const ids = new Set(mesh.map((feature) => feature.properties.territoryId))
    const pieces = mesh.reduce((sum, feature) => sum + (feature.geometry.type === 'Polygon' ? 1 : feature.geometry.coordinates.length), 0)
    expect(ids.size).toBe(Object.keys(world.map.territories).length)
    expect(mesh.every((feature) => feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')).toBe(true)
    expect(pieces).toBeLessThan(2000)
  })

  it('keeps every district inside its country and off the far side of the globe', () => {
    const world = getWorld()
    const mesh = buildTerritoryMesh(world.features, world.map)
    const parent = new Map(world.features.map((feature) => [feature.properties.regionId, feature]))
    let outside = 0
    for (const territory of Object.values(world.map.territories)) {
      const feature = parent.get(territory.regionId)
      if (!feature || !geoContains(feature, [territory.lng, territory.lat])) outside++
    }
    expect(outside).toBe(0)
    for (const feature of mesh) {
      const source = parent.get(feature.properties.regionId)
      expect(source).toBeTruthy()
      expect(geoArea(feature)).toBeLessThanOrEqual(geoArea(source!) * 1.35 + 0.02)
    }
    expect(new Set(mesh.map((feature) => feature.properties.territoryId)).size).toBe(Object.keys(world.map.territories).length)
  })
})

describe('territory capture', () => {
  it('takes one border territory, keeps damaged upgrades, and pays the conqueror', () => {
    const map = borderMap()
    const s = startState(map)
    s.wars = ['r0|r1']
    s.militaryElapsed = 100
    const army = Object.values(s.armies).find((a) => a.owner === 'r0')!
    army.units = { infantry: 40, armor: 12, air: 6, naval: 0 }
    for (const a of Object.values(s.armies)) if (a.owner === 'r1') a.units = { infantry: 1, armor: 0, air: 0, naval: 0 }
    s.territoryDev['r1:0'] = { housing: 0, works: 2, granary: 1, roads: 0, civic: 0 }

    const next = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1', territoryId: 'r1:0' }])

    expect(territoryOwner(next, map, 'r1:0')).toBe('r0')
    expect(territoryOwner(next, map, 'r1:1')).toBe('r1')
    expect(next.regions.r1.owner).toBe('r1')
    expect(next.nations.r1.alive).toBe(true)
    expect(next.armies[army.id].location).toBe('r0')
    expect(next.battles[0].captured).toBe(true)
    expect(next.battles[0].territoryId).toBe('r1:0')
    expect(next.territoryDev['r1:0'].works).toBe(1)
    expect(next.territoryDev['r1:0'].granary).toBe(0)
    expect(developmentBonus(next, map, 'r0').capital).toBeCloseTo(UPGRADE_SPECS.works.capital)
    expect(developmentBonus(next, map, 'r1').capital).toBe(0)
    expect(next.log.some((entry) => entry.kind === 'war' && entry.text.includes('Heart'))).toBe(true)
  })

  it('eliminates a country only after its last territory falls', () => {
    const map = borderMap()
    let s = startState(map)
    s.wars = ['r0|r1']
    const army = Object.values(s.armies).find((a) => a.owner === 'r0')!
    army.units = { infantry: 40, armor: 12, air: 6, naval: 0 }
    for (const a of Object.values(s.armies)) if (a.owner === 'r1') a.units = { infantry: 0.2, armor: 0, air: 0, naval: 0 }

    s = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1' }])
    expect(s.nations.r1.alive).toBe(true)
    expect(s.regions.r1.owner).toBe('r1')

    s = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1' }])
    expect(s.nations.r1.alive).toBe(true)

    s = resolveTurn(s, map, [{ type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1' }])
    expect(s.regions.r1.owner).toBe('r0')
    expect(s.nations.r1.alive).toBe(false)
    expect(s.armies[army.id].location).toBe('r1')
  })
})

describe('real-time clock', () => {
  it('finishes infantry in ten seconds and armor in thirty', () => {
    const map = lineMap(1)
    const s = startState(map)
    s.militaryElapsed = 100
    s.nations.r0.resources.capital = 800
    s.nations.r0.militaryPool = 80
    const army = Object.values(s.armies).find((a) => a.owner === 'r0')!
    const infantry = army.units.infantry
    const started = applyImmediate(s, map, { type: 'queueTrain', nationId: 'r0', territoryId: 'r0:0', unit: 'infantry' })
    expect(started.error).toBeNull()
    expect(started.state.trainingQueue[0].remaining).toBe(TRAIN_SECONDS.infantry)
    expect(started.state.trainingQueue[0].clock).toBe('time')
    const early = advance(started.state, map, 9, [])
    expect(early.state.armies[army.id].units.infantry).toBe(infantry)
    const done = advance(early.state, map, 1.2, [])
    expect(done.state.trainingQueue).toHaveLength(0)
    expect(done.state.armies[army.id].units.infantry).toBe(infantry + 1)
    expect(done.notices.some((n) => n.type === 'trained' && n.pause === false)).toBe(true)

    const tanks = applyImmediate(done.state, map, { type: 'queueTrain', nationId: 'r0', territoryId: 'r0:0', unit: 'armor' })
    expect(tanks.state.trainingQueue[0].total).toBe(30)
    const midway = advance(tanks.state, map, 15, [])
    expect(midway.state.trainingQueue[0].remaining).toBeCloseTo(15, 0)
    expect(midway.state.armies[army.id].units.armor).toBe(army.units.armor)
  })

  it('marches an army onto a border territory and captures it on arrival', () => {
    const map = borderMap()
    const s = startState(map)
    s.wars = ['r0|r1']
    s.militaryElapsed = 100
    s.monthElapsed = 0
    const army = Object.values(s.armies).find((a) => a.owner === 'r0')!
    army.units = { infantry: 40, armor: 12, air: 6, naval: 0 }
    for (const a of Object.values(s.armies)) if (a.owner === 'r1') a.units = { infantry: 1, armor: 0, air: 0, naval: 0 }
    const ordered = applyImmediate(s, map, { type: 'attack', nationId: 'r0', armyId: army.id, target: 'r1', territoryId: 'r1:0' })
    expect(ordered.error).toBeNull()
    const march = ordered.state.armies[army.id].march
    expect(march?.kind).toBe('attack')
    expect(march?.territoryId).toBe('r1:0')
    const arrived = advance(ordered.state, map, (march?.duration ?? 1) + 0.2, [])
    expect(arrived.state.armies[army.id].march).toBeNull()
    expect(territoryOwner(arrived.state, map, 'r1:0')).toBe('r0')
    expect(arrived.state.regions.r1.owner).toBe('r1')
    expect(arrived.notices.some((n) => n.type === 'capture' && n.territoryId === 'r1:0' && n.pause === false)).toBe(true)
  })
})
