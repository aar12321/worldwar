# Balance audit: status

State: merged with `claude/laughing-planck-9gjcru` (missile UI, aircraft development, missile research fix). `npx tsc -b` and `npm run lint` clean.
Full `npx vitest run` after the merge: running; one failure seen so far was only a 5 s default timeout under load (fixed with a file-wide timeout).

## DONE AND TESTED
- Order wiring: every Order type in describe / checkRules / PHASES / executeOrder / keptOrder (`balance.test.ts`, source-text check).
- Hardened orders: nonsense never throws, never makes a NaN treasury (fuzz test; failed before).
- Fixes with tests that failed before: shared stability ceiling, research price paid, shield vs factory stop (`factoryNeed`), line never healed by a strike, rush scaled by engineers, missile stores ceiling.
- Live vs turn parity for programs, campaigns, projects, rushes, missiles (`statecraftParity2.test.ts`); live flights per kind (`missiles.test.ts`).
- Online: saturated snapshot round trip and size; two human plans in either order.
- Invariants for new fields (`invariantProblems`), run in 3 seeds x 3 difficulties x 120 months: no violation.
- 120-month all-bot sweeps (Easy/Medium/Hard, seeds 11-13): tables in BALANCE.md; no snowball (max 15.4%), no explosion, no collapse.
- Optimizer player (tiers 1, 3, 4): no loop; money is the brake. Program/project ROI tables. Tier economy table (pinned as ranges).
- Missile balance (cost per line point, shields, caps): `missiles.test.ts`, `balance.test.ts`.
- `balance.sweep.ts` (not a test) plus how-to in BALANCE.md.
- Hard-bot golden re-pinned with reason.

## DONE BUT UNTESTED
- UI: People, Projects and all desks clicked in headless Chrome before the merge (0 errors). Not re-run after the merge.

## PARTLY DONE
- Aircraft development and missile UI (merged): code read; hunters vs missiles and Hard-bot spend not yet measured.
- Mutation-check of key regression tests: not done.

## NOT STARTED
- Visual pass at 1440x900 and 390x844 in a late-game state (every tab of every desk).
- Final BALANCE.md section on aircraft and re-check list update.
