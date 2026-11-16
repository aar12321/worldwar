# Interface quality: audit, changes and how to build on it

This covers the UX pass over every desk and tab: what was wrong, what changed, and how to add a desk, a tab or a panel without
making the interface harder to learn. Nothing here changes a game rule. All code is in `src/ui/`, `src/index.css` (untouched),
`src/ui/ux.css`, `src/App.tsx` and a few UI-state fields in `src/store.ts`.

Screenshots are small PNGs in `docs/audit/img/ux/`. "Before" is the game as it was at the start of this work, "after" is this branch.

## 1. The audit

How: Playwright with Chromium (software GL), a game as Germany with 45 countries, a high tier and plenty of money (state changed
through `window.__store`), every desk and tab opened at 1440x900, 1024x768 and 390x844 (phone, touch). Each screen was screenshotted and
measured in the page: text under 12 px, tap targets under 44 px, elements wider than the window, clipped text. The first run is "before",
the same script on this branch is "after". 22 screens per size.

### Findings

| # | Finding | Where | Fix |
|---|---|---|---|
| 1 | A desk that loads on first use shows nothing at all while its code loads (the whole drawer is missing for a moment). | every lazy desk | `DeskLoading` skeleton in the same drawer; other tabs preload when idle |
| 2 | The rail was a fixed list of six desks, the phone bar a fixed row of six; neither can hold eight or ten. | `NavRail` | registry, groups, folding, phone bar with a More sheet |
| 3 | Desk and tab names were typed in five places (rail, keys, palette, three tab bars). A new tab meant five edits. | Chrome, App, Palette, desks | one registry (`registry.ts`) |
| 4 | The jump window knew desks and countries but not every tab, no settings, no recents, no queued orders, no key hints; its matching was substring only. | Palette | rewritten: tabs, settings, actions, orders, nations, countries, recents, pinned, filters, fuzzy match |
| 5 | Phone: 264 text nodes under 12 px (HUD labels 10.5 px, rail labels 10.5 px). | HUD, rail | 12 px floor under 900 px |
| 6 | Phone: 59 controls under 44 px: Close buttons 39 px, selects 40 px, checkboxes 13 px, sliders 16 px. | many | coarse-pointer and narrow rules in `ux.css` |
| 7 | Phone: the HUD (236 px) plus a three-line desk header plus the bottom bars left about 300 px for content. | all desks | one-line kicker, smaller title, HUD sub-line hidden while a desk is open |
| 8 | The Economy "Your empire" list drew every country with its own dropdown: 2,428 page elements at 175 countries, and one governor change redrew all rows. | Country tab | `DataList` (30 rows at a time, search, filter, sort), memoized rows: 924 elements |
| 9 | Projects: a scrolling list inside the scrolling desk (scroll-in-scroll). | Projects | same `DataList`, paged in the desk's own scroll |
| 10 | Settings had no descriptions and no size, contrast, color or spacing choices; keys were one paragraph. | Settings, Help | tabs, descriptions, new options, keys sheet from the registry |
| 11 | Green and red were the only cue for good and bad in many places. | HUD, tables, map | color-blind palette (blue and orange, plus on the globe); signs and words kept |
| 12 | Tabs used `aria-pressed` on `role="tab"`; focus never moved into a desk, so keyboard users started from the page top. | `Tabs`, `PanelShell` | `aria-selected`, focus moves in and returns, visible 2 px ring everywhere |
| 13 | Toasts were text only. A big confirmed order gave no way back. | toasts, `OrderButton` | toast actions: Undo for orders that took effect, Cancel for queued ones |
| 14 | No way back to the previous tab; last tab not remembered after a restart. | desks | Alt+Left, back chip, `[` `]`, last tab saved |
| 15 | No pinning of the panels a player uses most. | rail | star in each desk header, pinned strip, shown in the More sheet and the palette |
| 16 | Ad-hoc empty states ("No dispatches yet.") with no next step. | News | `EmptyState` |
| 17 | Dropdown legibility (the reported country-name problem): solid dark list existed; the closed box and phone height were still small. | selects | 44 px on touch, strong contrast, high-contrast mode |

Numbers from the measuring script (smaller is better; "tiny" counts distinct controls under 44 px on a coarse-pointer phone, and under 44 px of any kind on desktop, where 32 px mouse targets are normal):

| size | before: under 12 px | before: under 44 px | before: clipped | after: under 12 px | after: under 44 px | after: clipped |
|---|---|---|---|---|---|---|
| desktop | 0 | 257 | 12 | 0 | 264 | 12 |
| tablet | 0 | 257 | 12 | 0 | 262 | 14 |
| phone | 264 | 59 | 36 | 0 | 23 | 15 |

No screen scrolled horizontally before or after. The desktop and tablet "under 44 px" counts are mouse-sized controls (32 px icons, 32 px tabs) and are expected; the phone count that remains is mostly 22 px checkboxes inside 44 px label rows. Two real phone overflows found by the smoke test (Empire Provinces buttons, Agencies target picker) were fixed.

### Before and after

| | before | after |
|---|---|---|
| Phone, Economy | `img/ux/before-phone-economy-people.png` | `img/ux/after-phone-economy-people.png` |
| Phone, Military | `img/ux/before-phone-military-forces.png` | `img/ux/after-phone-military-forces.png` |
| Desktop, Economy Country | `img/ux/before-desktop-economy-country.png` | `img/ux/after-desktop-economy-country.png` |
| Desktop, Settings | `img/ux/before-desktop-settings.png` | `img/ux/after-desktop-settings.png` |

New screens: `img/ux/new-palette-desktop.png` (jump window), `img/ux/new-more-sheet-phone.png` (phone More sheet),
`img/ux/new-rail-ten-desks.png` (rail with ten desks, groups and the Faction/Space/Borders examples), `img/ux/new-high-contrast.png`,
`img/ux/new-colorblind.png`, `img/ux/new-scale-125-desktop.png`, `img/ux/new-settings-phone.png`, `img/ux/new-aircraft-phone.png`.

## 2. What changed

**Navigation that scales.** `registry.ts` is the one list of desks and tabs. The rail groups desks (Plan, Nation, World); from seven desks it
shows group names and lets a group fold. On a phone the bottom bar holds as many desks as fit at 12 px (six at 390 px) and gives the last
slot to **More** when there are more desks or something is pinned; More opens a sheet with search, pins, every desk and every tab of it as
44 px buttons. A star in each desk header pins that desk or tab (up to 8, saved). Alt+Left goes back; a back chip in the header names where.
`[` and `]` step through the tabs of the open desk. Each desk remembers its last tab, also across sessions. Desks fade in and out (160 ms),
tab bodies fade (140 ms), drawers can be dragged wider or narrower (width remembered; Enter or double-click resets).

**Jump window** (Ctrl+K or /, or the magnifier in the top bar and the rail). Finds desks, every tab, every setting (by name, description
and keywords), actions (end turn, undo, back, pin, help, keys, Aircraft development, Missile program), queued orders (to cancel them),
nations (Diplomacy and Agencies) and all countries. Empty box: recents, pinned, desks. Filter chips narrow it. Matching is forgiving but
does not match random long text.

**Settings** (`Settings` desk, four tabs, rows from `settingsDefs.ts`): text and interface size (4 steps), high contrast, color-blind safe
colors, spacing (comfortable or compact), motion (follow the system, reduce, full), desk widths, pins and recents, reset to defaults, plus
the old game options, each with a one-sentence description. Stored under `settings.ui` in the existing settings key, sanitized on load; old
settings blobs migrate (the old Reduce motion switch becomes the motion preference). Saves are never touched.

**Keys.** `?` opens help; `?` again flips to the Keyboard shortcuts tab, which is built from the registry. Settings has the same sheet.

**Shared components** (see section 4). **Animation** (all at or under 250 ms, transform and opacity only, off under reduced motion via
`html[data-motion=reduced]` and framer-motion's `MotionConfig`): desks, tabs, toasts, orders tray, modal, month report cards, the Next turn
press, progress bars, a ticking number (`Ticker`). **Accessibility**: see section 6.

## 3. Adding a new desk or tab in 5 minutes

Everything below is the whole job; the rail, the phone bar and More sheet, the jump window, the keys, the shortcut sheet, pinning and back
all pick it up.

**A new tab on a desk that exists** (for example a Space tab on Military). Add one entry to the desk's `tabs` in `src/ui/registry.ts`:

```ts
{ id: 'space', label: 'Space', hint: 'Orbital programs', key: 'p', keywords: ['orbit', 'satellite'],
  load: lazyOf(() => import('./SpaceTab'), 'SpaceTab'),            // or: () => import('./SpaceTab')  (default export)
  visible: (c) => c.tier >= 3,                                      // optional
  badge: (c) => c.armies || null },                                 // optional "Space (2)"
```

**A new desk** (Faction, Deployment, World Reaction). Add an entry to `DESKS`, or drop a file in `src/ui/desks/` (copy `_template.ts`)
so you do not touch `registry.ts` at all:

```ts
export const desks: DeskDef[] = [
  { id: 'faction', label: 'Faction', icon: 'flag', key: 'f', group: 'world', order: 55, hint: 'Your faction and its goals',
    kicker: (c) => `${c.wars} wars`,
    tabs: [{ id: 'members', label: 'Members', load: () => import('../faction/Members') }, ...] },   // or body: () => import('../faction/Body')
]
export const tabs: ExtraTab[] = [{ desk: 'military', id: 'deploy', label: 'Deployment', key: 'y', load: () => import('../Deploy') }]
```

With `tabs` or `body` and no `load`, the game draws the shell (`PanelShell`), tab bar, loading skeleton and empty state for you. With
`shell: 'custom'` and `load`, your component draws its own `PanelShell` (as Economy, Military and Empire do) and uses `<DeskTabs desk="x"/>` and
`<TabHost desk="x"/>` if it has registry tabs.

Rules the tests enforce: unique desk ids, unique tab ids per desk, no key used twice, no key from the reserved set (`A ? / Space 1-6 [ ] Enter Esc`),
every desk drawable. `icon` names a glyph in `navIcons.tsx` (`flag`, `space`, `aircraft`, `map` exist; unknown names get a plain card; add one
function there for a new glyph). `group` is `home`, `nation` or `world` (`NAV_GROUPS`). `visible` and `badge` receive a small `RegCtx`
(live or turns, tier, offers, urgent items, wars, armies) and must be cheap and pure.

Opening from code: `useGame.getState().openTab('faction', 'members')`. The store keeps the tab for registry desks in `deskTabs`; `Panel` accepts any
registered id. A map mode (Borders) is not a desk: add it to `MapModes.tsx`; add a palette action in `buildPaletteItems()` if it should be searchable. The scenario picker is
a start-screen feature outside the desks; its settings can be added to `settingsDefs.ts`.

## 4. Building a panel: the shared parts

Use these before writing a new one-off. All are in `src/ui/`.

| Need | Use | Notes |
|---|---|---|
| A desk or tab frame | `PanelShell`, `DeskTabs`, `TabHost` (`panel.tsx`) | header, pin, back, resize, focus handled |
| A button that issues an order | `OrderButton` | says cost and effect, or why it is blocked; big orders ask first and then offer Undo |
| A long list | `DataList` (`DataList.tsx`, helpers in `listUtils.ts`) | search, filter chips or select, sort, paging as you scroll, arrow-key rows (`data-row-primary`), empty state with Clear |
| A quantity | `NumberStepper` (`widgets.tsx`) | type, - and + (hold to repeat), slider, Max, quick values, min and max, spinbutton ARIA |
| What it costs and does | `CostEffect` | costs you cannot pay turn red and are written out |
| Something drastic | `ConfirmButton`, `runWithUndo` | asks, then toasts Undo (took effect) or Cancel (queued) |
| Nothing to show | `EmptyState` | say why and what to do next |
| Loading | `Skeleton` | same height as the real thing |
| Jargon | `Term word="Stability"` (text from the help glossary `TERMS`), `InfoTip text=...`, `Tip` | opens on hover, focus and tap |
| A changing number | `Ticker` | flashes on change, never moves the layout |
| A slider | `SliderRow`, a level choice `LevelPicker`, a bar `Bar` (`kit.tsx`) | |

Spacing, color and type come from the existing classes (`inset-card`, `btn`, `field`, `label`, `chip`); do not add text under 12 px or a new
red or green: use `text-[#6eeb8a]` and `text-[#ff8a84]`, which the color-blind palette remaps.

## 5. Performance

Measured with Chromium on a shared machine under heavy load, so wall-clock times varied by a factor of ten between runs; the numbers below
are the ones that do not depend on load.

- Economy Country tab with 175 countries: page elements 2,428 before, 924 after; dropdowns 184 before, 39 after. One governor change now redraws
  one row (memoized on plain values) instead of 175.
- Live clock: one live day with the Economy desk open cost 3 to 9 ms of main-thread time and with no desk open 6 to 9 ms in the same session,
  so a quiet day still re-renders nothing in the desks (the registry context follows `useSlowGame`, as the HUD does).
- Desk code and the other tabs of a desk load before they are needed (idle preload), so a tab switch does not wait.
- All animations are opacity and transform; the only width transitions are on small progress bars.

## 6. Accessibility

Keyboard only: every desk, tab, setting and list works; `Tab` order follows the page; focus moves into a desk when it opens and back to the
button that opened it; dialogs trap focus and close on Esc; a 2 px blue ring shows focus (white outline in high contrast). Roles: `tablist`, `tab`
(`aria-selected`), `tabpanel`, `combobox` and `listbox` for the jump window, `switch`, `spinbutton`, `separator` for the resize grip, `radiogroup`.
A hidden live region announces the new month and orders given; toasts are `status` or `alert` and carry an icon, not only a color.
Meaning is never color alone (signs, words and icons stay). Touch: 44 px minimum on phones and coarse pointers; text 12 px minimum.

## 7. Tests

- Unit (Vitest, `src/ui/*.test.ts`): registry, prefs and settings migration (including an old settings blob), fuzzy search, list filter and sort,
  phone bar split, shortcut map. Mutation check: ten deliberate breaks of those helpers; eight were caught, the two survivors were equivalent changes
  (a stable sort already keeps ties; an empty search already returns everything).
- Playwright (kept outside the repo): smoke test opens every registered desk and tab on desktop and phone, in a turn game and a live game, asserting no page error,
  no console error, no horizontal scroll and no empty desk; a keyboard-only walkthrough (21 checks).

Final results on this branch (merged with the stage 1 features: factions, world reaction, space, deployment, borders, missiles, aircraft):

- `npx tsc -b`: clean. `npm run lint`: 0 errors (warnings only, mostly fast-refresh export notes).
- `npx vitest run`: 69 of 71 files pass, 1073 tests pass, 1 fails: `src/ai/bot.test.ts` "easy rivals leave the player alone early and never gang up" (AI behavior, not touched by this work). The golden turn tests pass untouched. UI helper tests: 65.
- Smoke (desktop 1440x900 and phone 390x844, turn and live games): 9 desks and 29 to 30 desk/tab screens per run, 0 page or console errors, 0 horizontal page scroll. The Research desk is flagged by the script's "is a drawer shown" check only because it draws its own layout; it renders (checked directly).
- Screens added by the merge were checked: Faction, Space, Deployment, World reaction open from the rail, More sheet, palette and keys (F, and tab keys) with no change to those screens' code beyond registration.

## 8. Merge notes for other work

- `Panel` is now `... | (string & {})`: any registry id is a panel. Do not re-narrow it.
- `EconomyDesk.tsx`, `MilitaryPanel.tsx`, `EmpireDesk.tsx` no longer list tabs or switch on them; add tabs in `registry.ts` (or `src/ui/desks/`). Tab bodies are loaded by name:
  `MilitaryForces`, `EmpireOverview` and the like are re-exports. If your branch edits the old tab list or chain, move the change into the registry.
- `NavRail` moved to `Nav.tsx` (still exported from `Chrome.tsx`). `useShortcuts` in `App.tsx` reads the registry; do not add per-desk keys there.
- `store.ts` additions: `Settings.ui`, `deskTabs`, `openTab`, `setDeskTab`, `helpTab`, `settingsFocus`, `updatePrefs`, `resetPrefs`, toast `action`; exports `GameStore`.
- Merged cleanly with the missile and aircraft work; the Aircraft screen (`aircraftOpen`) is reachable from the palette.
- Colors: new red or green should use the existing classes so the color-blind palette reaches them; map colors go through `relationColors` and `frontColors` in `colors.ts`.
