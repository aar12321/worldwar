# UX work: status checklist

Branch `worktree-agent-a1e893934dd9f4c37`, merged with `claude/laughing-planck-9gjcru` (War Room Missiles section, missile program card, incoming-missiles chip, aircraft Develop screen). Last updated at the end of the work.

## DONE AND TESTED

- **Registry** (`src/ui/registry.ts`): every desk and tab declared once (id, label, icon, key, aliases, group, order, loader, visibility, badge). Rail, phone bar and More sheet, palette, shortcut sheet, key handler, tab bars of Economy, Military, Empire and Settings, pins and breadcrumbs read it. Drop-in files in `src/ui/desks/*.ts` extend it. 24 unit tests (lookups, key uniqueness, visibility by kind of game, extension merge, pins, crumbs).
- **Grouped navigation**: rail with groups (headers and folding appear from 7 desks), pinned strip, Search; phone bottom bar with More sheet (`navLayout.ts`, 5 tests). Smoke-tested on desktop and phone.
- **Jump window** (Ctrl+K or /): desks, tabs, settings, actions (incl. Aircraft development and Missile program), queued orders, nations, countries; recents, pinned, filter chips, key caps, combobox ARIA. Keyboard walkthrough passes (`/tmp` script).
- **Back and last tab**: Alt+Left, back chip in the desk header, `[` and `]` step tabs, last tab per desk saved.
- **Settings**: text size, high contrast, color-blind palette (HUD, status colors, globe relations and fronts), spacing, motion (follows the system), desk widths, pins and recents, reset. `settings.ui` is sanitized and migrates old settings blobs (`prefs.ts`, 17 tests).
- **Shared logic**: fuzzy search (`search.ts`, 10 tests), list filter, sort and paging (`listUtils.ts`, 9 tests).
- **Accessibility**: keyboard-only walkthrough (21 checks), focus ring everywhere, focus moves into a desk and returns, dialog focus trap, live announcements for months and orders, toasts with icons.

## DONE BUT UNTESTED (checked by eye in screenshots, no automated test)

- Shared widgets: `NumberStepper` (in the Military train box), `CostEffect`, `EmptyState` (News), `Skeleton` (desk and tab loading), `ConfirmButton` and `runWithUndo` (used by `OrderButton` for big orders), `Term` and `InfoTip`, `Ticker`.
- `DataList` (Economy Country list, Projects country picker).
- Animations: desk fade, tab fade, toasts, tray, modal, report cards; reduced motion switches them off. Desk drag-to-resize.
- Density, text size (CSS `zoom`) at 0.9 to 1.25.

## PARTLY DONE

- `Term` is available but used in few places; many labels still lack tooltips.
- Performance: DOM weight measured (2428 to 924 nodes at 175 countries); timing on this shared machine is too noisy for firm millisecond claims.
- Text under 12 px: the stylesheet forces 12 px; the final audit run counts what is left.

## NOT STARTED

- Nothing from the brief is untouched. Not done on purpose: no change to engine, balance or the War Room; scenario picker, Faction desk, Space tab, Deployment, Borders and World Reaction belong to other agents and plug in through the registry.

## Check results

See section 7 of `docs/UX.md`: tsc clean, lint 0 errors, vitest 1073 pass and 1 AI test fails (not UI). Faction, Space, Deployment and World reaction are registered and smoke-tested.
