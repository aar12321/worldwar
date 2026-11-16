import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { nextSort, viewRows, visibleCount, type FilterSpec, type SortDir, type SortSpec } from './listUtils'
import { EmptyState } from './widgets'

/**
 * A list that stays usable at any length: a search box, filters, a sort, a count that says how many are shown, and rows drawn a page
 * at a time (more arrive as you scroll or press "Show more"), so 175 countries cost no more to open than 40.
 * Arrow keys move between rows; mark a row's main control with `data-row-primary`.
 */
export function DataList<T>({
  rows,
  rowKey,
  renderRow,
  searchText,
  searchLabel = 'Search',
  noun = ['row', 'rows'],
  sorts,
  filters,
  initialSort,
  initialFilter,
  pageSize = 40,
  minForToolbar = 7,
  empty,
  rowClass = '',
  label,
}: {
  rows: readonly T[]
  rowKey: (row: T) => string
  renderRow: (row: T) => ReactNode
  searchText: (row: T) => string
  searchLabel?: string
  noun?: [string, string]
  sorts?: SortSpec<T>[]
  filters?: FilterSpec<T>[]
  initialSort?: string
  initialFilter?: string
  pageSize?: number
  /** Below this many rows the search, filter and sort controls stay out of the way. */
  minForToolbar?: number
  empty?: ReactNode
  rowClass?: string
  label: string
}) {
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [filterId, setFilterId] = useState(initialFilter ?? filters?.[0]?.id ?? '')
  const [sort, setSort] = useState<{ id: string; dir: SortDir }>(() => {
    const s = sorts?.find((x) => x.id === initialSort) ?? sorts?.[0]
    return { id: s?.id ?? '', dir: s?.dir ?? 'asc' }
  })
  // How many pages are drawn. It starts again at one whenever the search, filter or sort changes, without an effect to do it.
  const resetKey = `${deferred}|${filterId}|${sort.id}|${sort.dir}`
  const [pageState, setPageState] = useState({ key: resetKey, pages: 1 })
  const pages = pageState.key === resetKey ? pageState.pages : 1
  const setPages = (fn: (p: number) => number) => setPageState({ key: resetKey, pages: fn(pages) })
  const sentinel = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const filter = filters?.find((f) => f.id === filterId) ?? null
  const sortSpec = sorts?.find((s) => s.id === sort.id) ?? null

  const shown = useMemo(() => viewRows(rows, { query: deferred, text: searchText, filter, sort: sortSpec, dir: sort.dir }), [rows, deferred, searchText, filter, sortSpec, sort.dir])
  const count = visibleCount(shown.length, pages, pageSize)
  const more = shown.length - count

  // Scrolling near the end draws the next page.
  useEffect(() => {
    const el = sentinel.current
    if (!el || more <= 0 || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setPageState((s) => ({ key: resetKey, pages: (s.key === resetKey ? s.pages : 1) + 1 })), { root: el.closest('[data-panel-body]'), rootMargin: '240px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, count, resetKey])

  const toolbar = rows.length >= minForToolbar || query !== '' || filterId !== (filters?.[0]?.id ?? '')
  const chips = filters && filters.length > 1 && filters.length <= 5
  const arrows = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const target = e.target as HTMLElement
    if (!target.matches('[data-row-primary]')) return
    const li = target.closest('li')
    const next = e.key === 'ArrowDown' ? li?.nextElementSibling : li?.previousElementSibling
    const go = next?.querySelector<HTMLElement>('[data-row-primary]')
    if (go) {
      e.preventDefault()
      go.focus()
    }
  }

  return (
    <div className="space-y-2.5">
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2" role="search" aria-label={label}>
          <input
            type="search"
            className="field px-3 py-1.5 text-[14px] flex-1 min-w-36"
            placeholder={searchLabel}
            aria-label={searchLabel}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                list.current?.querySelector<HTMLElement>('[data-row-primary]')?.focus()
              } else if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setQuery('')
              }
            }}
          />
          {filters && filters.length > 1 && !chips && (
            <select className="field px-2 py-1.5 text-[14px]" aria-label="Show" value={filterId} onChange={(e) => setFilterId(e.target.value)}>
              {filters.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
          {sorts && sorts.length > 1 && (
            <span className="inline-flex items-center gap-1">
              <select className="field px-2 py-1.5 text-[14px]" aria-label="Sort by" value={sort.id} onChange={(e) => setSort({ id: e.target.value, dir: sorts.find((s) => s.id === e.target.value)?.dir ?? 'asc' })}>
                {sorts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-quiet" aria-label={sort.dir === 'asc' ? 'Sorted ascending. Press to reverse.' : 'Sorted descending. Press to reverse.'} title="Reverse the order" onClick={() => setSort((s) => nextSort(s, s.id, s.dir))}>
                {sort.dir === 'asc' ? '↑' : '↓'}
              </button>
            </span>
          )}
        </div>
      )}
      {toolbar && chips && (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Show">
          {filters.map((f) => (
            <button key={f.id} role="radio" aria-checked={filterId === f.id} className={`btn px-2.5 py-1.5 text-[13px] ${filterId === f.id ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setFilterId(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="text-[12px] text-white/65" aria-live="polite">
        {shown.length === rows.length ? `${rows.length} ${rows.length === 1 ? noun[0] : noun[1]}` : `${shown.length} of ${rows.length} ${noun[1]}`}
        {more > 0 ? `, showing the first ${count}` : ''}
      </div>
      {shown.length === 0 ? (
        (empty ?? (
          <EmptyState
            compact
            title={`No ${noun[0]} matches`}
            body="Try a different word, or clear the filter."
            action={
              <button
                className="btn"
                onClick={() => {
                  setQuery('')
                  setFilterId(filters?.[0]?.id ?? '')
                }}
              >
                Clear search and filter
              </button>
            }
          />
        ))
      ) : (
        <ul ref={list} className="space-y-1.5" aria-label={label} onKeyDown={arrows}>
          {shown.slice(0, count).map((row) => (
            <li key={rowKey(row)} className={rowClass}>
              {renderRow(row)}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <div ref={sentinel} className="flex justify-center py-1">
          <button className="btn" onClick={() => setPages((p) => p + 1)}>
            Show {Math.min(pageSize, more)} more ({more} left)
          </button>
        </div>
      )}
    </div>
  )
}
