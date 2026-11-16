# Space program: status

Branch: the SPACE worktree branch. Last merge of `claude/laughing-planck-9gjcru`: up to date (missile UI, aircraft development, missile-program research fix all in).

## DONE AND TESTED (src/engine/__tests__/space.test.ts, 47 tests, plus mutation checks)

1. Agency state (optional `Nation.space`, `GameState.space`; absent until used, proven by a test and by the unchanged golden pins except the Hard-bot world, see below)
   - Talent: engineers and astronauts, hire cost and monthly pay, capped by the workforce's engineers and scientists, drawn out of the factories' engineer demand (`extraEngineers` in people.ts), reserved while on a flight.
   - Experience: earned only by in-house flights (partial on failure), unlocks missions and mines, makes launches safer.
   - Rockets: five classes (sounding, orbital, heavy, deep, interplanetary), three development levels, built one per launch.
   - Launch infrastructure: launch site levels 1 to 3 (places = pads + the existing `spaceComplex` project level; pad 3 needs the project; the project also makes rockets 10% cheaper). Orbital Network: each level makes satellites 25% stronger and launches 2 points safer; reconnaissance satellites give intel on enemies and shorten the orbital strike recharge by a month each (two at most).
   - Monthly budget: one line `Space program` (staff, upkeep, building) and `Space mining` (income) in the economy report and Budget.
2. In-house vs outsourced: every mission has a side-by-side quote (price, months, odds, needs); a company costs a premium (2.1x of in-house cost times the company's price), builds faster, builds no experience, needs none. Four named companies plus a domestic firm; reliability, price and the heaviest rocket flown improve with the world's space industry (turn count and flights). Money paid feeds the home nation's technology sector (25% for your own firm, 6% abroad).
3. Missions ladder: nineteen missions in phases (build, launch, travel, arrive); two seeded rolls; failures lose payload and rocket, kill crew, cost standing and engineers, and give partial experience. Claims on four bodies (Moon, asteroids, Mars, Europa); a claim lapses when its owner falls. Outposts (three levels) and mines. Hard rivals race.
4. Samples and labs: five sample kinds, labs level 1 to 3, eighteen discoveries with prerequisites, samples, research and money, effects as data (rocket cost, reliability, transit time, upkeep, mining, outposts, output, factories, trade, health, a free technology).
5. Mining: five mines on the bodies, three levels each, 20 to 36 months to build, upkeep 0.9% a month of everything put in, yields of steel, oil, money, helium-3 grid power (and a bonus with the fusion plant). Starving the outpost (treasury in the red) silences then shrinks it.
7. AI: Medium rivals run a modest program, Hard rivals the whole ladder; every order must keep income positive, stay inside a share of gross and be covered by savings with a reserve. Tested with a driver on a small nation for 120 and 160 months.
8. Turn/live parity (a test runs a year in both) and old saves (a test deletes every space field and plays on).

## DONE BUT UNTESTED BY A UNIT TEST (checked by eye in a browser)

- The Space tab, its five sections, the HUD chip (`SpaceChip`) and the globe ring over the launch site, the confirm dialogs for claims and risky launches, the Palette entry.

## PARTLY DONE

- Day-by-day display in live mode: flights advance monthly like everything economic (so turn and live agree); the HUD chip and Missions bars show months left and are not animated per day.
- Aircraft and missile development: space connects to the Orbital Network and orbital strikes, not directly to the missile program or aircraft tree.

## NOT STARTED

- Nothing from the brief. Ideas left: a dedicated globe marker for a spacecraft in flight, contested claims by force, selling rare metals through the Market tab.

## Balance numbers (simulation, events off, small test nation, steel valued at 1.7, oil at 1.9)

- Final pass, outpost cargo plus the mine against a nation that stayed home, events off (months to break even, `finalAudit.test.ts` pins 85 to 170): moon rare metals 136, helium-3 125, water 95; asteroids rare metals 115, metals 121; Mars rare metals 141, water 98, metals 152; Europa water 160, volatiles 114.
- Changed to get there: helium-3 mine money 8 to 14, water mine oil 4.5 to 7, Mars richness 1 to 1.9, Europa 1.2 to 2.1. Before: helium-3 on the Moon 160 or more, Mars and Europa water never within 400 months.
- Also changed: a claim with no outpost lapses after 60 months (squatting), discoveries stack to at most +50% mining and +4% output, a home firm returns 15% of the price to the technology sector (was 25%, which made a flight at a mature industry as cheap as in-house).
- Outsourcing: satellites cost about 1.8 to 2.4 times the in-house marginal cost; the whole in-house ladder to a lunar landing costs about 3300 money over eight years in staff, development, pads, rockets and payloads.
- Hard-bot world golden hash re-pinned twice: only the space AI call moves it (verified by turning it off).

## Checks

Run on the merged tree; results recorded at the end of the work in the final report.
