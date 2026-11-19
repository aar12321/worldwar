/**
 * Whether a city sits close enough to its country's name pin that a name chip there would overlap the country's name at the usual
 * zoom (about 9 px a degree on a 1440x900 screen; a chip is some 20 px tall and 60 px wide). Such a city is drawn as a dot.
 */
export function nearLabel(lat: number, lng: number, labelLat: number, labelLng: number): boolean {
  const dLng = Math.abs(((lng - labelLng + 540) % 360) - 180) * Math.cos((labelLat * Math.PI) / 180)
  return Math.abs(lat - labelLat) < 3.5 && dLng < 7
}
