import { geoCentroid, geoContains } from 'd3-geo'
import { describe, expect, it } from 'vitest'
import { countryFeatures, locateCountry, locateTerritory } from '../landIndex'
import { getWorld } from '../world'

describe('land index', () => {
  const { map } = getWorld()

  it('finds a country from its own interior, including a longitude shifted by a full turn', () => {
    const feature = countryFeatures.find((shape) => map.regions[shape.properties.regionId]?.name === 'United States of America')
    expect(feature).toBeTruthy()
    const [lng, lat] = geoCentroid(feature!)
    expect(geoContains(feature!, [lng, lat])).toBe(true)
    expect(locateCountry(lng, lat)?.properties.regionId).toBe(feature!.properties.regionId)
    expect(locateCountry(lng + 360, lat)?.properties.regionId).toBe(feature!.properties.regionId)
  })

  it('finds the territory under that same point and ignores open ocean', () => {
    const feature = countryFeatures.find((shape) => map.regions[shape.properties.regionId]?.name === 'United States of America')!
    const [lng, lat] = geoCentroid(feature)
    const territory = locateTerritory(lng, lat)
    expect(territory && 'territoryId' in territory.properties ? territory.properties.regionId : null).toBe(feature.properties.regionId)
    expect(locateCountry(0, -45)).toBeNull()
    expect(locateTerritory(0, -45)).toBeNull()
  })
})