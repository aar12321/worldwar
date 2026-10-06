export interface Rng {
  next(): number
  range(min: number, max: number): number
  int(min: number, maxInclusive: number): number
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return h >>> 0
}

export function createRng(seed: number, stream = 0): Rng {
  let s = hash(seed, stream)
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
  }
}
