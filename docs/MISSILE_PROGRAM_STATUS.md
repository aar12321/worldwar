# Missile Program: status

The missile screen is now a program you build and run, on one tab: **Military, Missile Program** (open from the first day). The old charter levels (`fundMissiles`, levels 1 to 3) stay as the program's charter: they decide which kinds can be built at all.

## Where it lives

| part | file |
|---|---|
| numbers, with comments | `src/data/missileProgram.ts` (`FACILITIES`, `STAFF`, `CHIEF_TRAITS`, `DEVS`, `CONTRACTORS`, `PROGRAM_RULES`, `TEST_RULES`, `PRODUCTION_RULES`, `POACH`, `MPROG.on`) |
| rules | `src/engine/missileProgram.ts` (validation, costs, apply, settle, month, live day, tests, poaching, rivals' view, news) |
| effects on strikes | `src/engine/programEffects.ts`, read by `missiles.ts` (range, price, capacity, stores), `missileWar.ts` (evasion, interception, rounds, radar, mobile cover, harm, hardening) and `missileForecast.ts` |
| order path | one order type, `{ type: 'missileProgram', nationId, action }` (types.ts, orders.ts, resolveTurn.ts PHASES next to `space`, executeOrder, describeOrder) |
| live clock | `live.ts`: `dueToday` wakes for a program job, `processDay` step 8 runs `runProgramDay` |
| month | `runMonth` calls `runMissileProgram` after the missile war |
| money | `economy.ts`: its own treasury line "Missile program"; staff add to `extraEngineers` (drawn from the factories) |
| talent pool | `space.ts talentCap` and `programTalentCap` share one pool (one space hire = two program places) |
| AI | `src/ai/missileProgram.ts`, called last in `manageCountry` |
| screen | `src/ui/MissileProgramDesk.tsx`, `src/ui/missileProgramText.ts`; tab registered in `registry.ts` (`program`), globe arcs in `fx/FxOverlay.tsx`, toasts in `ui/livePresent.ts` and `store.ts presentMonth` |

## Done

- **Structure**: 7 facilities (institute, design bureau, engine test stand, production plant, silo field, interceptor works, warhead integration), 2 to 4 levels each, money, months, upkeep, effects per level. A level may be one above the charter; tier caps the level (3 / 4 / 5) and parallel builds (1 / 1 / 2 / 2 / 3).
- **Talent**: 6 roles with hire price, salary and a useful cap; talent pool from the people's engineers and scientists (Poland about 9 at the start, China about 85), shared with space; staff draw engineers from industry. Chief designer: 3 seeded candidates a year, 6 traits, skill 1 to 5 growing every 3 successful tests.
- **Development**: 18 projects in 5 branches with prerequisites, charter level, tier, facility needs, months, money, research. In-house (institute + 2 engineers; speed from institute, engineers, branch specialists, chief, experience, budget) or domestic (x1.35 price, x1.3 pace, -4% tests) or foreign (x1.7, x1.7, -8%, exposes the program to every rival). Slots 1 / 1 / 2 / 2 / 3 by institute level.
- **Test launches**: a project with a test waits in "ready to test". The order costs money (a tenth of the project, at least 8, -15% a stand level), needs a stand, at most one a month per stand level. Live: 2-day countdown, 1 day in the air, an arc to a safe zone at sea drawn on every screen (`game.missileTests`). Turn game: judged at the month end. Seeded roll (`seed ^ 0x7e57`, the test id) against the odds (project base 0.5 to 0.75, bureau, stand, crews, specialists, experience, chief, contractor, +6% per earlier failure, held to 25%..95%). Success: in service, +6 experience, +0.4 world tension, -2 opinion from up to 6 rivals near or at war; failure: +3 experience, +0.2 tension.
- **What it changes** (capped): range up to +60%, harm per landed missile up to +50% (CEP shown shrinking), up to 30% of enemy interception evaded, up to +20% interception, +60% interceptor rounds, +2 radar, +2 mobile launcher cover, up to 60% of a store safe from counterforce, up to 35% cheaper missiles, +20 a month, +60 stored. The War Room, Missile War tab and forecasts use the same functions.
- **Budget**: Lean 50% / 75% / Normal / 125% / Crash 150%: work at 0.6 + 0.4 x budget speed; operations cost x budget. Bill = upkeep + salaries + operations; an empty treasury at the month end stalls in-house work next month.
- **Production line**: with a plant, batches of up to 20 (4 waiting), 10% cheaper, delivered one missile at a time (3 a month per plant level, +1 per production manager, +2 for a production genius).
- **Rivals**: poaching about 5% a month for a program with 3+ staff (x1.6 lean, x0.6 rich budget, -20% per analyst, half with no rival program near); the staff (or a skill 3+ chief) go to the rival program. Analysts show rival programs (1: levels; 3: what they develop). Medium rivals run a small program, Hard a bigger one and shed staff when the bill grows past a tenth of income; Easy never.
- **Live screen**: header (charter, bill breakdown, talent, experience, budget), milestone strip (9), next steps with Do-it buttons, timeline with days left and moving bars, test range with odds bar, countdown animation (3-2-1-LAUNCH, reduced-motion aware), facility cards, staff and chief, development tree by branch with contractor choice, stockpile and production line, capability table (range and CEP by kind), defences summary linking Missile War, rival programs. Tab badge counts projects ready to test. Toasts when a facility opens, a project is ready, a test lands, staff are poached, a milestone is reached (live days and turn months).
- **Online**: everything is an order through the normal path (host validates and acks; refused with words); state is shared and deterministic; the live room test runs both screens through a month, a mid-month finish and a test launch with identical fingerprints.
- **Old saves**: `mprog` and `missileTests` are optional; a nation without them is exactly as before (bill 0, no line, no field, all effects `undefined`).

## Tests

- `src/engine/__tests__/missileProgram.test.ts` (46): time maths, facilities (charter, tier, one at a time, bill in the economy), talent (cap, shared with space both ways, factory draw, branch speed, chief candidates), development (in-house vs contractor, gates, slots, test roll with both outcomes over seeds, determinism, stand limit, no-test projects, foreign exposure), budget and stall, effects on strikes (range, evade/intercept and forecast agree, harm and hardening, cost/capacity/storage, rounds, caps), production line, live (opens on its day, mid-month finish, countdown and landing, quiet days stay quiet, two runs identical), rivals (poach risk, poaching over 30 months seeded, analysts), screen news, fuzz (28 malformed actions refused without throwing or charging, a human's junk month resolves, 400 random actions), switch-off, data sanity, safe-zone test range on the real map.
- Mutation checks: 17 mutations of the rules (branch speed, budget pace, shared pool, charter cap, failure learning, the roll, stall, poaching, line delivery, foreign exposure, the live wake-up, evasion, range, caps, harm, cost cut, the economy line), each caught by at least one test (script kept out of the repo; rerun by hand-editing the line and running the file).
- `src/net/missileProgramLive.test.ts` (2): two-player live room; malformed and forged orders change nothing.
- `src/engine/__tests__/missileProgramSim.test.ts` (SIMS set): 12 Easy months, no programs; 24 Hard months: programs, tests, bill share bounded; Medium modest.
- Goldens: see turnGolden.test.ts (re-pinned with a switch-off proof: `MPROG.on = false` gives back the previous pins).

## Not done / not verified

- No espionage operation to poach or steal from a rival program on purpose (poaching is passive, by the monthly roll).
- Only the production line and the charter workshop build missiles; there is no separate interceptor production queue (the works raise the store size instead).
- Rival test launches make news only for players they touch (near, at war); a Hard world rarely shows them to a far-away player.
- The intel view of rival programs is not shown on the Diplomacy or country panels, only in this tab.
- Test arcs use the existing missile looks; a test's success or failure has no special impact effect on the globe.
- Balance is checked by the 24-month sims and the bill-share bounds, not by long human play; the numbers are first guesses in data tables.
- Two-player online was tested with the in-memory room harness, not across two real browsers.
