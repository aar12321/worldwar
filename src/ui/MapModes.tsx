import { useGame, type MapMode } from '../store'
import { BLOC_COLORS, frontColors, relationColors, tensionColor } from './colors'
import { MAP_MODE_KEYS } from './shortcuts'

const MODES: { id: MapMode; label: string; hint: string }[] = [
  { id: 'political', label: 'Nations', hint: 'Each nation in its own color. Countries you can attack glow pink.' },
  { id: 'relations', label: 'Relations', hint: 'Who is with you and who is against you.' },
  { id: 'fronts', label: 'Fronts', hint: 'How much Defense Line is left in your countries and your enemies\'.' },
  { id: 'borders', label: 'Borders', hint: 'Every border colored by its tension, thicker where it is well guarded, with the forces on station and the sea chokepoints.' },
  { id: 'blocs', label: 'Blocs', hint: 'Every alliance bloc in its own color: yours in blue, blocs at war with yours in red, the rest in their own colors.' },
]

const legendFor = (mode: MapMode, palette: 'standard' | 'colorblind'): { color: string; label: string }[] => {
  const R = relationColors(palette)
  const F = frontColors(palette)
  if (mode === 'relations')
    return [
      { color: R.yours, label: 'You' },
      { color: R.ally, label: 'Ally' },
      { color: R.pact, label: 'Pact' },
      { color: R.war, label: 'At war' },
      { color: R.other, label: 'Neutral' },
    ]
  if (mode === 'fronts')
    return [
      { color: F.yours, label: 'Your line, strong' },
      { color: F.enemy, label: 'Enemy line, strong' },
      { color: F.weak, label: 'Nearly broken' },
    ]
  if (mode === 'borders')
    return [
      { color: tensionColor(0), label: 'Calm' },
      { color: tensionColor(40), label: 'Tense' },
      { color: tensionColor(70), label: 'Disputed' },
      { color: '#9ad1ff', label: 'Sea chokepoint' },
    ]
  if (mode === 'blocs')
    return [
      { color: BLOC_COLORS.yours, label: 'Your bloc' },
      { color: BLOC_COLORS.enemy, label: 'At war with your bloc' },
      { color: BLOC_COLORS.others[0], label: 'Other blocs' },
      { color: BLOC_COLORS.none, label: 'No bloc' },
    ]
  return []
}

/** Chooses what the globe's colors mean, with a legend for the current choice. */
export function MapModes() {
  const mode = useGame((s) => s.mapMode)
  const setMode = useGame((s) => s.setMapMode)
  const palette = useGame((s) => s.settings.ui.palette)
  const legend = legendFor(mode, palette)
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
      {mode === 'borders' && (
        <p className="px-1.5 pt-1.5 text-[12px] leading-snug text-white/70">
          Each badge on a border gives its tension and its state: ring open, shield fortified, bar closed, triangle disputed. A thick line is well guarded, a dashed one is closed. Small badges are forces on station.
        </p>
      )}
    </div>
  )
}
