# Browser verification: status

Every screen below was opened in Chromium (software GL) at 1440x900 and 390x844, screenshotted and read. State was driven through `window.__store` or the UI. UI-only changes; engine, rules and goldens are untouched.

| # | Screen | Result | Notes |
|---|--------|--------|-------|
| 1 | Faction desk: found form, council, vote toast and badge, propose-country list, pool, contributions, contracts, war log | checked, fixed | Vote toast said "war on russia" (lower-cased the country); fixed. Redundant "Player" chip next to "You" removed. Queued-orders tray covered the right edge of the desk (hid part of "Vote No"); it now sits right of centre on wide screens. |
| 2 | World reaction tab, nuclear card, launch confirmation (tick box), live flight arcs, incoming alert | checked, fixed | Arcs (white outgoing, pink incoming) and alert chip render. The phone alert chip cut off the days left ("NUCLEAR MISSILE from Chin..."); it now wraps. |
| 3 | Space tab: Agency, Rockets, Missions, Labs, Colonies; in-house vs company headline on phone | checked, fixed | Status chips ("3.3 years left", "Lab 1") wrapped into round blobs on phone; now never wrap. Space hint pill overlapped the desk header on phone; soft pills now step aside while a desk is open (red alerts stay). In-house vs company price headline reads cleanly stacked on phone. |
| 4 | Deployment tab, Borders map mode and legend, phone drawer vs globe badges | checked, fixed | Desktop: the map-colors control with the Borders legend sat under the desk rail (hiding "Nations" and "Relations"); moved right of the rail. Phone: legend, badges and country drawer do not overlap (drawer hides the control by design). |
| 5 | War Room missiles (1 / custom, stock by type, launch), Aircraft Develop | checked | No defects found. Custom count stepper and per-type stock render; Develop screen scrolls cleanly on both sizes. |
| 6 | Scenario picker, Briefing scenario progress bars | checked | Picker, cards and "How you win" bars (countries, people, output) render on both sizes. |
| 7 | People (all seven sections), Projects (National, In your countries) | see below | |
| 8 | Command palette, settings, keys sheet | see below | |
| 9 | Online screens | see below | |
| - | Live clock with HUD chips | see below | |
