import { describe, expect, it } from 'vitest'
import { techBonuses } from '../techBonuses'

const find = (groups: ReturnType<typeof techBonuses>, title: string, label: string) => groups.find((g) => g.title === title)?.lines.find((l) => l.label.startsWith(label))

describe('what technology gives you, in words', () => {
  it('is empty with no technology', () => {
    expect(techBonuses({ techs: [] })).toEqual([])
  })

  it('lists frontier milestones: economy, agencies, abilities and where each came from', () => {
    const groups = techBonuses({ techs: ['frontier_drones', 'cyber_warfare', 'frontier_ai', 'frontier_nano', 'frontier_quantum', 'frontier_robotics'] })
    expect(find(groups, 'Your economy', 'Research')?.value).toBe('+30%')
    expect(find(groups, 'Your economy', 'Research')?.from).toEqual(expect.arrayContaining(['Artificial Intelligence', 'Quantum Computing']))
    expect(find(groups, 'Your economy', 'Business growth')?.value).toBe('+15%')
    expect(find(groups, 'Your economy', 'Stability')?.value).toBe('+4')
    expect(find(groups, 'Your economy', 'Food')?.value).toBe('+30%')
    expect(find(groups, 'Your agencies', 'Odds')?.value).toBe('+5%')
    expect(find(groups, 'New abilities', 'Cyber attack operation')).toBeTruthy()
    // Abilities are the systems and operations a technology really unlocks.
    expect(find(groups, 'New abilities', 'Cyber Command')).toBeTruthy()
    expect(find(groups, 'New abilities', 'AI Battle Command')).toBeTruthy()
    expect(find(groups, 'New abilities', 'Nano-armor')).toBeTruthy()
  })

  it('adds up combat bonuses per unit and names the sources', () => {
    const groups = techBonuses({ techs: ['land_rifles', 'land_light_tanks', 'land_mechanized', 'frontier_drones', 'frontier_missile_defense'] })
    const tanks = find(groups, 'In battle', 'Tanks')
    expect(tanks?.value).toContain('attack +15%')
    expect(tanks?.from).toEqual(expect.arrayContaining(['Mechanized Brigades', 'Combat Drones']))
    expect(find(groups, 'Units unlocked', 'Infantry')).toBeTruthy()
  })
})
