import { describe, expect, it } from 'vitest'
import { getWorld } from '../map/world'
import { nearLabel } from './globe/labels'

describe('city chips and the country name', () => {
  it('cities right by the country name are dots, cities far from it keep their name', () => {
    const de = getWorld().map.regions.germany
    // Hamburg and Munich hid "Germany" at the default zoom (docs/DEMO_CHECK.md).
    expect(nearLabel(53.6, 10, de.lat, de.lng)).toBe(true)
    expect(nearLabel(48.1, 11.6, de.lat, de.lng)).toBe(true)
    const ru = getWorld().map.regions.russia
    // Vladivostok is a continent away from the name "Russia".
    expect(nearLabel(43.1, 131.9, ru.lat, ru.lng)).toBe(false)
    // Across the date line the distance is the short way round.
    expect(nearLabel(0, 179, 0, -179)).toBe(true)
  })
})
