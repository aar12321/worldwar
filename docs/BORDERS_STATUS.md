# Active military and borders: status

Checks at audit (after merging `claude/laughing-planck-9gjcru`, commit 0ca231e): `tsc -b` clean, `npm run lint` clean, `vitest run` 816 passed / 16 failed.
15 failures are "Test timed out" (machine load average 40+ on 4 cores); 1 is real: liveSim "battles > 10" got 9 (AI keeps too much on station).

## DONE AND TESTED (deployment.test.ts, borders.test.ts)
- Stations: coastal patrol, submarine screen, air patrol, border garrison per land neighbor, reserve (`setDeployment`, once a month, shares validated).
- Posted forces cannot attack (`freeUnits`: launch, attack, reach, forecast), still counted for upkeep/oil/power; defend +35% on post, half elsewhere.
- Garrisons: Defense Line bonus (capped), surprise attack on unguarded border (first months of war), provocations turned back.
- Patrols: sink part of a landing (by route: lane/fleet/air), air patrol shoots down missiles, live `contact` and `intercept` events.
- Intel: exact vs rounded steady guess (`deploymentView`); threat watch; advisor items.
- Borders: tension parts (war, pact, alliance, massed troops, incidents, closure, grievance, trade), states open/fortified/closed/disputed, `setBorder` close/reopen, incident memory that fades.
- Incidents are the existing "Border incident" reason for war; sea incidents need watched waters.
- AI posture by threat and difficulty; bots post orders; reserve-based attack planning.
- Untouched games bit-identical (Normal and Hard worlds, small war, with posture orders removed).

## DONE BUT UNTESTED
- Deployment tab (never opened in a browser), country-panel border card, Borders map mode colors/legend, station badges on the globe, border lines and sea chokepoint arcs (data layers unit-tested only).
- Presentation toasts for contact/intercept (livePresent), turn-mode intercept toast, War Room reserve text.
- Economy upkeep unchanged by posting (only asserted through military power).

## PARTLY DONE
- Early warning against strikes: air patrol stops missiles and live contact warns of landings; missing: interplay with aircraft hunters (patrol should help hunters in `getsThrough`).
- Edge tests missing: tension at 0 and 100, old save without the new fields, garrison on a border that vanished through conquest in a live game, over-assigning in one batch.
- Borders readability: tension is color-only on the globe lines (no pattern or labels yet).

## NOT STARTED
- Browser verification at 1440x900 and 390x844 and the fixes it will need.
- Mutation-check run (script written, not run).
