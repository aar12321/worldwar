/**
 * Drop-in desks and tabs. Any `.ts` file in this folder is read by the registry (src/ui/registry.ts) at start-up, so a new
 * desk or tab needs no edit to the rail, the jump window, the keys or the help sheet. Copy this file, rename it, and fill it in:
 *
 *   export const desks: DeskDef[] = [
 *     { id: 'faction', label: 'Faction', icon: 'flag', key: 'f', group: 'world', order: 55,
 *       hint: 'Your faction, its members and its goals',
 *       tabs: [{ id: 'members', label: 'Members', load: () => import('../faction/MembersTab') }] },
 *   ]
 *   export const tabs: ExtraTab[] = [   // a new tab on a desk that already exists
 *     { desk: 'military', id: 'space', label: 'Space', hint: 'Orbital programs', key: 'p', load: () => import('../SpaceTab') },
 *   ]
 *
 * `load` points at a file whose default export is a React component. See docs/UX.md, "Adding a new desk or tab in 5 minutes".
 */
import type { DeskDef, ExtraTab } from '../registry'

export const desks: DeskDef[] = []
export const tabs: ExtraTab[] = []
