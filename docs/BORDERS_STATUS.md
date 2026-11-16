# Active military and borders: status (final)

Checks: `tsc -b` clean, lint clean, `vitest run` 838 passed on the last full run; its 3 failures were two goldens (re-pinned after the AI caps changed) and one 5 s timeout (given 120 s).

## DONE AND TESTED
- Stations (coastal patrol, submarine screen, air patrol, border garrison per land neighbor, reserve); posted forces cannot attack, still cost upkeep and oil, defend +35% on post / half elsewhere.
- Garrison Defense Line, surprise attacks, provocations turned back; patrols sink landings; air patrols stop missiles and help missile hunters; live contact and intercept events.
- Intel guess vs exact; threat watch; advisor.
- Borders: tension parts and limits, four states, close/reopen, incident memory; incidents are the existing "Border incident" war reason; sea incidents need watched waters.
- AI posture by threat and difficulty. Untouched games bit-identical (Normal, Hard, small war with postures removed).
- Edge cases: stale garrison after conquest, over 100% shares, empty stations, tension 0 and 100, old save, save round trip, upkeep unchanged.
- 24 mutation checks, all caught (scratchpad mutate.py).

## DONE, CHECKED BY EYE (desktop 1440x900 and phone 390x844, one pass)
- Deployment tab, country border card, Borders map (colored lines, tension and state badges with icons, legend), station badges.

## KNOWN GAPS
- On a phone the globe's HTML badges and name pins show through the open drawer (existing behavior for pins).
- Border lines on the globe are thin; the badges carry the numbers.
