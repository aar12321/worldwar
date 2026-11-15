/** A share (0 to 1) as a percentage. */
export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`
