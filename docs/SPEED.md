# Speed: running the checks and the browser faster

The machine is 4 cores shared with browsers and other agents, so the aim is: do less, do it once, and never starve the box.

## Everyday commands

| command | what it does | typical time |
|---|---|---|
| `npm run check` | `tsc -b` + `oxlint` + `test:fast` | ~1-2 min |
| `npm run test:fast` | every test file except the long simulations and the goldens (`VITEST_SET=fast`) | 80 s under heavy load, less when quiet |
| `npm run test:changed` | only tests that import something changed since `HEAD` (`vitest run --changed`; `-- --changed origin/main` for a branch) | seconds |
| `npm run test:golden` | only `turnGolden.test.ts`, the pinned turn hashes | ~90 s loaded |
| `npm run test:sims` | only the long bot simulations (`VITEST_SET=sims`) | ~4-5 min |
| `npm test` | everything (run this before handing work over) | ~5 min |
| `npm run test:times -- report.json` | ranks slowest files/tests from `vitest --reporter=json --outputFile=report.json` | |
| `npx vitest run path/to/file.test.ts -t "name"` | one file / one test | |

Sets are defined by filename in `vite.config.ts` (`GOLDEN`, `SIMS`). A new long simulation file belongs in `SIMS`, so `check` stays quick. `test:fast` is a development convenience, not a substitute for the full run: the excluded files hold the balance and golden guards.

Knobs (env vars): `VITEST_WORKERS` (default 3: one core stays free for the machine; use 4 when it is quiet), `VITEST_TIMEOUT_MS` (default 120000, the one test and hook timeout), `VITEST_SET` (`fast`|`sims`|`golden`).
Sharding for two machines/sessions: `npx vitest run --shard=1/2` and `--shard=2/2`.

## Measurements (this container, 4 cores, other agents running)

| step | before | after |
|---|---|---|
| `tsc -b`, cold | 26-35 s | 26-35 s (unchanged, one pass over 400 files) |
| `tsc -b`, nothing changed | 27 s (every time: `.tsbuildinfo` held no program, `incremental` was off) | 0.7 s |
| `tsc -b`, small edit | ~27 s | ~7 s |
| `npm run lint` | 0.5 s | 0.5 s |
| `vitest run`, full | 975 s at load avg ~16 (117 files, 1 timeout failure under load) | 315 s at load avg ~5 (all pass). Different machine load: not a like-for-like speedup |
| `test:fast` (97 files, 1434 tests) | n/a | 81 s at load avg ~16 |
| `missileWarSim.test.ts` alone | 552 s (loaded) | 137 s with load ~7 (2 redundant 36-month sims removed, see below) |

Honest reading: other agents' load swings these numbers 3x, so compare within one run. What is certain: `tsc -b` no-op went from 27 s to under 1 s, the dev loop (`check`) no longer pays for the 13 long files, and a default 120 s timeout stops load-induced failures (the baseline run failed `bot.test.ts` "send the player at most one new proposal" at 30 s, 42 s under load).

The wall time of a full run is about `sum of file times / workers`, and the three biggest files (`missileWarSim`, `superpowerSim`, `turnGolden`) are a third of it, so more workers help more than any further tuning: `VITEST_WORKERS=4 npm test` when nobody else is running.

Things tried and rejected: `isolate: false` (vitest says ~5-15 s faster) shares module state between files, and the engine keeps caches (`getWorld()`) and the game uses module-level stores, so a leak between files would be a silent correctness risk; `pool: 'threads'` changes nothing measurable for CPU-bound sims. Splitting `tsc` into more project references is not trivial (the app config includes all of `src`), and the incremental no-op is already under a second.

## What was changed in tests (assertions untouched)

* `missileWarSim.test.ts`: `play()` is memoised on its arguments. The two Hard stressed-world tests each re-ran the same 36-month stressed Normal world (seed 7) as their yardstick, and that world is also the previous test; it is now played once. Mutation check: changing `.site + 2` to `.site + 20000` fails both Hard stressed tests (`expected 73 to be greater than 20006`).
* Per-test timeouts of 30 s and 60 s in `bot`, `simulation`, `scenarios`, `superpower`, `society`, `space` tests were removed so the shared 120 s default applies; larger explicit ones (120 s to 30 min) are left. No assertion changed in those files.
* Goldens (`turnGolden.test.ts`) are untouched and pass.

## Browser tooling

### `scripts/shots.mjs`
Starts one `vite` dev server on a free port (the game exposes `window.__store` in dev), launches Chromium with software GL (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, see `.agents/memory/webgl-verification.md`), opens a game and screenshots at 1440x900 (`desk-*.png`) and 390x844 (`phone-*.png`). Cleans up the server and browser even on errors. Needs `playwright` resolvable (found at `/opt/node-tools` or `/opt/node22`). It also skips the first-run help.

```
node scripts/shots.mjs --nation poland --seed 3 --mode turns --months 2 --out /tmp/shots --name after-2-months
node scripts/shots.mjs --nation poland --mode live --days 10 --scenario cold-war
SHOTS_URL=http://localhost:5000/ node scripts/shots.mjs --nation poland    # reuse a running dev server
```

As a library:

```js
import { withGame } from './scripts/shots.mjs'
await withGame({ nation: 'poland', seed: 3, mode: 'live' }, async (g) => {
  await g.advance({ days: 12 })          // turns mode: { months: n } ends n turns; live: steps days (month = 30)
  await g.dismiss()                       // Escape: closes the monthly report
  await g.page.evaluate(() => window.__store.getState().setPanel('economy'))
  await g.shotBoth('economy')             // desk-economy.png + phone-economy.png in g.outDir
  console.log(g.errors)                   // page errors and console errors seen so far
})
```

Region ids are the lowercase country keys (`poland`, `germany`, `china`). Default output is `node_modules/.tmp/shots` (or `SHOTS_OUT`). A run takes ~30 s on a loaded box, mostly vite warm-up.

### `scripts/merge-check.sh <branch> [base-ref]`
Merges `branch` into a throwaway worktree of `base-ref` (default `HEAD`) and lists conflicting files with hunk counts, plus the files both sides touched (likely semantic conflicts even when git merges cleanly). Never touches your working tree or index. Exit 0 clean, 1 conflicts. Use any ref as base to test branch-vs-branch: `scripts/merge-check.sh worktree-agent-A worktree-agent-B`. Note local `main` can lag `origin/main`; pass `origin/main` explicitly.

### `scripts/kill-stale.sh [--min N] [--yes]`
Lists vite / vitest / chromium / playwright processes older than N minutes (default 30). Prints only; kills (SIGTERM) only with `--yes`. Age is not proof of orphaning: another agent's dev server also shows up, so read the paths (each worktree has its own) before `--yes`.

## Caveats
* `test:fast` skips the files listed in `vite.config.ts`; those hold the golden hashes and the balance/AI guards, so run `npm test` (or `test:golden` + `test:sims`) before declaring work done.
* `--changed` follows the import graph; a change to data JSON or config read at runtime may not select the right tests.
* The 120 s default timeout hides a genuinely hung test for two minutes; use `--testTimeout=20000` when hunting a hang.
* Tables below come from a loaded machine; use them for ranking, not absolute numbers.

## Slowest 25 test files (seconds, full run)

| # | file | before (load ~16) | after (load ~5) |
|---|---|---:|---:|
| 1 | `src/engine/__tests__/missileWarSim.test.ts` | 552 | 209 |
| 2 | `src/engine/__tests__/turnGolden.test.ts` | 294 | 90 |
| 3 | `src/engine/__tests__/superpowerSim.test.ts` | 221 | 99 |
| 4 | `src/engine/__tests__/balance.test.ts` | 147 | 43 |
| 5 | `src/ai/tiers.test.ts` | 144 | 55 |
| 6 | `src/engine/__tests__/economyCurves.test.ts` | 142 | 53 |
| 7 | `src/engine/__tests__/simulation.test.ts` | 124 | 31 |
| 8 | `src/engine/__tests__/scenarioSimA.test.ts` | 121 | 32 |
| 9 | `src/engine/__tests__/scenarioSimB.test.ts` | 113 | 31 |
| 10 | `src/ai/bot.test.ts` | 100 | 35 |
| 11 | `src/engine/__tests__/warScoreSim.test.ts` | 99 | 36 |
| 12 | `src/engine/__tests__/presence.test.ts` | 74 | 13 |
| 13 | `src/ai/strategy.test.ts` | 68 | 9 |
| 14 | `src/engine/__tests__/scenarioSimC.test.ts` | 59 | 25 |
| 15 | `src/engine/__tests__/liveBots.test.ts` | 55 | 15 |
| 16 | `src/engine/__tests__/superpower.test.ts` | 46 | 9 |
| 17 | `src/engine/__tests__/deployment.test.ts` | 38 | 5 |
| 18 | `src/engine/__tests__/society.test.ts` | 32 | 4 |
| 19 | `src/engine/__tests__/saves.test.ts` | 32 | 10 |
| 20 | `src/engine/__tests__/scenarios.test.ts` | 26 | 8 |
| 21 | `src/engine/__tests__/forecast.test.ts` | 26 | 9 |
| 22 | `src/engine/__tests__/statecraftParity.test.ts` | 25 | 8 |
| 23 | `src/net/session.test.ts` | 21 | 16 |
| 24 | `src/engine/__tests__/liveSim.test.ts` | 20 | 6 |
| 25 | `src/engine/__tests__/space.test.ts` | 19 | 4 |

## Slowest 25 individual tests (seconds, baseline run at load ~16)

| # | test | seconds (load ~16) |
|---|---|---:|
| 1 | `balance.test.ts` whole games stay in range and do not snowball a Medium world after 60 months has no n | 133 |
| 2 | `missileWarSim.test.ts` the AI in the missile war Hard rivals run the whole war (seed 5), bounded: no runaway | 112 |
| 3 | `economyCurves.test.ts` the economy over years of play sixty months on Hard: every number in range, prices an | 99 |
| 4 | `warScoreSim.test.ts` the side that is ahead on war score ends up with more land over several seeds, bots i | 99 |
| 5 | `missileWarSim.test.ts` the AI in the missile war a stressed world war, hard (seed 11): bounded, and Hard use | 92 |
| 6 | `tiers.test.ts` a world of tiers easy rivals leave their cities and budgets alone; medium and hard ru | 81 |
| 7 | `missileWarSim.test.ts` the AI in the missile war a stressed world war, hard (seed 5): bounded, and Hard uses | 80 |
| 8 | `superpowerSim.test.ts` the world does not degenerate seed 21: 66 months of Hard bots on the real world: no b | 77 |
| 9 | `strategy.test.ts` the whole bot on the real world, Hard bots rarely launch an attack at poor odds (it w | 67 |
| 10 | `superpowerSim.test.ts` the world does not degenerate seed 22: 66 months of Hard bots on the real world: no b | 67 |
| 11 | `missileWarSim.test.ts` the AI in the missile war Hard rivals run the whole war (seed 23), bounded: no runawa | 64 |
| 12 | `tiers.test.ts` a world of tiers rivals ally with one another and form blocs on every tier | 63 |
| 13 | `missileWarSim.test.ts` the AI in the missile war Normal rivals defend and answer, with few raids, and nothin | 62 |
| 14 | `simulation.test.ts` pacing lets an idle player on Normal last about two years and keeps most of the world | 56 |
| 15 | `liveBots.test.ts` the AI attacks about as often live as in turns over a year and a half on the real wor | 55 |
| 16 | `bot.test.ts` bots play fair easy rivals leave the player alone early and never gang up | 54 |
| 17 | `turnGolden.test.ts` turn mode resolves exactly as pinned thirty months of Hard bots, with wars, battles a | 53 |
| 18 | `scenarioSimA.test.ts` scenarios play out (A) cold-war: 24 months of bots, no broken rule | 49 |
| 19 | `missileWarSim.test.ts` the AI in the missile war Easy rivals never use it | 48 |
| 20 | `turnGolden.test.ts` turn mode resolves exactly as pinned layer 3, the missile war added: presence switche | 47 |
| 21 | `turnGolden.test.ts` turn mode resolves exactly as pinned the combat tuning is the only thing that moved t | 46 |
| 22 | `missileWarSim.test.ts` the AI in the missile war Hard rivals run the whole war (seed 11), bounded: no runawa | 44 |
| 23 | `economyCurves.test.ts` the economy over years of play runs the same twice: the new systems are deterministic | 43 |
| 24 | `simulation.test.ts` full simulation runs 36 bot-only turns without crashing and keeps numbers finite | 43 |
| 25 | `bot.test.ts` bots play fair send the player at most one new proposal a month and keep the inbox sh | 42 |
