import type { ReactNode } from 'react'
import { BriefingIcon, DiplomacyIcon, EconomyIcon, EmpireIcon, FactionIcon, Frame, MilitaryIcon, NewsIcon, ResearchIcon, SettingsIcon } from './icons'

/** Small glyphs for the navigation chrome and for desks that have no icon of their own yet. */
export function RelationsIcon({ size = 20 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </Frame>
  )
}
export function SearchIcon({ size = 18 }: { size?: number }) {
  return (
    <Frame size={size}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </Frame>
  )
}
export function BackIcon({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M14.5 6L8.5 12l6 6" />
    </Frame>
  )
}
export function ChevronIcon({ size = 14, dir = 'right' }: { size?: number; dir?: 'left' | 'right' | 'up' | 'down' }) {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[dir]
  return (
    <Frame size={size}>
      <g transform={`rotate(${rot} 12 12)`}>
        <path d="M9 5.5l6.5 6.5L9 18.5" />
      </g>
    </Frame>
  )
}
export function PinIcon({ size = 16, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.2l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.5l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
    </svg>
  )
}
export function MoreIcon({ size = 20 }: { size?: number }) {
  return (
    <Frame size={size}>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </Frame>
  )
}
export function GridIcon({ size = 20 }: { size?: number }) {
  return (
    <Frame size={size}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </Frame>
  )
}
export function KeyboardIcon({ size = 18 }: { size?: number }) {
  return (
    <Frame size={size}>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
    </Frame>
  )
}
export function FlagIcon() {
  return (
    <Frame>
      <path d="M6 21V4" />
      <path d="M6 5h11l-2 3.5 2 3.5H6" />
    </Frame>
  )
}
export function RocketIcon() {
  return (
    <Frame>
      <path d="M12 3c3.2 2 5 5.2 5 9l-2 3H9l-2-3c0-3.800 1.800-7 5-9z" />
      <circle cx="12" cy="10" r="1.5" />
      <path d="M9 15l-2.5 3.500M15 15l2.500 3.500M12 17v3" />
    </Frame>
  )
}
export function PlaneIcon() {
  return (
    <Frame>
      <path d="M12 3v18M12 8l8 5v2l-8-2-8 2v-2z" />
    </Frame>
  )
}
export function MapIcon() {
  return (
    <Frame>
      <path d="M3.5 6.5l5-2 7 2 5-2v13l-5 2-7-2-5 2z" />
      <path d="M8.500 4.500v13M15.500 6.500v13" />
    </Frame>
  )
}
export function GenericDeskIcon() {
  return (
    <Frame>
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="M4 10h16" />
    </Frame>
  )
}

const ICONS: Record<string, () => ReactNode> = {
  briefing: () => <BriefingIcon />,
  economy: () => <EconomyIcon />,
  military: () => <MilitaryIcon />,
  diplomacy: () => <DiplomacyIcon />,
  empire: () => <EmpireIcon />,
  research: () => <ResearchIcon />,
  news: () => <NewsIcon />,
  settings: () => <SettingsIcon />,
  flag: () => <FlagIcon />,
  faction: () => <FactionIcon />,
  relations: () => <RelationsIcon />,
  space: () => <RocketIcon />,
  aircraft: () => <PlaneIcon />,
  map: () => <MapIcon />,
}

/** The icon a desk names, or a plain card when it names one that does not exist. */
export function DeskIcon({ id }: { id: string }) {
  return <>{(ICONS[id] ?? (() => <GenericDeskIcon />))()}</>
}
