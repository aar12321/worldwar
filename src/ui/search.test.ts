import { describe, expect, it } from 'vitest'
import { normalize, rank, scoreMatch } from './search'

describe('normalize', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalize("Côte d'Ivoire")).toBe('cote d ivoire')
    expect(normalize('  Bank:  rates, printing ')).toBe('bank rates printing')
  })
})

describe('scoreMatch', () => {
  it('matches every typed word, in any order', () => {
    expect(scoreMatch('bank economy', 'Economy: Bank, rates and bonds')).not.toBeNull()
    expect(scoreMatch('bank zebra', 'Economy: Bank, rates and bonds')).toBeNull()
  })

  it('ranks names that start with the text above names that only contain it', () => {
    const start = scoreMatch('ban', 'Bank')!
    const inside = scoreMatch('ban', 'Urban')!
    expect(start).toBeGreaterThan(inside)
  })

  it('finds a word in the keywords, a little below one in the name', () => {
    const named = scoreMatch('tax', 'Tax office')!
    const keyword = scoreMatch('tax', 'Budget', 'tax income draft')!
    expect(keyword).not.toBeNull()
    expect(named).toBeGreaterThan(keyword)
  })

  it('forgives skipped letters for longer words', () => {
    expect(scoreMatch('econmy', 'Economy')).not.toBeNull()
    expect(scoreMatch('xq', 'Economy')).toBeNull()
  })

  it('treats an empty query as everything', () => {
    expect(scoreMatch('   ', 'Anything')).toBe(0)
  })
})

describe('rank', () => {
  const items = [
    { label: 'Germany', keywords: 'europe' },
    { label: 'Georgia', keywords: 'caucasus' },
    { label: 'Ghana', keywords: 'africa' },
    { label: 'Diplomacy with Germany', keywords: '' },
  ]
  const text = (i: { label: string; keywords: string }) => i

  it('returns the best matches first, with loose matches last, and drops the rest', () => {
    expect(rank(items, 'ger', text).map((i) => i.label)).toEqual(['Germany', 'Diplomacy with Germany', 'Georgia'])
    expect(rank(items, 'ghana', text).map((i) => i.label)).toEqual(['Ghana'])
  })

  it('keeps the original order with no query, and respects the limit', () => {
    expect(rank(items, '', text, 2).map((i) => i.label)).toEqual(['Germany', 'Georgia'])
  })

  it('searches keywords too', () => {
    expect(rank(items, 'africa', text).map((i) => i.label)).toEqual(['Ghana'])
  })

  it('breaks ties by the original order', () => {
    const tie = [{ label: 'Alpha one' }, { label: 'Alpha two' }]
    expect(rank(tie, 'alpha', (i) => i).map((i) => i.label)).toEqual(['Alpha one', 'Alpha two'])
  })
})
