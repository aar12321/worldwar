import { useEffect, useRef, type ReactNode } from 'react'

/** Open dialogs, oldest first. Escape closes only the top one, wherever focus is. */
const openModals: object[] = []

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * A centered dialog. The header and footer stay in view and only the body scrolls,
 * so nothing is ever cut off. Focus moves in, stays in, and returns when it closes.
 */
export function Modal({
  title,
  kicker,
  children,
  footer,
  onClose,
  wide = false,
  huge = false,
  tone,
}: {
  title: string
  kicker?: string
  children: ReactNode
  footer?: ReactNode
  /** Called on Escape. Leave out for a dialog that must be answered. */
  onClose?: () => void
  wide?: boolean
  /** Nearly the whole screen: for a big tree or table. */
  huge?: boolean
  tone?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const previous = document.activeElement as HTMLElement | null
    const first = node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeRef.current) {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
        if (!items.length) return
        const head = items[0]
        const tail = items[items.length - 1]
        if (e.shiftKey && document.activeElement === head) {
          e.preventDefault()
          tail.focus()
        } else if (!e.shiftKey && document.activeElement === tail) {
          e.preventDefault()
          head.focus()
        }
      }
    }
    node.addEventListener('keydown', onKey)
    // Focus can sit behind the dialog (a desk that opened after it took it), so Escape is also heard on the page.
    const token = {}
    openModals.push(token)
    const onPageKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || openModals[openModals.length - 1] !== token || !closeRef.current) return
      if (node.contains(e.target as Node)) return // the dialog's own handler has it
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onPageKey, true)
    return () => {
      node.removeEventListener('keydown', onKey)
      document.removeEventListener('keydown', onPageKey, true)
      const at = openModals.indexOf(token)
      if (at >= 0) openModals.splice(at, 1)
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="modal-backdrop" role="presentation">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal surface ${wide ? 'modal-wide' : ''} ${huge ? 'modal-huge' : ''}`}>
        <div className="modal-head flex items-start justify-between gap-4">
          <div>
            {kicker && (
              <div className="text-[13px] font-semibold" style={tone ? { color: tone } : undefined}>
                {kicker}
              </div>
            )}
            <h2 className="text-[26px] font-semibold tracking-tight leading-tight">{title}</h2>
          </div>
          {onClose && (
            <button className="icon-close shrink-0" aria-label="Close" onClick={onClose}>
              ×
            </button>
          )}
        </div>
        <div className="modal-body scroll-thin">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
