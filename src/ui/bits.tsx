import type { ReactNode } from 'react'

export function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex group/tip">
      {children}
      <span role="tooltip" className="tip-bubble">
        {text}
      </span>
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

export function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="inset-card py-2 px-1 text-center">
      <div className="label">{label}</div>
      <div className={`text-[14px] font-semibold tabular-nums ${warn ? 'text-[#ff6961]' : ''}`}>{value}</div>
    </div>
  )
}
