# Government desk: talent, cabinet, jobs, policies, interest groups

Status of the government work asked for as "add TALENT to the government and policies tab: working on policies and then hiring talent for jobs and employment numbers". Everything here is built, tested and in the Economy desk's *Government* tab.

## Where it lives

| part | file |
|---|---|
| every number, with what it means | `src/data/civics.ts` |
| rules (pure): talent, candidates, effects, jobs picture, groups, votes, orders | `src/engine/civics.ts` |
| the month end: scandals, resignations, drafting, votes, phasing in, brain drain, jobs history | `src/engine/civicsMonth.ts` |
| bots | `src/ai/civics.ts` (called from `ai/bot.ts`) |
| screen | `src/ui/economy/GovernmentTab.tsx`, `src/ui/economy/government/*.tsx` |
| tests | `src/engine/__tests__/civics.test.ts` (29), `turnGolden.test.ts` (layer proof) |
| screenshots | `node scripts/gov-shots.mjs [--mode live] [--out dir]` |

Hooks into shared files are one line each: `types.ts` (the `civics` order and `Nation.civics`), `orders.ts` (cost, check), `resolveTurn.ts` (describe, phase, execute, `runCivics` after the economy), `policy.ts` (the desk's policy effects), `people.ts` (`jobsParts`: unemployment causes as a list; health and schooling targets), `empire.ts` (admin capacity), `economy.ts` (three money lines, one stability line, missile engineers), `ai/opinion.ts` (the foreign minister's line), `migrate.ts` (repair on load), `registry.ts` (tab keywords), `Help.tsx`, `README.md`.

## The rules

**State.** `Nation.civics` is optional. A nation without it is exactly as before (every hook adds zero, and the economy's lines and stability parts are the same lists). A human nation is given a neutral desk at its first month end: no ministers, a Standard civil service, no reforms. That desk changes no number (tested: same net income, stability target, unemployment target, admin capacity, research, influence and factory income). Bots get one with their first order.

**Talent** (`talentSupply`, `talentReport`). Nine professions in thousands of people from the labour force (47% of the population): engineers, scientists and doctors are the people model's own skills; administrators (8%), economists (1.2%), diplomats (0.2%) and teachers (7%) are shares of the skilled workers times (0.6 + 0.8 × schooling); officers and spies come from the academy and the agencies. Demand per profession is listed by user: for engineers it is exactly the people model's demand split into industry, Frontier systems, national projects, the space agency and the missile program (the missile program now draws 0.15% of the workforce per level, only for a nation with a desk); for the others, the civil service, schools, divisions, agencies, bills being drafted and ministries' own staff. Brain drain (an 8% chance a month while emigration is above 0.03% a month) takes 4% of the professionals, up to 20%, healing 0.4 points a month. Talent visas add 10% or 20%.

**Cabinet.** Nine ministries, each with a profession. Three candidates per ministry are drawn from the game seed, the nation, the ministry and the year (`candidatesFor`), so nothing about them is stored until one is appointed and every client of an online game sees the same people; a new list every 12 months. Traits: competence 30 to 90 (up to ±10 for how well the profession is staffed), loyalty 25 to 95, corruption 0 to 60 (lower under an anti-corruption reform), popularity 15 to 85, one of five ideologies. A minister delivers `competence/100 × min(1, coverage of their profession)` of the ministry's effect (finance: 4% of income; interior: +2 stability, +1.5 admin; foreign: +0.6 influence, +6% trade, +5 opinion everywhere; defence: -8% upkeep, -15% weariness; health +3 pts; education +3 pts schooling, +3% research; labour -1.5 pts unemployment, +0.6 stability; industry +6% factories, +6% growth; science +8% research). Salary `0.1 + 0.12 × sqrt(population/10M) × (0.5 + competence/100)` a month (about 0.4 for Poland), three months up front. Corruption wastes up to 1.2% of income per minister. Month end: +0.25 competence (experience), loyalty ±1 with approval under 40 / over 60, scandal chance `corruption × 6%` (halved by an agency, a fifth by a purge): -3 × (0.5 + popularity) stability, -25 popularity, resigns under 25; loyalty under 25 resigns at 8% a month. Dismissing or replacing costs 2 stability plus 0.5 per 10 popularity over 50; a dismissed or resigned ministry stays empty a month.

**Civil service** (Lean, Small, Standard, Large, Vast). Public jobs 7% to 22% of the labour force; unemployment +1.4 to -1.8 pts; money -0.12 to +0.22 per unit of workforce a month against Standard; admin -1.5 to +2; services stability -1.5 to +1.4; private output +1.5% to -3%. Its gains are scaled by administrator coverage (a Vast service usually needs more administrators than a nation has).

**Jobs** (`employmentOf`, `jobsParts`). Labour force, employed and unemployed (the people model's unemployment), and employed by sector: military (25,000 per division), public (the civil service share), research (60% of scientists plus space staff), and the private rest split into farming (falls with development), industry (rises with factories) and services. `jobsParts` lists every cause of unemployment and sums, in the same order, to the old `jobsTarget` exactly (so the refactor moves no game). Human nations keep 36 months of the picture for the charts.

**Policies.** Seven areas with a neutral standard: tax reform, industrial policy, labour law, anti-corruption, central bank, digital government, talent visas (2 or 3 options each, every effect and group reaction in the table). Drafting costs 8 to 12 influence and 3 to 6 months of work, done at `(1 + 0.6 × minister power) × economist coverage (0.6 to 1.2)` months a month; then the vote a month later. Chance: base by government (parliament 55%, royal council 72%, military council 80%, party congress 88%) + 0.6% per approval point over 50 + 0.4% per stability point over 50 + up to ±25% for the weighted groups' feeling about the option + 8% per round of lobbying (6 influence, at most 3), held to 5%..97%. At most two bills at once, one per area. A passed policy phases in over 6 months; a failed one can be drafted again.

**Interest groups.** Business, labour, military, tradition, provinces, weighted by government (junta: military 2; democracy: labour 1.2). Each feels the ministers' ideologies, the reforms (by phase) and the civil service (the "choice" part, capped at ±25 each, moves stability by 0.06 per point × weight), and the times: taxes, unemployment, war, stability, unsettled land (shown, counted in approval, no stability). Approval = weighted satisfaction + 0.04 per popularity point over 50 of each minister.

**Bots.** Easy: never. Medium: every 6 months (when is fixed by the nation's name, no random draws), the best candidate for finance, labour or the interior when net income is over 10, money over 80 and the fee under a tenth of the treasury. Hard: every 3 months, the whole cabinet in order of need (defence first at war), the civil service up when unemployment is over 10%, down when under 5% or broke, one reform a year (anti-corruption if a minister is corrupt, strategic industry, digital government, an independent bank, skilled visas), lobbying a vote under 60%.

## Measured (Poland, Medium world, seed 3, 24 months, the player otherwise idle)

| plan | money at the end | net a month | stability | unemployment | research a month | officials can run | approval |
|---|---:|---:|---:|---:|---:|---:|---:|
| nothing | 737 | 29.8 | 75.3 | 5.38% | 3.7 | 9.1 | 51 |
| best finance, labour, interior, industry, science ministers | 743 | 30.1 | 73.3 (2 scandals) | 4.18% | 3.8 | 9.1 | 54 |
| Vast civil service | 685 | 27.8 | 76.8 | 3.58% | 3.6 | 10.8 | 53 |
| Lean civil service | 797 | 30.5 | 73.1 | 6.77% | 3.7 | 7.6 | 49 |
| ministers + Large service + strategic industry | 734 | 30.0 | 74.6 | 3.28% | 3.9 | 10.1 | 57 |

Reading: a good cabinet roughly pays for itself and lowers unemployment by a point, but corrupt picks cost stability; a big state buys jobs, calm and capacity for money; a lean one saves money and costs jobs and calm. Nothing runs away. A first tuning (salary 0.25 × sqrt(pop), finance 3%) left the cabinet 54 money worse off over two years, so salaries were halved and finance raised to 4%.

Bots (measured before the salary tuning): 12 months on Medium (seed 7): 29 nations with a desk, 37 ministers. 30 months on Hard (seed 5): 85 desks, 243 ministers, about 30 reforms in force (mostly strategic industry, some anti-corruption agencies and e-services), no civil-service changes (no Hard bot's unemployment passed 10%).

## Tests (`src/engine/__tests__/civics.test.ts`, 29, about 2 s)

Neutral desk changes nothing; switched off, a full desk changes nothing and orders are refused; humans get a desk, bots do not; unemployment causes sum to the target; candidates depend only on seed, nation, ministry and year; appointing pays the fee and the finance minister's money equals the formula; every minister moves its own number; replacing and dismissing cost stability and the vacancy holds a month; the foreign minister's opinion line; scandals happen and a purge makes them rarer; Vast hires and costs, Lean saves and idles; administrators limit a Vast service; the whole pipeline (draft months, vote, phase in over 6 months, effect at full phase equals the table); failed votes; lobbying adds exactly 8%; council beats parliament; limits; a better minister drafts faster; groups react to a flat tax; the group stability cap; talent with schooling, drain and visas; the talent report matches the economy's engineer demand and coverage exactly and each breakdown sums to its demand; missile engineers only with a desk; the jobs picture adds up at every service level; 15 kinds of nonsense orders are refused and a month with them still runs; `cleanCivics` repairs junk and keeps a good desk identical; old saves load without a desk and damaged desks are repaired; **turn and live parity** (six months, the same desk orders, every nation identical); **fuzz** (216 random orders over 24 months: no throw, finite numbers, stability in range, the desk always clean, at most two bills); bots by difficulty (Easy none, Medium and Hard appoint, the same plan twice, nothing when switched off).

**Mutation checks** (each change made by hand, the suite run, the change put back; all 15 fail at least one test): policies never phase in; the desk's jobs ignored; lobbying does nothing; brain drain ignored; corruption wastes nothing; the civil service hires nobody; the purge does not stop scandals; candidates change every month; no vacancy after dismissal; the switch ignored; missiles draw no engineers; Easy bots use the desk; group stability uncapped (the last two needed tighter tests first: the lobbying test now runs at a middling chance, and the cap test checks the exact capped sum).

## Goldens

`turnGolden.test.ts`: the three main pins move (bots now hire ministers and pass reforms, and the human nation carries a desk). Proof, as for every earlier layer: with `CIVICS.on = false` (`withoutCivics`, test "the government desk is the only thing that moved the current pins") the previous pins `1f72167c03ee2`, `1719b377e4ad6a`, `6be372c0f58e4` and the small war's log return exactly; every older layer test now also runs with the desk off (inside `withoutRelations`). And the small war (no bot reaches its desk schedule in three months) hashes to its previous pin once the human's unused desk is taken out: the desk adds only its own field.

New pins: Normal world `48f1aff68a4fa`, Hard world `144ef130064a5b`, small war `d077c31c237c4` (its log `d1dad457aab3c` unchanged). `deployment.test.ts`'s old-world hash switches the desk off beside the relationship layer, as it already did for that layer.

## Runs

`npm run test:fast` 1622 passed (two failures it found, the deployment proof and the value audit of `EMPLOYMENT` keys, were fixed and their files re-run green), `test:golden` 12/12, `test:sims` 113/113, `tsc -b` and `oxlint` clean. Screenshots: `node scripts/gov-shots.mjs` (turns) and `--mode live`, every section at 1440x900 and 390x844, no page errors in either.

## Not verified / limits

- A real two-browser online game was not played: online safety rests on every change being a normal order (`civics`) checked by `validateOrder` on whoever applies it, candidates derived from the seed (no client-only state), the turn/live parity test and the fuzz.
- Balance is measured on one nation for two years; the numbers are first-pass and all in `data/civics.ts`.
- The desk's stability line ("Cabinet and reforms", up to about +12 with an ideal cabinet, a Vast service, the calmest reforms and every group at its cap) now shares the one soft ceiling on care (18) with programs and projects when it adds: `deskStability` in `engine/society.ts`, behind `SOCIAL_RULES.deskShares`; what it takes away counts in full. Golden proof in docs/UX_AUDIT_NATION.md.
- The candidate draw changes only once a year; a ministry emptied by a scandal may have only weak candidates until then.
