# Strategy, scenarios and engine tuning

How the game plays: what the AI does and why, the scenario system, and the engine changes made for consistency. Every number
here comes from the measuring harness described below, so each change can be re-checked.

## 1. Method: how the game is measured

`src/engine/__tests__/strategySim.ts` plays whole worlds with the AI in every seat (the player's nation too) on the real
175-nation map, with surprise decisions switched off, and records what happens. `strategySim.test.ts` runs it only when asked for.

```bash
# one difficulty, four seeds, ten years (one process per difficulty uses one core each)
VITE_STRAT_DIFF=normal VITE_STRAT_SEEDS=1,2,3,4 VITE_STRAT_MONTHS=120 \
  npx vitest run src/engine/__tests__/strategySim.test.ts --silent=false
```

It prints one `STRATGAME {json}` line per game and a `STRATSUM {json}` line with the averages. If the player's bot nation falls,
the world carries on and the measuring does not stop.

What each metric means:

| metric | meaning |
| --- | --- |
| `aliveAtEnd` | nations still alive at month 120 (175 at the start) |
| `topHold`, `top5Share` | countries held by the biggest nation, and the share of the world held by the top five: the snowball check |
| `warsPerGameYear` | wars begun per year |
| `warMonthsMedian` / `Mean` | how long wars last |
| `decisiveShare` | wars that ended with a nation falling, a puppet, a war-score lead of 20 or more, or two or more captures |
| `idleWarShare`, `idleMonthsMedian` | wars that ended in a treaty without one battle, and how long they sat idle |
| `stalledPerGame` | wars with three or more battles, no capture and at least a year old |
| `warsOver24` | wars that lasted over two years |
| `attackWinRate`, `meanOdds` | share of attacks won, and the mean win chance the War Room's forecast gave them before they were launched |
| `lowOddsShare` | attacks launched at a forecast win chance under 40% (the suicidal ones) |
| `repulsedShare` | attacks thrown back without pushing the Defense Line at all |
| `riskyDeclarationShare` | wars declared by a side weaker than its target |
| `quietNations` | nations that never fought in ten years |
| `hoardMedian` | median months of income sitting in the treasury |

Each row below is the mean of four games (seeds 1 to 4, a different player nation each), 120 months.

## 2. The AI's strategic layer (`src/ai/strategy.ts`)

### What was wrong (measured on the code as it was)

- **Suicidal attacks.** On Hard 44% of attacks were launched at a forecast win chance under 40%, and 41% of them were thrown back
  with the line untouched. Hard's lower `attackRatio` made it the worst at picking fights. Medium: 26% and 24%.
- **Wars that were never fought.** A fifth of Medium's wars (a sixth of Hard's, 29% of Easy's) ended without one battle, after a
  median of 16 to 21 months: declared, then idle, holding a war slot and stopping pacts.
- **Stalled fronts.** Hard had 24 wars per game with three or more battles and no capture.
- **Declaring wars it could not fight.** The target list included nations only reachable across a sea lane the bot had no port on.
- **Hoarding.** Easy rivals sat on a median of 8 months of income; 21% held more than two years of it.

### How it works

Once a month each bot reads its situation (personality, rival skill, its power against its neighbors', its wars and war score,
money, restlessness, land it has lost) and takes one **posture**. The posture does not act by itself: it sets how eager the bot is to
start wars (`appetite`), how good the odds of an attack must be (`minOdds`), how much of the army it may send away (`maxCommit`),
how hard it presses for peace (`peaceDrive`) and how much it recruits (`recruit`).

| posture | when | appetite | extra odds needed | largest commit | peace drive | recruiting |
| --- | --- | --- | --- | --- | --- | --- |
| defend | outgunned, or behind on war score, or a far stronger land neighbor with a quarrel | none | +0.10 | half | 0.7 | x1.5 |
| revenge | lost land to a nation it can now answer | x1.4, only on that nation | -0.05 | all | 0 | x1.25 |
| consolidate | weary, restless, broke, or too much new land to settle | none | +0.06 | two thirds | 0.35 | x0.8 |
| turtle | isolationist, or hardly aggressive at all | x0.5 | +0.08 | two thirds | 0.4 | x1.15 |
| opportunist | opportunist or merchant temperament | x1, only soft targets | 0 | all | 0.1 | x1 |
| expand | otherwise | x1 | 0 | all | 0 | x1 |

Base odds by rival skill: Easy 0.72, Medium 0.62, Hard 0.55. Easy waits for a sure thing; Hard accepts a fair fight and has the
rest of its toolkit (counter-picks, missiles and shields, aircraft development, joint attacks, a richer economy, more recruits).
No bot has a hidden bonus: it uses `forecastAttack`, the same forecast the War Room shows the player.

What the postures turn into:

- **Targets by odds and value.** Attacks are chosen by trying the real forecast on the softest few countries (cracked lines first)
  with the smallest force that clears the bar, stepping up a commit only if it wins much more (concentration of force). The score is
  win chance x land value (capital counts extra) minus the divisions it expects to lose.
- **A reserve at home.** If another enemy is strong it sends no more than two thirds, or one third, of the army.
- **Follow-through.** A war declared is followed up at once (a 65% chance each month for the first two months), a cracked front is
  pressed (88%), otherwise a bot strikes now and then, more readily at a sure thing.
- **A second front** in the same month, for Medium and Hard on the offensive, against a different enemy, only at 85% odds.
- **Declaring wars.** A war is only declared if the target can be reached, no bigger hostile neighbor shares a land border, the bot
  is not already in a big war, and a forecast made on a copy of the state *with the war already declared* finds an attack worth
  making. A target already fighting someone else, or an enemy of an ally, counts as softer.
- **Peace.** Asked for when the bot is weary, behind on points, outgunned, in a war that has gone nowhere for 14 months, or ahead by
  25 or more (an expansionist rarely). Terms are the existing `peaceTerms` (land when winning, a payment when losing).
- **Rebuilding.** A bot that has lost a war takes the defend posture (more recruits, a defensive mix of guns, fighters and robots),
  and takes revenge once it can answer.
- **Units.** The mix is the long-standing one for attackers, and trades tanks and bombers for guns, fighters and robots on the
  defensive. Hard still counters the enemy's mix (fighters against planes and drones, guns against tanks, tanks against infantry).
- **Alliances** are only sought with nations of weight (a quarter of its own power, unless honorable) that are not already in a war
  with a much bigger nation it is not fighting.
- **Academy.** Medium and Hard fund a military academy when they have money to spare; any bot with over a year of income in the
  bank raises troops.

Determinism is kept: the only random numbers come from the bot's own seeded `rng`.

### Results

RESULTS_TABLE

## 3. Scenarios (`src/data/scenarios.ts`, `src/engine/scenarios.ts`)

A scenario is plain data: a title, a plain-words briefing, a goal, a suggested nation and rival skill, and a list of ops that
change a fresh world. `applyScenario(state, map, scenario)` runs the ops, so a scenario is deterministic and testable.
Standard applies nothing: `createInitialState` with no scenario (or `standard`) is bit for bit what it always was, which a test
checks. The picker is on the setup screen; the Briefing desk shows the scenario's briefing and progress.

Ops: `war`, `alliance`, `pact`, `puppet`, `sanction`, `guarantee`, `grudge` (opinion and a reason for war), `feud`, `treasury`,
`stability`, `weariness`, `military` (scale, weapon level, drill), `stock`, `techs`, `people`, `epidemic`, `crisis`, `rebels`,
`character` (personality, aggression), `market`, `missiles`. Nations are named by id or by role: `$player`,
`$neighbor:strongest|2nd|weakest`, `$top:n`, `$patron`, `$world`, and `{ first: [...] }` for "this country, or if the player is it,
that one", so every scenario works for any nation the player picks.

| scenario | what is going on | goal |
| --- | --- | --- |
| Standard game | the world as it is | hold the world |
| Two Blocs | two armed alliances, sanctions, proxy wars | usual goals (6 countries / 35% people / 16% output) |
| Small Among Giants | tiny country, a bigger hostile neighbor, a distant guarantor | survive 60 months |
| The Peaceful Builder | rich start, pacts, a calm world | 3.5% of world output within 120 months |
| The Arms Race | everyone armed, missiles stocked | usual short goals (3 countries / 25% / 11%) |
| A Neighbor Collapses | rebels, a crisis, an army that will not obey | usual short goals |
| The Resource Crunch | oil, steel and grain short everywhere | grow to a Regional power within 72 months |
| Plague Year | epidemic in you and your neighbors | survive 36 months |
| Strait Under Fire | Gulf allies against a big neighbor, oil price jump | usual short goals |
| The Rising Giant | a superpower with clients and a full treasury | usual goals (35%) |
| Two Fronts | at war on two borders and behind | survive 36 months |
| Powder Keg | small armed neighbors, a war and two crises | usual short goals |

Goals only a scenario has (survive, tier, economy; with an optional deadline that is a defeat) are checked in `humanStatus`
(`engine/victory.ts`); the top bar and end screen read the scenario's sentence through `goalSentence`.

Tests: `scenarios.test.ts` (the data, Standard is untouched, every op applies for the suggested nation, determinism, any nation can
play any scenario, the situation each briefing promises, the goals), `scenarioSimA/B/C.test.ts` (24 months of bots in every
scenario, invariants every year, no war or alliance between dead or opposed nations, and a nation that starts losing two wars asks for peace).

## 4. Engine tuning

ENGINE_TUNING

## 5. Re-running

- Metrics: the command in section 1. A baseline is any commit; copy the tree to a scratch folder, check out the old
  `src/ai/bot.ts`, and run the same command there.
- `npx vitest run src/ai/strategy.test.ts` pins the strategy layer; `src/engine/__tests__/staleWars.test.ts`,
  `eventsScale.test.ts`, `scenarios.test.ts` pin the engine and scenario changes.
- `turnGolden.test.ts` pins whole-game hashes. They move whenever the AI changes on purpose; check the change is the intended
  one (this document's tables), then re-pin and explain it in that file's comment.
