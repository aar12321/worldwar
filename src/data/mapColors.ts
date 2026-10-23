/**
 * Print-map colors. Mid tone, warm and cool alternating, none of them the neon cyan
 * that used to paint the whole player country the same hue as the sea.
 */
/** Your country. Warm crimson, so a large nation never turns the map into the sea. */
export const PLAYER_COLOR = '#c4474a'

export const MAP_PALETTE = [
  '#e0a31a',
  '#3e9a62',
  '#d06a32',
  '#7a52b8',
  '#d45d86',
  '#c9b035',
  '#2f7f78',
  '#b8442e',
  '#6f8f2e',
  '#5d82d0',
  '#a33d6b',
  '#e08a4f',
  '#3f7d46',
  '#c47b2a',
  '#5c4d9a',
  '#c4b07a',
  '#8d4a3a',
  '#db6b6b',
  '#8faf45',
  '#3d6ea8',
  '#b08968',
  '#9a3d4a',
  '#e6c15a',
  '#2e6b4f',
  '#c45c3e',
  '#7d6bb5',
  '#d4893a',
]

/** Stable country color. Nearby indexes land on distant swatches. */
export function mapColor(index: number): string {
  const n = MAP_PALETTE.length
  const slot = (((index % n) + n) % n * 11 + 5) % n
  return MAP_PALETTE[slot]
}
