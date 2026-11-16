import { normalize } from './search'

/** Pure helpers behind `DataList`: filter, search, sort and page a list of rows. */

export type SortDir = 'asc' | 'desc'

export interface SortSpec<T> {
  id: string
  label: string
  value: (row: T) => string | number
  /** The direction people expect first: names A to Z, but sizes biggest first. */
  dir?: SortDir
}

export interface FilterSpec<T> {
  id: string
  label: string
  test: (row: T) => boolean
}

/** Rows that contain every word the person typed, in the text the list says to search. */
export function searchRows<T>(rows: readonly T[], query: string, text: (row: T) => string): T[] {
  const words = normalize(query).split(' ').filter(Boolean)
  if (words.length === 0) return rows.slice()
  return rows.filter((r) => {
    const hay = normalize(text(r))
    return words.every((w) => hay.includes(w))
  })
}

/** Sorts a copy of the rows. Strings sort the way a person expects ("a" before "B", numbers inside names in order); ties keep their input order. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => string | number, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return rows
    .map((row, at) => ({ row, at, v: value(row) }))
    .sort((a, b) => {
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v))
      return c * sign || a.at - b.at
    })
    .map((x) => x.row)
}

/** What a list shows for a search, a filter and a sort. */
export function viewRows<T>(rows: readonly T[], opts: { query: string; text: (row: T) => string; filter?: FilterSpec<T> | null; sort?: SortSpec<T> | null; dir?: SortDir }): T[] {
  let out = searchRows(rows, opts.query, opts.text)
  if (opts.filter) out = out.filter(opts.filter.test)
  if (opts.sort) out = sortRows(out, opts.sort.value, opts.dir ?? opts.sort.dir ?? 'asc')
  return out
}

/** How many rows to draw now: one page, more as the person scrolls, never more than there are. */
export const visibleCount = (total: number, pages: number, pageSize: number): number => Math.min(total, Math.max(1, pages) * pageSize)

/** Clicking a sort header: the first click uses its natural direction, the second flips it. */
export function nextSort(current: { id: string; dir: SortDir }, clicked: string, natural: SortDir): { id: string; dir: SortDir } {
  if (current.id !== clicked) return { id: clicked, dir: natural }
  return { id: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}
