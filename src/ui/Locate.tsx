import { useGame } from '../store'

/**
 * Closes the open desk and shows a nation on the world map: its country is selected, the globe turns to it and a pulse ring marks it.
 * A toast offers the way back to the desk. Works the same on a phone.
 */
export function LocateButton({ id, label = 'Locate', compact = false, className = '' }: { id: string; label?: string; compact?: boolean; className?: string }) {
  const locate = useGame((s) => s.locateNation)
  const name = useGame((s) => s.game?.nations[id]?.name ?? id)
  return (
    <button
      type="button"
      className={`btn btn-quiet ${compact ? 'px-2 py-1 text-[12px]' : ''} ${className}`}
      title={`Close this desk and show ${name} on the map (Shift+L)`}
      aria-label={`Locate ${name} on the map`}
      data-locate={id}
      onClick={(e) => {
        e.stopPropagation()
        locate(id)
      }}
    >
      <span aria-hidden>◎ </span>
      {label}
    </button>
  )
}
