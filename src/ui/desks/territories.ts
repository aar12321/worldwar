/** The Territories tab of the Empire desk: it shows only while you hold a territory. */
import type { ExtraTab } from '../registry'

export const tabs: ExtraTab[] = [
  {
    desk: 'empire',
    id: 'territories',
    label: 'Territories',
    hint: 'Your territories: the 30% cut, their army, forced trade, release or annex',
    keywords: ['territory', 'territories', 'vassal', 'cut', 'revenue', 'faction', 'command', 'force trade', 'annex', 'release'],
    load: () => import('../TerritoryDesk'),
    visible: (c) => (c.territories ?? 0) > 0,
    badge: (c) => c.territories || null,
  },
]
