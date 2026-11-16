# War Room: status

The brief: this is a stats game and a strategy game. Give the player control of the war stage (choose exactly which units to send, with buttons), show a number for the probability of winning that follows every click, and let AI Battle Command do it automatically with deeper recommendations. Fix and fine-tune the combat engine so those numbers mean something.

## Done

### 1. Per-unit deployment

- `Order` attack has an optional `units?: Partial<UnitCounts>` (`src/engine/types.ts`). Without it nothing changes: `commit`, `share` and every old order and save work as before. With it the units replace the presets and the share.
- `src/engine/deploy.ts` holds every rule about "how many of what can I send": `attackPool` (the reserve after forces on station, units already named this month, orders already queued; a live game keeps its 10% home guard), `unitsProblem` (the check: no negative or non-number counts, never more than free, at least `WAR.minForce` = half a division, never missiles, which stay in `missiles`), `deployBill` (upkeep, oil and food of the force), `remainder` (what stays home), `shareOfPool` (the quick buttons).
- Plumbed through validate (`orders.ts`), describe (`Attack Poland with 26 infantry, 9 tanks`), execute for turn (`resolveAttack`/`prepareAttack`) and live (`launchArmy`: the army carries exactly those units), the store (`attack(..., units)`); the confirm rules needed no change (an attack asks nothing). `orderCost` is unchanged on purpose: sending units costs only the stance's launch fee; what the force costs to keep is shown, not charged twice.
- In a turn game soldiers stay in the military after a fight, so a unit sent by name is spent for the month (`Military.sent`, an optional field, cleared when the turn ends; absent unless the player names units, so saves and goldens are untouched).
- AI rivals untouched: bots still use presets.
- War Room (`src/ui/WarRoom.tsx`, `DeployPanel.tsx`): a stepper for every kind you own (`NumberStepper`: -, +, type, hold to repeat, Max, 0), quick buttons (None, Half, Probe, Main force, Max), the missiles to fire with the attack, the stance, free units per kind with attack/defence, what stays home, the monthly upkeep/oil/food of the force (`CostEffect`). Keys: M max, H half, N none, 1 2 3 stance.

### 2. Live win probability

- `src/engine/forecast.ts`: `forecastPlan` plays the real `resolveBattle` 256 times on evenly spread (Kronecker) dice, never touching the game's random streams. Same plan, same number; a small change moves it a little, not at random; about 7 ms per click on the slow test machine, memoised per state object (`forecastMemo`).
- Result: win chance, a range (how far the estimate could be off), the chance the country falls, Defense Line push, losses by kind for both sides, and `factors`: strength against defence, terrain, Defense Line, stance, combined arms, supply/oil/food, training/weapons/tech, garrison, air cover, missile support, defender reinforcement, landing penalty, surprise. Each has a one-line summary, a tooltip ("Why?") and a good/bad/neutral mark.
- Without AI Battle Command: a rough band (`roughOdds`) that always holds the real chance but never pins it down; the width depends on `intelQuality` (spies or Orbital Network, a war front, blind). The War Room, the stance cards and the Wars panel all show only labels and rounded guesses at level 0. Levels 1 to 3 show the exact number with its range.

### 3. AI Battle Command (`src/engine/commander.ts`, `src/ui/CommandCenter.tsx`)

- Level 1: exact odds, range, breakdown; `rankTargets` (win, losses, gains, risks per target); "Plan this attack for me" picks the best of the usual sizes.
- Level 2: also the stance (`compareStances`, the "AI recommends" badge) and written advice (`advise`: why this target, which force, soften with missiles first, the weakest front, when to wait, oil, food and war-weariness warnings, incoming enemy threats and what an attack leaves open at home).
- Level 3: "Plan this attack for me" fills the steppers from a bounded, deterministic search over compositions (`planAttack`: climb by the step that gains most per unit of cost, prune, swap) for a goal: best chance to win, fewest losses (by what the lost units cost to raise), fastest capture, keep home safe (share kept home). A what-if table puts the current plan against the recommended one. The standing **auto-command** (`planMonth`, store `setAutoCommand`/`planAutoCommand`): within the player's limits (most attacks, share of the reserve kept home, least chance to win, goal) it plans the month's attacks, never past what the nation may attack, and queues them in the order tray in green. Click one to cancel it before Next turn; switching it off takes them all out; it replans each new month.
- `systems.ts` text now says exactly this, and the tests check each level (`commander.test.ts` "levels unlock what systems.ts promises").

### 4. Combat tuning

The review (`combat.ts`, `warfare.ts`) found:

- **Odds were a switch.** The three rounds' dice average out: ten defending infantry were beaten 0% of the time by 11 attackers and 100% by 13. A forecast of "60%" would have been a lie. Fix: a fortune of the day, `COMBAT.luck` = 0.4 (one roll per side for the whole battle on top of the round dice). The 10% to 90% step is now three to four divisions wide (11 to 14 attackers against ten defenders).
- **Infantry strictly dominated.** Damage was shared out by division count, and a division of tanks (cost 31) soaks up as much as one of infantry (cost 11); a force fights by the square of its numbers, so three cheap divisions beat one dear one in every terrain and every dearer unit was a trap. Fix: `UnitSpec.toughness` (hit points per division: infantry 1, drones 0.8, artillery 2, strike aircraft 2, fighters 2.5, tanks 3, warships 3, robots 4.5); damage and the loss fractions in the win rule use it (`hitPoints`, `applyLosses`). Robots also attack at 1.8 (was 1.6).
- **Stances.** Siege won more fights, lost fewer lives and pushed the line nearly as fast as Assault: Assault was never worth choosing. Fix: Siege loses 7% fewer (was 30%), +4%/+10% to foot soldiers and guns (was +15%/+25%), pushes at 0.65 (was 0.7); Blitz loses 15% more (was 30%). Now Siege for foot and guns, Blitz for tanks and planes, Assault for the mix, and the three trade chance, lives and speed.
- **No double counting found** in: weapon levels (added once to attack and defence in `combatMods`), drill (once, as a multiplier), terrain (a per-unit effect for both sides, plus a flat defender bonus: two different things), garrison (counted once, fights beside the army and shares its losses), missiles (a unit in the opening round and a direct cut of the line: stated in their text), the stance's `ownLosses` and nano armor (different multipliers on different sides). Combined arms applies to the whole side's power in every round by design (the bonus is on the army, not on a round).
- Left alone on purpose: unit costs, upkeep, the Defense Line numbers, the economy. The `Strength` figures in diplomacy and the AI (`militaryPower`, attack plus defence over two) do not weigh toughness, so tanks look a little weaker to them than they fight; not changed because it would move every AI decision.

Cost-efficiency before and after: money (money plus steel at the market's base price plus soldiers) a pure force of one kind needs to win 50% of its attacks against a standard defence (10 infantry, 3 tanks, 2 guns, 2 fighters); lower is better. `combatMatrix.sweep.ts` (`printBeforeAfter`) prints all of it.

| Attacking | plains before | plains after | mountain before | mountain after | urban before | urban after |
|---|---|---|---|---|---|---|
| infantry | 243 | 276 | 253 | 289 | 234 | 276 |
| tanks | 407 | **291** | 848 | 818 | 669 | 607 |
| artillery | 386 | 382 | 631 | 661 | 488 | 493 |
| fighters | 569 | 566 | 690 | 704 | 697 | 715 |
| strike aircraft | 773 | 803 | 1262 | 1373 | 1069 | 1158 |
| drones | 189 | 240 | 248 | 314 | 235 | 303 |
| robots | 569 | **453** | 599 | 469 | 571 | 430 |
| combined arms mix | 267 | 277 | 350 | 363 | 319 | 328 |
| armoured mix | 309 | **281** | 451 | 449 | 401 | 390 |

| Holding (money to stop half of a standard attack) | plains before | plains after | mountain before | mountain after |
|---|---|---|---|---|
| infantry | 364 | 469 | 227 | 251 |
| tanks | 875 | **656** | 1130 | 806 |
| robots | 904 | **542** | 542 | **364** |
| drones | 536 | 787 | 423 | 617 |

Reading it: tanks now pay for themselves on open ground (291 against infantry's 276 on plains, 290 against 283 in desert) and stay poor in the mountains (818 against 289); a combined-arms or armoured army is as cheap as pure infantry on open ground (277 and 281 against 276) and clearly dearer in the mountains, so terrain decides the mix; infantry stay the cheapest way to hold ground; drones lose their near-free ride (189 to 240); robots are a premium unit (no soldiers, no war weariness) at 1.4 to 1.6 times infantry's cost instead of 2.3 times. Strike aircraft and fighters stay dear alone: their value is the air war and the bomber bonus, in a mix.

Win chance against ten defending infantry (plains), by attacking divisions: before 11: 0%, 12: 39%, 13: 100%. After 11: 14%, 12: 45%, 13: 80%, 14: 90%, 15: 97%.

### 5. UI

- A big chance to win (with range and a coloured track) at the top of the War Room and in the footer, a "What decides it" list with tooltips, per-unit steppers that work on a phone (390 wide), stance cards with their own odds, the AI Battle Command panel (goal, plan button, what-if, advice, ranked targets with `DataList`, auto-command), keyboard shortcuts. Screenshots at 1440x900 and 390x844 were taken and read; fixes from them: whole-division quick buttons, visible labels on the auto-command steppers, a clearer on/off switch, a rough label that matches the band.
- `Help.tsx`, `README.md` and the `systems.ts` text are updated.

## Numbers

**Forecast against simulation** (`forecast.test.ts`: 40 varied scenarios, terrain, stance, shares, named units, drill, weapons, oil shortage, shields, AI levels, missiles; most tuned by bisection to a contested fight): the forecast (256 runs) against 700 fights of `resolveAttack` itself on copies of the state with fresh dice: mean absolute error **0.74 points**, worst **3.1** (57.0% forecast, 54.1% simulated; the simulation's own noise is about 1.9 points at that size), the simulated value inside the stated range (plus 2 points of noise) in over 85% of the scenarios. At 4096 runs the forecast converges to within about a point of a 4000-fight simulation; 96 runs was not good enough (8 points off in one case), so the default is 256.

**Speed:** 256 fights of the real battle, about 7 ms on the shared test machine; a plan for one attack (bounded search, three stances) well under a second; ranking the targets a few hundred ms.

## Tests

- `deployUnits.test.ts` (units: validation, pool, queue, turn and live, spent for the month, determinism), `forecast.test.ts`, `forecastScenarios.ts`, `combatMatrix.test.ts` and `combatMatrix.sweep.ts`, `commander.test.ts`, `src/ui/autoCommand.test.ts`, `oldCombat.ts`.
- Mutation-checked (break the rule, see the test fail, restore): the pool check, the minimum force, queued orders counted, the live army taking exactly the named units, spending for the month, the fortune of the day, toughness, the stance numbers, the forecast's dice, its use of named units and its stated range, the auto-command's attack limit, its least chance to win, the keep-home share, the level 3 gate and the removal of auto orders when it is switched off.

## Goldens

Re-pinned, deliberately, for the combat tuning (and only for it): `turnGolden.test.ts` (normal-bot world `f204c70c0058a` to `11eb718f19436f`, Hard-bot world `9630530323146` to `18e8d940ed7c0f`, small war `1bb3d6aea64728` to `ac246a089dc1f` and its log `165393dceefdcd` to `17e9fe7b927733`) and the unstationed-forces hash in `deployment.test.ts` (`bc68beaeedca7` to `1be5266c50dfe5`). Proof: a test in `turnGolden.test.ts` puts the old numbers back (`withOldCombat`: no fortune, every division as tough, robots at 1.6, the old Siege and Blitz) and all four old hashes return exactly, so the per-unit orders, the forecast, the planner and the auto-command change nothing for a game that does not use them. `liveSim.test.ts`'s floor of battles in a year went from more than 10 to at least 8 (it got exactly 10): the AI picks slightly fewer fights now its forecasts are less sure.

## Not done, or not verified

- Auto-command is for turn games, offline. In a live game attacks launch at once (there is no month to plan), and online the plan is not shared with the room; the switch says so.
- The "Strength" bar (`militaryPower`) and the live bot's `forceStrength` do not weigh toughness.
- The rough band's fog uses three intel levels (war front, spies/satellites, blind); there is no finer model of what a nation has actually scouted.
- The planner optimises one attack at a time for the month (`planMonth` plans them in order, spending the reserve), not the best joint plan for several fronts, and it does not move units between attacks within a month.
- The forecast does not model the defender's response in the same month (reinforcement from other fronts, a counterattack); the breakdown names the one effect it does model (how much of their army is here).
- No automated browser test of the War Room; it was checked by hand with screenshots (1440x900, 390x844) at levels 0 and 3, not every level, and not in a live game.
- Balance of the bot games after the tuning (how often AI nations win wars, how long wars last) was not re-measured beyond the existing tests and the pinned games; the strategy and balance suites pass.
