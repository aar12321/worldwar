# Balance and integrity audit

Base audited: `c4d680f` (22 social programs and 7 campaigns, 17 national and 9 country projects with levels, rush and slots, the missile
program with four kinds, online play, the bots' use of all of it). Everything below was measured by running the real engine on the real
world map (`getWorld`, `createInitialState`); no number here is an estimate unless it says so.

**Verdict.** The new systems connect and make sense, and none of them is a money machine or a way to break the game. The audit found
**seven real defects** (one of them a stability exploit, one a plain bug that made a price free, one that let a shot-down missile keep
its effect) and fixed them with small rule changes and one data constant; it left everything it could not call a defect, and says why.
Bot worlds are healthy on all three difficulties for 120 months.

## 1. Method

| Step | What was run |
| --- | --- |
| Integration | Every Order type traced through the Order union, `orderCost`, `checkRules`, `describeOrder`, `PHASES`, `executeOrder`, `MONTH_END_ORDERS` and the store's `keptOrder` (now a test, section 6). Old saves, live against turn mode, online snapshots, two human plans in either order. A fuzzer feeds nonsense to every new order. |
| Long simulations | `balance.sweep.ts`: 120-month games, a bot in **every** seat (the player's too), Easy / Medium (`normal`) / Hard, seeds 11, 12, 13, on the real map, `nextEventTurn = 99999`. Sampled every 12 months; every 6 months `invariantProblems` ran. |
| Twin runs | The same quiet world twice (every other nation idle), one copy with a program or project already in force; compares treasury after 60 or 120 months, bills included. |
| Optimizer | A scripted player (France, with 0 / 14 / 30 extra countries to reach tiers 1, 3 and 4) that takes every program, project, level, rush, campaign and missile its monthly surplus allows, against Medium bots. |
| Missiles | Cost per point of Defense Line and per percent of army or people for each kind and shield level, against what a conventional attack costs in lost units. |
| UI | The real app in headless Chrome (puppeteer), loading a saved rich game: every desk, every Economy tab, all seven People sections and all Projects views, clicking raise, cut, start, rush and pause, then Next turn. 0 page errors, 0 console errors (the only noise is a 403 from an external font host the sandbox blocks). |

## 2. What the world looks like (bots in every seat)

Mean over seeds 11, 12 and 13, after the fixes. The base (`c4d680f`) gave identical Easy and Medium rows to the digit; Hard moved a
little because of fix 2 below.

| difficulty | month | nations alive | biggest nation, % of countries (worst seed) | world gross | median gross | in the red | in default | mean stability | below 30 | rebel regions | hold a program | hold a project | hold a country project | hold missile program | care, % of gross | projects, % of gross | open wars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | 0 | 175 | 0.6 | 3,766 | 12.9 | 0 | 0 | 65.0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Easy | 60 | 121 | 3.3 (4.0) | 5,960 | 28.5 | 2.3 | 0 | 60.3 | 0 | 0.3 | 0 | 0 | 0 | 0 | 0 | 0 | 24 |
| Easy | 120 | 77 | 6.3 (7.4) | 7,908 | 47.1 | 0.7 | 0 | 61.5 | 0.3 | 0.3 | 0 | 0 | 0 | 0 | 0 | 0 | 21 |
| Medium | 60 | 97 | 4.6 (5.1) | 6,396 | 32.2 | 1.3 | 0 | 59.5 | 0 | 0 | 8.0 | 10.7 | 0 | 0 | 0.4 | 3.2 | 29 |
| Medium | 120 | 51 | 7.6 (8.0) | 10,625 | 98.4 | 0 | 0 | 62.5 | 0 | 0 | 16.7 | 24.0 | 0 | 0 | 1.1 | 5.4 | 12 |
| Hard | 60 | 95 | 5.3 (6.9) | 7,418 | 33.8 | 3.3 | 5.3 | 58.6 | 1.7 | 0 | 12.7 | 16.3 | 7.7 | 2.0 | 2.8 | 8.2 | 32 |
| Hard | 120 | 44 | 10.6 (15.4) | 15,014 | 127.7 | 0 | 0 | 61.7 | 0 | 0.3 | 20.7 | 25.3 | 21.7 | 5.3 | 5.6 | 11.0 | 19 |

Reading it:

* **No snowball.** The biggest nation holds at most 15.4% of the world at month 120 (Hard), 8.0% on Medium, 7.4% on Easy. The brief's
  alarm line was 40% on Medium. Nobody reaches Superpower in 120 months on any difficulty (tiers at month 120, Hard: 33 Nations,
  11 Regional, 4 Great powers, 0 above), so Superpower and Hegemon balance is only ever exercised by a human.
* **No explosion.** World gross grows 2.1x (Easy), 2.8x (Medium), 3.5x (Hard) over ten years: 7.7%, 10.9% and 13.4% a year.
* **No collapse.** At most 3.3 nations of ~95 are in the red at any sample, and 5.3 in default at month 60 on Hard. The defaulters were
  inspected (Hard, seed 11, months 18 and 30): all are tiny countries with war bills of 10 to 18 against a gross of 5 to 12, with no
  program and no project at all. Nothing the audit covers causes it.
* **Use.** Easy bots use none of the new systems. Medium bots hold programs (calm only, on shaky nations) and the older projects. Hard
  bots add growth programs, the new projects and projects in their countries, and a few build the missile program (5.3 of 44 at month 120).
  Care costs 1 to 6% of the world's gross and projects 3 to 11%: a modest share, which is what the bots' own rules promise.
* **Missiles.** In 3 seeds x 120 months no bot fired a cruise, tactical or ballistic missile. Hard bots built 3 to 18 cruise and 6 to 9
  tactical missiles per world and fired 7 to 8 hypersonic ones in all. See section 4.4 for what that means.
* **Invariants.** `invariantProblems` ran every 6 months in every run: **no violation** (stability 0 to 100, program strength 0 to 3, whole
  levels, campaign counters within their months, project progress within its months, arsenal at least 0, the month's building within
  capacity, lines, rebels, population, integration, every resource a real number).

## 3. Player advantage: can a player who squeezes the new systems break the game?

### 3.1 Social programs: no loop

Money returned (change in the month's net, plus the program's own bill, over the bill) once a program is fully phased in. Above 1 would be
free money. France, Poland and a 12-country test map agree to within 0.06.

| program | level 1 | level 2 | level 3 |
| --- | --- | --- | --- |
| Courts and anti-corruption | 0.91 (Poland 0.97) | 0.83 | 0.74 |
| Public transport | 0.83 | 0.74 | 0.66 |
| Apprenticeships | 0.68 | 0.61 | 0.54 |
| Small-business loans | 0.59 | 0.53 | 0.47 |
| Mental health services | 0.48 | 0.43 | 0.38 |
| Workers' rights | -0.32 | -0.29 | -0.26 |
| Paid parental leave | -0.11 | -0.10 | -0.09 |
| the other 15 | 0.00 | 0.00 | 0.00 |

Over ten years with phase-in and knock-on effects (France, treasury after 120 months, program in force from month 1):

| program | level 1 | level 3 | research gained (L1 / L3) |
| --- | --- | --- | --- |
| Courts | 114% | 90% | +15 / +35 |
| Transit | 99% | 77% | +19 / +45 |
| Small-business loans | 92% | 69% | +15 / +34 |
| Mental health | 83% | 64% | +12 / +28 |
| Apprenticeships | 80% | 62% | +1 / +1 |
| Libraries | 18% | 14% | +9 / +21 |
| Scholarships | 2% | 2% | +26 / +60 |
| all seven together | 72% | 58% | +101 / +243 |

The best program returns about its cost, once, and each level up is a worse deal than the one below (levels cost in proportion and are worth
1 : 1.8 : 2.4). Courts at level 1 comes out 14% ahead in the ten-year run: a bill of 2.2 a month on a gross of 58, so +0.3 a month, after
paying influence for it. That is not a loop and was left. Stacking all seven growth programs returns 72%, because their effects share a
base. **All 22 at level 1 cost 54 to 69% of gross at every tier, at level 3 161 to 208%**: nobody can buy everything. (Section 5.)

Cutting and re-raising to harvest the phase-out (the bill stops at once, the effect fades by a quarter a month) gains nothing: effect and bill
both scale with the time spent in force, the cut costs 2 stability a level, and each raise costs influence. Campaigns cannot be spammed:
the cooldown counts from the start and is at least 1.5 times the campaign's length; running all seven at once only fills the shared stability
ceiling. The optimizer that took everything every month ended with a society bill of 91% of its gross (tier 3) and 97% (tier 4) and a
treasury of about zero: it was poorer than the same nation under a Medium bot (gross 764 against 948 at month 23, section 3.5).

### 3.2 National projects: sinks, not machines

Treasury after 120 months with a project finished from the start, less its upkeep (1% of everything put in, every month), as a share of what
it cost to build. 100% is break-even.

| nation (gross a month) | rail L1 / L3 | power grid L1 | broadband L1 | fusion L1 | digital government L1 | the other 12 |
| --- | --- | --- | --- | --- | --- | --- |
| France (58) | -55% / -94% | -61% | -67% | -81% | -103% | -13% to -120% |
| China (240) | 72% / -43% | **128%** | **101%** | 9% | -33% | -120% to 38% |

None pays back for an ordinary nation. For China the power grid and broadband at level 1 barely do; every level above the first is worse
(levels cost 1 : 1.6 : 2.4 on top of each other and are worth 1 : 1.6 : 2). Projects with percentage effects get better with the size of the
economy (a Hegemon earns several times the cost of the grid back), but that is a few thousand on an income of over a million in ten years,
so it was left. Their upkeep is the sink: all 17 at level 3 cost 998% of a Nation's gross and 44% of a Hegemon's.

### 3.3 Projects in your countries: the scale clamp is not an exploit

`localScale` is population to the power 0.6 over 12, clamped to 0.5 to 4, and cost and the flat yields use the same factor, so money, food,
research and trade per coin do not depend on where a project is built (a dam returns 1.75% of its cost a month before the 1% upkeep, a resort
2.2% in a country of development 0.5 and 3.3% at 1.0, whether in Luxembourg or in China). Only the yields that are shares, not flat amounts,
break that: **the cultural centre's stability (+0.3 a country, 0.6 at level 3) costs 55 in a tiny country and 440 in a huge one, and added up
without limit.** That was the one exploit (fix 1). Building then losing and regaining a country gains nothing: a half-built level is dropped,
a finished one stays with the land, the builder is never refunded and the conqueror never pays for what it did not build.
Slots cannot be bypassed: a paused project still holds its slot and its engineers, and orders in one batch are checked one after another.

### 3.4 Rush: the engineers could be ignored

A rush paid 4 months of a project's bill for 2 months of progress however few engineers there were. An ordinary month costs one bill for
`speed` months of work (speed = engineer coverage, between 0.4 and 1.1), so below coverage 0.5 a rushed month was **cheaper per month of work
than not rushing** and made the engineers irrelevant. Coverage was 0.59 to 0.72 while a Superpower or Great power was starting its first
projects (optimizer traces, section 3.5). Now a rush buys `2 x min(1, speed)` months, so a rushed month costs 1.67 times an ordinary one
at every level of staffing.

### 3.5 The optimizer, against a Medium bot playing the same nation

| run | month | tier | countries | gross | society bill | project bill | stability | treasury |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| optimizer, 1 country | 11 | 1 | 1 | 78 | 42 | 17 | 77 | 138 |
| optimizer, 1 country | 23 | 1 | 1 | 87 | 66 | 2 | 87 | 154 |
| optimizer, 15 countries | 23 | 3 | 15 | 764 | 698 | 74 | 91 | 70 |
| Medium bot, 15 countries | 23 | 3 | 17 | 948 | 0 | 0 | 56 | 6,123 |
| optimizer, 31 countries | 23 | 4 | 31 | 1,283 | 1,094 | 252 | 96 | 170 |

Money is the brake: the optimizer's society and project bills eat 91 to 100% of what it earns, so it grows more slowly than the bot, has
nothing to train an army with, and (having no defence) was conquered in 40 to 100 months. The Medium bot that does nothing but run its
country reaches a treasury of 159,000 at month 120 on 2,770 a month: **a Superpower or Hegemon at peace has more money than it can spend
unless it buys the sinks**, which is what they are for. An optimizer that spends its whole surplus without budgeting goes into debt in the
first month (the first version did, and lost 15 stability to debt). Stability ends at 87 to 96 for the optimizer (programs at their
ceiling) and 97 for the peaceful bot (technology gives +21); programs are not what pins stability high.

## 4. Missile balance

### 4.1 What each kind costs for what it does

| kind | build (money / steel / oil) | per missile | cap in one salvo | money per point of Defense Line, shield 0 / 1 / 2 / 3 | share let through, shield 0 / 1 / 2 / 3 |
| --- | --- | --- | --- | --- | --- |
| cruise | 6 / 1 / 0 | line 0.25, factories 1 month (3 must get through) | line 4 | 24 / 34 / 51 / 96 | 1.00 / 0.70 / 0.48 / 0.25 |
| tactical | 9 / 2 / 0 | army 0.6% | army 12% | n/a (15.0 / 18.8 / 23.1 / 30.0 money per 1% of army) | 1.00 / 0.80 / 0.65 / 0.50 |
| hypersonic | unit: 55 / 7 / 0.05 and 1.8 a month to keep, 15 a salvo | line 0.6, factories 2 months | line 8 | 92 | 1.00 / 0.80 / 0.65 / 0.50 |
| ballistic | 30 / 5 / 3 | line 1, 3 buildings per 9, people 0.4% | line 12, people 5% | 30 / 36 / 42 / 50 | 1.00 / 0.84 / 0.72 / 0.60 |

A conventional attack that wins pushes the line back 3.0 to 5.7 points at a cost of 6 to 25 money of units lost per point (even odds at the
top of that range), plus soldiers and war weariness. A cruise missile at 24 a point is about what an even fight costs and far above a
fight against a weaker army, and it needs no soldiers and risks none. It never finishes a country: a missile leaves a line at 0.5 at least
and a win in battle is still needed for the rest.

Monthly caps: 5, 10 and 18 missiles for program levels 1, 2 and 3. A full month of cruise missiles is 18 x 6 = 108 money for 4.5 points of
line; of ballistic, 540 money, 90 steel and 54 oil. Against Germany (line 11.1, army 11, gross 78, factory income 39): 36 cruise missiles
(216 money, two months of production at level 3) take its line to 3.1 with no shield and 7.3 behind a level-2 shield; 36 ballistic missiles
(1,080 money) take it to the floor and kill 9.8% of its people, and the world's opinion of the attacker with them (-12 from the victim, 3
infamy a salvo).

Shields **matter without nullifying**: level 3 stops 75% of cruise missiles but only 40% of ballistic ones, so the cheap weapon is the one
the defender can answer and the heavy one still hurts.

### 4.2 Defects found and fixed

* **Research price never paid.** `fundMissiles` checked 10, 25 and 50 research and then never took them: the generic order loop pays money,
  influence, soldiers and steel only. Fixed in `applyFundMissiles`; a test now checks every price validation promises is paid.
* **A shot-down missile still stopped factories.** One cruise missile (6 money + 15 to launch, no matter how big the salvo) stopped every factory in a country
  for a month, shield or no shield: Germany's factories are 39 of its 78 gross. Now the factories stop only if enough of the salvo gets through
  the shield (`factoryNeed`: 3 for cruise, one half for the rest, so hypersonic strikes are exactly as before).
* **A strike could heal a line.** `max(0.5, line - hit)` raised a line a battle had left at 0.2 to 0.5. Same in the hypersonic code in `warfare.ts`.
* **No ceiling on a stockpile.** Missiles in store cost nothing to hold and the program builds 18 a month: a nation at peace could pile up
  over a thousand and break every line of a neighbour in one month. The stores now hold 6 months of the program's production (30, 60, 108).

### 4.3 AI retaliation does not run away

Bots answer a strike only against a nation they are at war with that struck them in the last two months, with one strike order a month
(at most six missiles, from the stock they have). Two Hard rivals with 24 cruise missiles each, program level 2, trading blows for a year (test):
total fired never exceeds the starting stock plus what the program could build, and no nation issues two strike orders in a month. In the world
sweeps retaliation never fired at all, because nobody struck first.

### 4.4 What was left on purpose

* **Bots never open with cruise, tactical or ballistic missiles.** Their only "strike first" code reads hypersonic units (`units.missile`).
  A Hard bot at war with 40 cruise, 20 tactical and 6 ballistic missiles in store fired none in 24 months (4 Hard nations, seed 11). Missiles the Hard
  bots build are used only to answer. Making them open with cruise missiles on the front they attack is a one-line change, but it raises the
  threat to the player and belongs with the missile UI and the nuclear work.
* Arsenal missiles cost nothing to keep. With the ceiling above a stockpile is bounded; an upkeep would change bot games for little.
* The missile program UI does not exist on this base (the War Room offers only hypersonic units): a human cannot build or fire the new
  kinds yet. Other branches add it.

## 5. Economy sanity by tier

France with the nearest countries added (gross a month before any program):

| tier (countries) | gross | all 22 programs at level 1 / 2 / 3, % of gross | all 17 national projects at level 1 / 3, upkeep % of gross | all 9 country projects at level 1, everywhere, upkeep % of gross |
| --- | --- | --- | --- | --- |
| 1 Nation (1) | 58 | 67 / 135 / 202 | 200 / 998 | 23 |
| 2 Regional power (4) | 106 | 64 / 127 / 191 | 109 / 544 | 31 |
| 3 Great power (10) | 357 | 69 / 139 / 208 | 32 / 161 | 27 |
| 4 Superpower (25) | 616 | 62 / 123 / 185 | 19 / 93 | 33 |
| 5 Hegemon (60) | 1,315 | 54 / 108 / 161 | 9 / 44 | 36 |

Every tier has something to buy, none can buy it all. A Nation affords the first level of most programs (its net is 39 on a gross of 58, and
the 22 first levels cost 39) but not the national projects (the first level of all 17 would cost two years of its income a year in upkeep
alone, and only the seven open at tier 1 can be started). A Hegemon's net is about its gross (1,321 of 1,315), so level 2 of every program
(108%) is exactly what it can carry, and the national projects cost 44% at level 3. Nobody is pushed into bankruptcy by a bill they did not choose.

## 6. Defects found, ranked, and what was done

| # | severity | defect | evidence | fix |
| --- | --- | --- | --- | --- |
| 1 | high (exploit) | Stability from cultural centres in your countries was uncapped: 0.3 a country, 0.6 at level 3, 55 money each in tiny countries. 30 countries gave +18, 60 gave +36, past the ceiling on care that programs, projects and campaigns share. | 30 centres at level 3 moved the stability target from 61.4 to 79.4 | `economy.ts`: the part is `softCap(programs + local) - programs`, so one ceiling covers all of it. 30 centres now give 11.4, and almost nothing on top of full care. |
| 2 | high (bug) | `fundMissiles` never took its research price. | 10 / 25 / 50 research stayed in the treasury | `applyFundMissiles` pays it. Hard-bot golden re-pinned (section 8). |
| 3 | high (rule) | A cruise missile shot down by a shield still stopped a country's factories for a month, and one was enough. | 1 cruise vs shield 3: sabotaged 1 month | `factoryNeed`, see 4.2. |
| 4 | medium (rule) | A rush ignored the engineers and was cheaper per month of work than not rushing below coverage 0.5. | section 3.4 | `rushGain`: `2 x min(1, speed)`; the screen shows the figure. |
| 5 | medium (rule) | No ceiling on the missile stockpile. | section 4.2 | `storageMonths: 6`. |
| 6 | medium (robustness) | A damaged plan or a hostile friend online could stop the month for everyone, or poison a treasury with NaN: nonsense `project`, `unit`, `law`, `system`, `kind` or `proposal` threw in `validateOrder` or `describeOrder`; `setPolicy` with no draft rate and `propose` with no proposal made money or influence NaN. | a fuzzer over 40 order shapes x 11 garbage values per field | `validateOrder` refuses what throws and what prices as a non-number; `setPolicy` needs numbers; a throw while executing a human's order costs that order, not the month. |
| 7 | low (bug) | A strike could heal a line below half a point. | test | `min(line, max(0.5, line - hit))`, in `missiles.ts` and `warfare.ts`. |

## 7. Left alone, and why

* Courts at level 1 returns 91 to 97% steady-state and 114% over ten years. A profit of 0.3 on a gross of 58 for 5 influence is not a loop.
* National projects with percentage effects are worth more to a big economy. They are a rounding error on a Hegemon's income.
* The scale clamp of 0.5 to 4: money-per-coin is constant across sizes (3.3).
* Hard bots default at 5% of nations around month 60: small countries with war bills, not programs or projects.
* The globe's city labels draw over the Economy panel in one screenshot (cosmetic, not from this work).
* `store.ts keptOrder` accepts a strike whose `kind` is not a missile; the order is now refused when validated, so it only costs a message.
* A guest's immediate orders (builds, programs) are applied in click order on that screen and in phase order by the host. An order the host
  rejects (money spent in a different order) shows as done on the guest's screen until the month's result arrives. Within the rules of the
  trust-your-friends design; online results are identical on every screen because the host sends the whole game.

## 8. Tests and pins

New, all fast and deterministic except the two whole-game tests (about 25 s together on an idle machine):

* `missiles.test.ts` (27): the program levels, costs, capacity and storage; ranges; every kind's effect and ceiling; shields; live flights
  for each kind; AI retaliation and its bound; ranges of every count.
* `balance.test.ts` (23): no program returns more than it costs; a bigger level is never a better deal; the shared stability ceiling
  (cultural centres, all programs, campaigns, projects); the tier economy table above as ranges; no national project is a money machine
  for a Nation; rush scaled by engineers and never cheaper per month of work; every Order type wired in `PHASES`, `describeOrder`,
  `executeOrder`, `checkRules` and `keptOrder`; every promised price is paid; a damaged plan cannot throw or leave a number that is not a
  number; an online snapshot of a saturated state is 2 parts and comes back exactly; two humans' plans in either order; a Medium world after
  60 months has no nation above 25% of the countries and no violated invariant; an optimizer player keeps every number in range.
* `statecraftParity2.test.ts`: turn and live give the identical game over ten months of programs, campaigns, projects, rushes and missiles.
* `invariants.ts` gained `invariantProblems(state)` (stability 0 to 100, program strength 0 to 3, whole levels, campaigns, project progress
  against its months, arsenal at least 0, the month's building within capacity, lines, rebels, population); `checkInvariants` uses it.
* `projects2.test.ts`: two assertions changed on purpose (a rush now buys `rushGain`, not a flat 2 months).
* `turnGolden.test.ts`: the Hard-bot hash is `23ccc32ae6c50` (was `23d77e0bf045b`). Checked: with the research-price line put back the old
  hash returns, so the other fixes move no bot game there; the Normal-bot world and the small war did not move.

Run `npm run lint`, `npx tsc -b` and `npx vitest run` (the suite needs a machine that is not already busy: several older tests have
explicit 20 to 120 second limits).

## 9. How to re-run the sweep

`src/engine/__tests__/balance.sweep.ts` is not a test file and never runs in the normal suite. It exports:

* `runBotWorld({ seed, difficulty, months, player?, sampleEvery?, setup?, extra?, scripted? })`: bots in every seat. `setup` edits the
  starting world; `scripted` lists nations whose bot orders are dropped; `extra` adds orders each month (the optimizer's).
* `sweepWorlds({ difficulties, seeds, months })` and `printSweep(runs)`: the tables of section 2, plus missiles fired by kind, answers to
  strikes and every invariant violation.
* `twinSeries(state, map, nationId, months, orders?)`: a quiet-world series of gross, net, treasury, bills, stability, research, people.
* `optimizerOrders(state, map, nationId, options)`: one month of the optimizer's orders, budgeted so it stays out of debt.
* `freshWorld(seed, difficulty, player)`.

Call it from a throwaway test (the name `*.scratch.test.ts` is ignored by this repository's local git exclude, and delete it afterwards):

```ts
// src/engine/__tests__/x.scratch.test.ts
import { it } from 'vitest'
import { printSweep, sweepWorlds } from './balance.sweep'

it('sweep', () => {
  printSweep(sweepWorlds({ difficulties: ['easy', 'normal', 'hard'], seeds: [11, 12, 13], months: 120 }))
}, 3_600_000)
```

```bash
npx vitest run src/engine/__tests__/x.scratch.test.ts --reporter=verbose   # --reporter=verbose prints the console output
```

One 120-month world takes 30 to 40 seconds on an idle machine, several minutes on a busy one. Run seeds in separate processes to use more
cores. Program and project returns are `twinSeries` of a world with and without the program set in `n.social[id]` or `n.projects[id]`
(`done: true`), compared after 60 or 120 months with the bill added back; the tier table is `computeEconomy` on a state with everything set.

## 10. Re-check when the other work merges

* **Nukes.** `recentAttackers` makes the AI answer with whatever kinds are in stock, `MISSILE_TYPES` order: a nuclear kind added to
  `MISSILES` would be used in retaliation with no gate. Give it its own stock, program level, storage ceiling (`storageCap` counts only
  `PROGRAM_MISSILES`), `factoryNeed`, infamy and a rule for the AI. `missiles.test.ts` fixes the number of kinds at four; update it
  deliberately. Re-run the missile table.
* **Missile UI.** It must show `storageCap`, `buildRoom`, the validation text for full stores and the shield's share through (`getsThrough`),
  and use `buildMissiles`/`fundMissiles` through the store's immediate path.
* **Aircraft development and deployments.** `strikeHitsKind` kills a share of `military.units` and of `s.armies`: any new place units live
  (deployments, air wings) must be added there or tactical missiles skip them. `interceptFactor` applies to anything that flies.
* **Factions and the space program.** Any new source of stability must go through `softCap` with the programs' raw sum (or the ceiling is
  broken again); any new order must pass the wiring test; add new fields to `invariantProblems`; check the spaceComplex project and
  any new project against section 3.2's table (percentage effects favour the big).
* **Superpower and Hegemon.** Nobody gets there in 120 bot months; a human does. Re-run `optimizerOrders` with 30 and 59 extra countries and
  compare the bill with section 5.
* **Golden hashes.** `turnGolden.test.ts` pins whole bot games; each feature that changes bot behaviour must re-pin it with the reason.
