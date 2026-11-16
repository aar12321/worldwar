import { useGame, type MapMode } from '../store'
import { FRONT_COLORS, RELATION_COLORS, tensionColor } from './colors'
import { MAP_MODE_KEYS } from './shortcuts'

const MODES: { id: MapMode; label: string; hint: string }[] = [
  { id: 'political', label: 'Nations', hint: 'Each nation in its own color. Countries you can attack glow pink.' },
  { id: 'relations', label: 'Relations', hint: 'Who is with you and who is against you.' },
  { id: 'fronts', label: 'Fronts', hint: 'How much Defense Line is left in your countries and your enemies\'.' },
  { id: 'borders', label: 'Borders', hint: 'Every border colored by its tension, thicker where it is well guarded, with the forces on station and the sea chokepoints.' },
]

const LEGEND: Record<MapMode, { color: string; label: string }[]> = {
  political: [],
  relations: [
    { color: RELATION_COLORS.yours, label: 'You' },
    { color: RELATION_COLORS.ally, label: 'Ally' },
    { color: RELATION_COLORS.pact, label: 'Pact' },
    { color: RELATION_COLORS.war, label: 'At war' },
    { color: RELATION_COLORS.other, label: 'Neutral' },
  ],
  fronts: [
    { color: FRONT_COLORS.yours, label: 'Your line, strong' },
    { color: FRONT_COLORS.enemy, label: 'Enemy line, strong' },
    { color: FRONT_COLORS.weak, label: 'Nearly broken' },
  ],
  borders: [
    { color: tensionColor(0), label: 'Calm' },
    { color: tensionColor(40), label: 'Tense' },
    { color: tensionColor(70), label: 'Disputed' },
    { color: '#9ad1ff', label: 'Sea chokepoint' },
  ],
}

/** Chooses what the globe's colors mean, with a legend for the current choice. */
export function MapModes() {
  const mode = useGame((s) => s.mapMode)
  const setMode = useGame((s) => s.setMapMode)
  const legend = LEGEND[mode]
  return (
    <div className="map-modes surface" role="group" aria-label="Map colors">
      <div className="segmented">
        {MODES.map((m) => (
          <button key={m.id} type="button" aria-pressed={mode === m.id} aria-keyshortcuts={MAP_MODE_KEYS[m.id]} title={`${m.label} (${MAP_MODE_KEYS[m.id]}). ${m.hint}`} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 px-1.5 pt-1.5 text-[12px] text-white/80">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
