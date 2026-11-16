import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'

export const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Keeps keyboard focus inside a dialog: moves in when it opens (to `[data-autofocus]` or the first control), wraps Tab and
 * Shift+Tab at the ends, closes on Escape, and gives focus back to whatever had it before when it closes.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose?: () => void) {
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
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
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
    return () => {
      node.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [ref])
}

/** Whether a CSS media query matches, kept up to date. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', notify)
      return () => mq.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** The window width, updated on resize (used to decide how many desks the phone bar can hold). */
export function useWidth(): number {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener('resize', notify)
      return () => window.removeEventListener('resize', notify)
    },
    () => window.innerWidth,
    () => 1200,
  )
}
