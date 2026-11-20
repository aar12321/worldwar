# Missile Program: status

The missile screen is now a program you build and run, on one tab: **Military, Missile Program** (open from the first day). The old charter levels (`fundMissiles`, levels 1 to 3) stay as the program's charter: they decide which kinds can be built at all.

## Where it lives

| part | file |
|---|---|
| numbers, with comments | `src/data/missileProgram.ts` (`FACILITIES`, `STAFF`, `CHIEF_TRAITS`, `DEVS`, `CONTRACTORS`, `PROGRAM_RULES`, `TEST_RULES`, `PRODUCTION_RULES`, `POACH`, `MPROG.on`, `MPROG.mediumFounds`, `MPROG.interceptorLine`, `MPROG.aiInterceptorLine`, `AI_LINE`) |
| rules | `src/engine/missileProgram.ts` (validation, costs, apply, settle, month, live day, tests, poaching, rivals' view, news) |
| effects on strikes | `src/engine/programEffects.ts`, read by `missiles.ts` (range, price, capacity, stores), `missileWar.ts` (evasion, interception, rounds, radar, mobile cover, harm, hardening) and `missileForecast.ts` |
| order path | one order type, `{ type: 'missileProgram', nationId, action }` (types.ts, orders.ts, resolveTurn.ts PHASES next to `space`, executeOrder, describeOrder) |
| live clock | `live.ts`: `dueToday` wakes for a program job, `processDay` step 8 runs `runProgramDay` |
| month | `runMonth` calls `runMissileProgram` after the missile war |
| money | `economy.ts`: its own treasury line "Missile program"; staff add to `extraEngineers` (drawn from the factories) |
| talent pool | `space.ts talentCap` and `programTalentCap` share one pool (one space hire = two program places) |
| AI | `src/ai/missileProgram.ts`, called last in `manageCountry` |
| screen | `src/ui/MissileProgramDesk.tsx` (six sections), `src/ui/programSection.ts` (the open section, `openProgram(section)` for links), `src/ui/missileProgramText.ts`; tab registered in `registry.ts` (`program`), globe arcs in `fx/FxOverlay.tsx`, toasts in `ui/livePresent.ts` and `store.ts presentMonth` |

## Done

- **Structure**: 7 facilities (institute, design bureau, engine test stand, production plant, silo field, interceptor works, warhead integration), 2 to 4 levels each, money, months, upkeep, effects per level. A level may be one above the charter; tier caps the level (3 / 4 / 5) and parallel builds (1 / 1 / 2 / 2 / 3).
- **Talent**: 6 roles with hire price, salary and a useful cap; talent pool from the people's engineers and scientists (Poland about 9 at the start, China about 85), shared with space; staff draw engineers from industry. Chief designer: 3 seeded candidates a year, 6 traits, skill 1 to 5 growing every 3 successful tests.
- **Development**: 18 projects in 5 branches with prerequisites, charter level, tier, facility needs, months, money, research. In-house (institute + 2 engineers; speed from institute, engineers, branch specialists, chief, experience, budget) or domestic (x1.35 price, x1.3 pace, -4% tests) or foreign (x1.7, x1.7, -8%, exposes the program to every rival). Slots 1 / 1 / 2 / 2 / 3 by institute level.
- **Test launches**: a project with a test waits in "ready to test". The order costs money (a tenth of the project, at least 8, -15% a stand level), needs a stand, at most one a month per stand level. Live: 2-day countdown, 1 day in the air, an arc to a safe zone at sea drawn on every screen (`game.missileTests`). Turn game: judged at the month end. Seeded roll (`seed ^ 0x7e57`, the test id) against the odds (project base 0.5 to 0.75, bureau, stand, crews, specialists, experience, chief, contractor, +6% per earlier failure, held to 25%..95%). Success: in service, +6 experience, +0.4 world tension, -2 opinion from up to 6 rivals near or at war; failure: +3 experience, +0.2 tension.
- **What it changes** (capped): range up to +60%, harm per landed missile up to +50% (CEP shown shrinking), up to 30% of enemy interception evaded, up to +20% interception, +60% interceptor rounds, +2 radar, +2 mobile launcher cover, up to 60% of a store safe from counterforce, up to 35% cheaper missiles, +20 a month, +60 stored. The War Room, Missile War tab and forecasts use the same functions.
- **Budget**: Lean 50% / 75% / Normal / 125% / Crash 150%: work at 0.6 + 0.4 x budget speed; operations cost x budget. Bill = upkeep + salaries + operations; an empty treasury at the month end stalls in-house work next month.
- **Production line**: with a plant, batches of up to 20 (4 waiting), 10% cheaper, delivered one missile at a time (3 a month per plant level, +1 per production manager, +2 for a production genius).
- **Interceptor rounds on the line** (`MPROG.interceptorLine`): `produce` with `missile: 'interceptor'` needs a plant and the interceptor works and a store with room (counting rounds already on the line); it costs 75% of buying the rounds at once (`MW.roundCost`), paid when queued, and the line makes 2 rounds in the time of one missile, straight into the store. A full store holds the line (missiles behind wait; nothing is lost) and the live clock does not wake for it. Shown in Arsenal, Production line (`Interceptor rounds`), with the store, the pace and the price.
- **Rivals**: poaching about 5% a month for a program with 3+ staff (x1.6 lean, x0.6 rich budget, -20% per analyst, half with no rival program near); the staff (or a skill 3+ chief) go to the rival program. Analysts show rival programs (1: levels; 3: what they develop). Medium rivals run a small program, Hard a bigger one and shed staff when the bill grows past a tenth of income; Easy never. With `MPROG.mediumFounds` a Medium rival at war with money to spare founds one now and then (15% a month), a rich one a little more readily (10%), and it gets on with it the month it decides; growth and the bill limits are unchanged.
- **Screen, in sections** (a segmented control like the Government desk; the section is kept between visits): **Overview** (header with charter, bill breakdown, talent, experience and budget; milestone strip; next steps with Do-it buttons, and Open for a step that has none; test range with odds bar and the 3-2-1-LAUNCH countdown; timeline with days left and moving bars), **Facilities** (facility cards, defences summary linking Missile War), **Staff** (chief, staff, poaching, and a link to Economy, Government, Talent where the pool comes from), **Development** (tree by branch with contractor choice), **Arsenal** (build rows, the production line with interceptor rounds, the capability table), **Rivals**. The segmented control carries badges: tests ready (Overview), facilities building, projects in development. Links land on the right section: the advisor's 'Build missiles' and Missile War's build step and the Systems summary on Arsenal, 'Open the program' on Overview (`openProgram`, the advisor target's `section`). Desktop height went from about 3 760 px on one page to the longest section (Development) alone. Tab badge counts projects ready to test. Toasts when a facility opens, a project is ready, a test lands, staff are poached, a milestone is reached (live days and turn months).
- **Online**: everything is an order through the normal path (host validates and acks; refused with words); state is shared and deterministic; the live room test runs both screens through a month, a mid-month finish and a test launch with identical fingerprints.
- **Old saves**: `mprog` and `missileTests` are optional; a nation without them is exactly as before (bill 0, no line, no field, all effects `undefined`).

## Tests

- `src/engine/__tests__/missileProgram.test.ts` (45): time maths, facilities (charter, tier, one at a time, bill in the economy), talent (cap, shared with space both ways, factory draw, branch speed, chief candidates), development (in-house vs contractor, gates, slots, test roll with both outcomes over seeds, determinism, stand limit, no-test projects, foreign exposure), budget and stall, effects on strikes (range, evade/intercept and forecast agree, harm and hardening, cost/capacity/storage, rounds, caps), production line, live (opens on its day, mid-month finish, countdown and landing, quiet days stay quiet, two runs identical), rivals (poach risk, poaching over 30 months seeded, analysts), screen news, fuzz (28 malformed actions refused without throwing or charging, a human's junk month resolves, 400 random actions), switch-off, data sanity, safe-zone test range on the real map.
- Mutation checks: 17 mutations of the rules (branch speed, budget pace, shared pool, charter cap, failure learning, the roll, stall, poaching, line delivery, foreign exposure, the live wake-up, evasion, range, caps, harm, cost cut, the economy line), each caught by at least one test (script kept out of the repo; rerun by hand-editing the line and running the file).
- `src/net/missileProgramLive.test.ts` (2): two-player live room; malformed and forged orders change nothing.
- `src/engine/__tests__/missileProgramSim.test.ts` (SIMS set): 12 Easy months, no programs; 24 Hard months on the real world (seed 5): 13 programs, 18 facility levels, 4 developments in service, 7 tests (4 successes), 47 staff, 3 poached; the worst sustained bill (last six months' average) 8.4% of a rival's income; 24 Medium months: 1 program (an institute). Bounds: Easy none, Hard at least 2 programs and tests, bill under 12% of income.
- `deployment.test.ts` (its pre-feature hash) switches `MPROG.on` off as it does `RELATIONS.on`; `registry.test.ts` lists the new tab.
- Goldens: only the Hard-bot world moved (`1719b377e4ad6a` to `6899ffe1eaea4`); the Normal-bot world and the small war did not. Proof: the new test 'the missile program is the only thing that moved the current pins' runs all three with `MPROG.on = false` and gets every previous pin back, and every older layer test is wrapped in `withoutProgram` too.

## Test arc in a running browser

Checked with Playwright on the dev server (software GL, `scripts/shots.mjs`): a live game, a test of inertial guidance ordered on day 0 (countdown to day 2, lands day 3), the clock run at 1x with the day lengthened tenfold through the dev server's own `LIVE` module so screenshots could follow it. Frames at clock 2.05, 2.25, 2.44, 2.65 and 2.86 show the arc leaving Germany and climbing out over the North Sea, the head moving each frame; at 3.0 the test has landed and the arc is gone. What the earlier stepped screenshot saw was a real fault: the flight engine played a flight's launch flash when it first saw it, which for a test is the order, two days before lift-off. `FxEngine.syncFlights` now holds the lift-off of a flight seen before its launch time and plays it when the clock reaches it (`fx.test.ts`, 'flights and their lift-off'); missiles, which launch when seen, are unchanged.

## Tests added with the gap fixes

- `missileProgram.test.ts`, 'interceptor rounds on the production line' (5): needs a plant, the works and room counting the line; cost at 75%; 6 rounds a month from a level-1 plant (against the same month without the batch); a full store holds the line and nothing is lost; switched off it is refused; the live clock wakes for the next round and not for a full store.
- `missileProgramSim.test.ts`: Medium founds at least three programs in 24 months (6 on seed 5; Hard 15), bill under 12% of income.
- `src/ui/levelText.test.ts`: the six sections, Overview first; the line names interceptor rounds.

## Rivals offer ceasefires (`AI_TRUCE`, `src/data/missileWar.ts`)

`src/ai/missileTruce.ts`, called last in a rival's month (`bot.ts`), so a strike it orders that month holds it back. With `AI_TRUCE.on` off everything is as before (golden proof below).

- **When:** a Normal or Hard rival at war offers an enemy a ceasefire only when it would itself accept one from that enemy (`truceWilling`, the rule it answers by, so offering and answering agree). That rule now reads: the world on edge (tension at least `MW.truceTension` for the difficulty, times the personality's aggression held to 0.6..1.4: a merchant at 15 on Normal, an expansionist at 35), more lost than dealt in the whole missile war (as before), and with `AI_TRUCE.on` also under fire (struck within 3 months) with its interceptor store at a quarter or less, or with 2 or fewer missiles against an enemy holding 3 or more (`outOfMeans`), or losing the exchange with that enemy lately (more than 0.1 million killed by it in the salvos on record and a fifth more than it dealt back: `exchangeOf`). A player's offer to a rival is judged the same way (`truceAnswer(s, to, from)`).
- **To whom:** an enemy it is exchanging missiles with (either struck the other within 6 months), or, with the world on edge, one that holds 3 or more missiles. The enemy that struck it most lately first.
- **Never:** right after it escalated against that enemy (fired at it by its own order this month or last, from the salvos on record, or orders a strike, raid or warhead on it this month, or sets launch on warning this month; a doctrine's automatic answer does not count); while a ceasefire holds or an offer waits either way; on Easy.
- **To a player:** a `truce` offer through the normal offer path (`missileTruce` order, `truceByOffer` now also true for a rival offering a player), so it waits in Diplomacy with Accept and Decline and a news line, under the inbox limits of every rival offer (`canAsk`). At most one every 4 months from the same rival (`proposalMemory`), and none for 9 months after the player declined or let it lapse (`GameState.truceRefused`, optional, `"from>to" -> turn`, dropped once the wait is over; a player declining another player's offer is not recorded). A toast at the month end names the rival and says where to answer (`rivalTruceOffers`, `src/ui/missileWarText.ts`; turn games, live, online live), and the generic dispatch toast skips it so it is not said twice.
- **To another rival:** on the spot, as the older rule does, only when that rival would accept.
- **How often:** a rival with a reason offers on 60% of months (`AI_TRUCE.chance`, its own random stream `seed ^ 0x7c3e`), one offer a month at most.

## Rivals queue interceptor rounds (`MPROG.aiInterceptorLine`, `src/data/missileProgram.ts`)

`queueInterceptorRounds` in `src/ai/missileProgram.ts`, called every month from `bot.ts` after the country's management, with no random draws.

- **Who:** a Medium or Hard rival whose program has a production plant and the interceptor works and a store (shield or battery). Easy never. Needs `MPROG.interceptorLine`.
- **When** (`interceptorThreat`): struck within 3 months; or its store, counting rounds on the line, below half of what it holds; or an enemy holding 3 or more missiles with a launch site that reaches one of its 4 most populous countries (`launchSite`, the strike rule's own reach).
- **How much:** one batch filling the store's room counting the line (at most 20, at least 4), at the line price (75% of buying rounds), only within the program's guards: nothing while the program is being cut back (income in the red or the bill past a tenth of income), income of at least 6 a month, and the price plus 20 inside both the month's budget and the treasury less a reserve of 40 (the program's own per-order guard). It goes through the normal order path (`missileProgram` / `produce`).
- The missile war AI (`src/ai/missileWar.ts`) now counts rounds on the line before buying rounds outright, so the two do not pay twice.
- Half the store comes back free every month (`MW.regen`), so at planning time a store usually has room only after heavy fire; the line is used then.

## Tests for the rivals' missile behaviours

- `src/ai/missileTruce.test.ts` (20): each trigger (out of means: no missiles, an empty store; losing the exchange; more lost than dealt; the world on edge with an armed enemy; temperament), a calm winner offers nothing, offering and answering agree; holding back after its own salvo this month or last (and not after a doctrine's answer), a strike, raid or launch on warning ordered this month, a ceasefire in force, an offer waiting either way, Easy, switched off, the war off, dealings off; the monthly draw (45 to 75 of 100 months at 60%); the rate limits (4 months between offers; 9 after a decline, a lapsed offer counts, the memory dropped after; accepted holds; another player's decline not recorded); between rivals (only to one that would accept, made at once); the toast; old saves.
- `src/ai/interceptorLine.test.ts` (8): a full batch at the line price through the order path, no second batch over the first; each threat alone and none at peace, out of range or without room; Medium and Hard yes, Easy never (also through the whole bot); plant, works and a store needed; every money guard; switched off; the missile war AI does not buy what the line will make.
- `src/net/aiTruceOnline.test.ts` (4, MemoryHub): turns (the offer reaches the player at the month end on both screens, accepted makes the ceasefire; declined leaves none and the rival does not ask again the next month) and live (offered at the month end, accepted or declined at once, both screens agree).
- `src/engine/__tests__/aiTruceSim.test.ts` (sims set; `VITE_AITRUCE_SEEDS`, default 5): 24 months, bots in every seat (India's bot plays the player), Normal and Hard, in the natural world and in a world war of missiles (the eight most populous nations in two camps, each with a level-3 charter, a store, a shield and a program with a plant and works, the stores emptied).

| run (seed) | offers to the player (declined) | offers between rivals | interceptor batches (rounds, nations) | strikes and raids ordered |
|---|---|---|---|---|
| Normal (5 / 7) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Hard (5 / 7) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 2 |
| Normal, world war (5 / 7) | 1 (1) / 1 (1) | 5 / 0 | 3 (45, 3) / 2 (36, 2) | 11 / 10 |
| Hard, world war (5 / 7) | 1 (1) / 0 | 1 / 0 | 2 (36, 2) / 3 (54, 3) | 11 / 14 |
| Hard, world war, switched off, 12 months (5) | 0 | 0 | 0 | 8 |

Offers between rivals count both rules (the older one at high tension and the new one). Bounds: never two offers from one rival to the player closer than 4 months, at most 12 to the player in two years, a batch at most 20 rounds, at least one batch in the world war, none in the natural world.

- Goldens: only the small war moved (`19d872c4a61078` -> `33ccbe6b094dc`: a rival struck by the player's missiles, with none of its own, offers the player a ceasefire); its log and the Normal and Hard bot worlds did not (neither fires enough in its months). Proof: with `AI_TRUCE.on` and `MPROG.aiInterceptorLine` off (`withoutAiMissile`, 'rival ceasefire offers and interceptor lines are the only thing that moved ...') the pins `1ac09e89311c99`, `11eb593efb5a5a` and `19d872c4a61078` return exactly; `withoutGaps` now switches both off, so every older layer proof still passes.

## Not done / not verified

- No espionage operation to poach or steal from a rival program on purpose (poaching is passive, by the monthly roll).
- Rival interceptor lines (below) are checked by unit tests and a stressed sim in which programs were handed a plant and works; in a natural two-year world no rival program has both yet, so it has not been seen in an unstressed game. Medium rivals never build a plant or works themselves, so a Medium rival only queues rounds if it has them some other way (a save, a scenario).
- Rival ceasefire offers to a player are rare in the sims (about one in two years in a world war of missiles, none in a natural world, where barely a missile is fired). Their effect on a real player's game was not measured; the bot standing in for a player always declined in the sims (it is not under fire enough to want one).
- The toast for a rival's offer comes at the month end (turn and live games: rivals plan their month then); it was not checked in a running browser.
- Rival test launches make news only for players they touch (near, at war); a Hard world rarely shows them to a far-away player.
- The intel view of rival programs is not shown on the Diplomacy or country panels, only in this tab.
- Test arcs use the existing missile looks; a test's success or failure has no special impact effect on the globe.
- Balance is checked by the 24-month sims and the bill-share bounds, not by long human play; the numbers are first guesses in data tables.
- Two-player online was tested with the in-memory room harness, not across two real browsers.
- The test arc: see 'Test arc in a running browser' below.
- Medium programs stay small (an institute in two years): they found, but the sim's two years are too short for them to test.
- Upkeep and salaries are not shown in the Economy desk's forecast breakdown beyond the single "Missile program" line.
