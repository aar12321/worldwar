import type { ReactNode } from 'react'
import type { UnitType } from '../engine/types'

function Frame({ size = 20, children, title }: { size?: number; children: ReactNode; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {children}
    </svg>
  )
}

const UNIT_GLYPH: Record<UnitType, ReactNode> = {
  // A small quadcopter.
  drone: (
    <>
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.5" />
      <path d="M9.5 9.5L5.5 5.5M14.5 9.5l4-4M9.5 14.5l-4 4M14.5 14.5l4 4" />
      <circle cx="4.5" cy="4.5" r="2" />
      <circle cx="19.5" cy="4.5" r="2" />
      <circle cx="4.5" cy="19.5" r="2" />
      <circle cx="19.5" cy="19.5" r="2" />
    </>
  ),
  // A robot with a visor.
  robot: (
    <>
      <rect x="6" y="7" width="12" height="10" rx="2.5" />
      <path d="M12 7V4M10 4h4" />
      <path d="M9 11.5h6" />
      <path d="M9.5 20v-3M14.5 20v-3" />
      <path d="M3.5 10.5V14M20.5 10.5V14" />
    </>
  ),
  // A missile with a flame.
  missile: (
    <>
      <path d="M17.5 3.5c-4.5.4-8 3.6-9.6 8l4.1 4.1c4.4-1.6 7.6-5.1 8-9.6z" />
      <circle cx="14.6" cy="9.4" r="1.2" />
      <path d="M7.9 11.6L5 11l-1.5 3.5 4 .6M12.4 16.1l.6 2.9L9.5 20.5l-.6-4" />
    </>
  ),
  // A helmet.
  infantry: (
    <>
      <path d="M4.5 15a7.5 7.5 0 0 1 15 0" />
      <path d="M3 15h18v1.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5z" />
      <path d="M12 7.5v3" />
    </>
  ),
  // A tank seen from the side.
  armor: (
    <>
      <rect x="2.5" y="13.5" width="19" height="5" rx="2.5" />
      <path d="M6.5 13.5v-2.2a1.3 1.3 0 0 1 1.3-1.3h5.4a1.3 1.3 0 0 1 1.3 1.3v2.2" />
      <path d="M14.5 11.5H21" />
      <path d="M7 16h.01M12 16h.01M17 16h.01" />
    </>
  ),
  // A field gun.
  artillery: (
    <>
      <path d="M3 15.5h4.5" />
      <path d="M6.5 13.2l10.8-4.4 1.2 3-10.8 4.4z" />
      <circle cx="10" cy="17.5" r="3" />
      <path d="M17.8 9.2l3.2-1.3" />
    </>
  ),
  // A small fast jet.
  fighter: (
    <>
      <path d="M12 2.5c.7 0 1.1 1.2 1.1 2.8v4.1l5.9 3.6v1.6l-5.9-1.6v3.5l1.7 1.3v1.2L12 17.8l-2.8.8v-1.2l1.7-1.3v-3.5L5 14.6V13l5.9-3.6V5.3c0-1.6.4-2.8 1.1-2.8z" />
    </>
  ),
  // A heavy bomber seen from above.
  air: (
    <>
      <path d="M12 2.5c.9 0 1.5 1 1.5 2.4V9l7.5 4.2v1.9l-7.5-2.2v4.3l2.3 1.7v1.4L12 19.4l-3.8.9v-1.4l2.3-1.7v-4.3L3 15.1v-1.9L10.5 9V4.9c0-1.4.6-2.4 1.5-2.4z" />
    </>
  ),
  // A warship seen from the side.
  naval: (
    <>
      <path d="M2.5 14.5h19l-2.6 4.5H5.1z" />
      <path d="M8 14.5v-3.5h6v3.5" />
      <path d="M11 11V6.5" />
      <path d="M11 7.5h3" />
      <path d="M14 12.8h4.5" />
    </>
  ),
}

export function UnitIcon({ unit, size = 18, title }: { unit: UnitType; size?: number; title?: string }) {
  return (
    <Frame size={size} title={title}>
      {UNIT_GLYPH[unit]}
    </Frame>
  )
}

export function BriefingIcon() {
  return (
    <Frame>
      <path d="M12 3l2.3 5 5.4.6-4 3.7 1.1 5.4L12 15l-4.8 2.7 1.1-5.4-4-3.7 5.4-.6z" />
    </Frame>
  )
}

export function EconomyIcon() {
  return (
    <Frame>
      <path d="M4 20h16" />
      <path d="M6 20V10l4 3V10l4 3V6h4v14" />
    </Frame>
  )
}

export function MilitaryIcon() {
  return (
    <Frame>
      <path d="M12 3l7 3v6c0 4.2-2.8 6.8-7 8-4.2-1.2-7-3.8-7-8V6l7-3z" />
      <path d="M9 12h6" />
    </Frame>
  )
}

export function DiplomacyIcon() {
  return (
    <Frame>
      <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M2.5 19c.6-3 2.7-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
      <path d="M13.5 15.2c.8-.5 1.6-.7 2.5-.7 2.8 0 4.9 1.5 5.5 4.5" />
    </Frame>
  )
}

export function ResearchIcon() {
  return (
    <Frame>
      <path d="M9 3h6" />
      <path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </Frame>
  )
}

export function NewsIcon() {
  return (
    <Frame size={18}>
      <path d="M5 4h11v16H7a2 2 0 0 1-2-2z" />
      <path d="M16 8h3v10a2 2 0 0 1-2 2" />
      <path d="M8 8h5M8 12h5M8 16h3" />
    </Frame>
  )
}

export function SettingsIcon() {
  return (
    <Frame size={18}>
      <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="17" r="2" />
    </Frame>
  )
}

export function HelpIcon() {
  return (
    <Frame size={18}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7" />
      <path d="M12 17h.01" />
    </Frame>
  )
}
