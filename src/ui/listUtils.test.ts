import { describe, expect, it } from 'vitest'
import { nextSort, searchRows, sortRows, viewRows, visibleCount } from './listUtils'

const rows = [
  { name: 'Brazil', pop: 215, rebels: 0 },
  { name: 'Argentina', pop: 46, rebels: 2 },
  { name: 'chile', pop: 19, rebels: 0 },
  { name: 'Peru 10', pop: 33, rebels: 1 },
  { name: 'Peru 2', pop: 33, rebels: 0 },
]

describe('searchRows', () => {
  it('keeps rows that contain every word, ignoring case and accents', () => {
    expect(searchRows(rows, 'ARG', (r) => r.name).map((r) => r.name)).toEqual(['Argentina'])
    expect(searchRows(rows, 'peru 2', (r) => r.name).map((r) => r.name)).toEqual(['Peru 2'])
  })

  it('returns everything for an empty query, as a copy', () => {
    const out = searchRows(rows, '  ', (r) => r.name)
    expect(out).toEqual(rows)
    expect(out).not.toBe(rows)
  })
})

describe('sortRows', () => {
  it('sorts numbers by value and does not touch the input', () => {
    const copy = [...rows]
    expect(sortRows(rows, (r) => r.pop, 'desc').map((r) => r.name)).toEqual(['Brazil', 'Argentina', 'Peru 10', 'Peru 2', 'chile'])
    expect(rows).toEqual(copy)
  })

  it('sorts names the way people read them: no case split, numbers in order', () => {
    expect(sortRows(rows, (r) => r.name, 'asc').map((r) => r.name)).toEqual(['Argentina', 'Brazil', 'chile', 'Peru 2', 'Peru 10'])
  })

  it('keeps the input order for ties, in both directions', () => {
    expect(sortRows(rows, (r) => r.pop, 'asc').map((r) => r.name).slice(1, 3)).toEqual(['Peru 10', 'Peru 2'])
    expect(sortRows(rows, (r) => r.pop, 'desc').map((r) => r.name).slice(2, 4)).toEqual(['Peru 10', 'Peru 2'])
  })
})

describe('viewRows', () => {
  it('searches, filters and sorts together', () => {
    const out = viewRows(rows, { query: 'e', text: (r) => r.name, filter: { id: 'r', label: 'Rebels', test: (r) => r.rebels > 0 }, sort: { id: 'p', label: 'Pop', value: (r) => r.pop, dir: 'desc' } })
    expect(out.map((r) => r.name)).toEqual(['Argentina', 'Peru 10'])
  })

  it('uses the sort direction it is given over the sort own default', () => {
    const sort = { id: 'p', label: 'Pop', value: (r: (typeof rows)[number]) => r.pop, dir: 'desc' as const }
    expect(viewRows(rows, { query: '', text: (r) => r.name, sort, dir: 'asc' })[0].name).toBe('chile')
  })
})

describe('visibleCount and nextSort', () => {
  it('draws one page at a time and never more than there are', () => {
    expect(visibleCount(175, 1, 40)).toBe(40)
    expect(visibleCount(175, 3, 40)).toBe(120)
    expect(visibleCount(175, 9, 40)).toBe(175)
    expect(visibleCount(0, 1, 40)).toBe(0)
    expect(visibleCount(10, 0, 40)).toBe(10)
  })

  it('starts a new sort in its natural direction and flips on the second click', () => {
    expect(nextSort({ id: 'name', dir: 'asc' }, 'pop', 'desc')).toEqual({ id: 'pop', dir: 'desc' })
    expect(nextSort({ id: 'pop', dir: 'desc' }, 'pop', 'desc')).toEqual({ id: 'pop', dir: 'asc' })
  })
})
