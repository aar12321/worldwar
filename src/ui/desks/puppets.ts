/** The Puppets tab of the Empire desk: it shows only while you rule a puppet. */
import type { ExtraTab } from '../registry'

export const tabs: ExtraTab[] = [
  {
    desk: 'empire',
    id: 'puppets',
    label: 'Puppets',
    hint: 'Rule your puppets: tax, draft, laws, tribute, loyalty',
    keywords: ['puppet', 'vassal', 'tribute', 'loyalty', 'overlord', 'annex', 'garrison', 'aid'],
    load: () => import('../PuppetDesk'),
    visible: (c) => c.puppets > 0,
    badge: (c) => c.puppets || null,
  },
]
