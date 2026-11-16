import type { Nation, Order } from '../../../engine/types'
import type { SpaceAction } from '../../../data/space'

/** An order for the space program. They all apply at once. */
export const spaceOrder = (n: Nation, action: SpaceAction): Order => ({ type: 'space', nationId: n.id, action })

/** Money, rounded the way the rest of the game shows it. */
export const money = (v: number) => (Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)}k` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))

export const percent = (v: number) => `${Math.round(v * 100)}%`

/** Months, in words. */
export const monthsText = (m: number) => (m >= 24 ? `${(m / 12).toFixed(m % 12 === 0 ? 0 : 1)} years` : `${m} month${m === 1 ? '' : 's'}`)
