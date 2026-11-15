import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A short explanation on a word or number. It opens on hover, on keyboard focus and on a tap, closes on Escape or a tap elsewhere,
 * so it works on a phone where there is no hover.
 */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-expanded={open} className="cursor-help underline decoration-dotted underline-offset-2 decoration-white/30" onClick={() => setOpen((v) => !v)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
        {children}
      </button>
      {open && (
        <span role="tooltip" className="tip-bubble open">
          {text}
        </span>
      )}
    </span>
  )
}

export function Pips({ value, max }: { value: number; max: number }) {
  return (
    <span className="inline-flex gap-1" aria-label={`${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`w-2 h-2 rounded-full transition-colors duration-300 ${i < value ? 'bg-[#30d158]' : 'bg-white/15'}`} />
      ))}
    </span>
  )
}
