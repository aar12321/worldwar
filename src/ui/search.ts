/** Small, forgiving text search for the jump window and the long lists. Pure, so it is easy to test. */

/** Lower case, accents removed, extra spaces gone: "Côte d'Ivoire" and "cote d ivoire" meet in the middle. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Whether every letter of `needle` appears in `hay` in order ("ecbk" is in "economy bank"). */
function subsequence(needle: string, hay: string): boolean {
  let i = 0
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++
  return i === needle.length
}

/** How well one typed word matches a text. 0 means it does not. */
function wordScore(word: string, tokens: string[], whole: string): number {
  let best = 0
  for (const t of tokens) {
    if (t === word) best = Math.max(best, 100)
    else if (t.startsWith(word)) best = Math.max(best, 80)
    else if (t.includes(word)) best = Math.max(best, 45)
  }
  if (best === 0 && word.length >= 3 && subsequence(word, whole)) best = 15
  return best
}

/**
 * A score for a query against a label (and its extra keywords): higher is better, `null` is no match.
 * Every typed word has to match something; names that start with what was typed rank first, then shorter names.
 */
export function scoreMatch(query: string, label: string, keywords = ''): number | null {
  const q = normalize(query)
  if (!q) return 0
  const words = q.split(' ')
  const nl = normalize(label)
  const tokens = nl.split(' ')
  const extra = normalize(keywords)
  const extraTokens = extra ? extra.split(' ') : []
  let total = 0
  for (const w of words) {
    const inLabel = wordScore(w, tokens, nl)
    // A match in the keywords counts, a bit less than one in the name.
    const inExtra = extraTokens.length ? Math.round(wordScore(w, extraTokens, extra) * 0.6) : 0
    const s = Math.max(inLabel, inExtra)
    if (s === 0) return null
    total += s
  }
  if (nl.startsWith(q)) total += 40
  else if (nl.includes(q)) total += 15
  return total - Math.min(30, nl.length * 0.4)
}

/** The items that match, best first. With an empty query every item comes back in its own order. */
export function rank<T>(items: readonly T[], query: string, text: (item: T) => { label: string; keywords?: string }, limit = Infinity): T[] {
  if (!normalize(query)) return items.slice(0, limit)
  const scored: { item: T; score: number; at: number }[] = []
  items.forEach((item, at) => {
    const t = text(item)
    const score = scoreMatch(query, t.label, t.keywords)
    if (score !== null) scored.push({ item, score, at })
  })
  scored.sort((a, b) => b.score - a.score || a.at - b.at)
  return scored.slice(0, limit).map((x) => x.item)
}
