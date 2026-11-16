# Strategy, scenarios and engine tuning: status

Branch `worktree-agent-a0987d38156491fdc`, base `c4d680f`, already merged with `claude/laughing-planck-9gjcru` (missile UI, aircraft
development, missile-program research fix). Last audited at commit `ebff324` plus uncommitted docs.

## DONE AND TESTED

(A) AI
- Measuring harness `src/engine/__tests__/strategySim.ts` (+ opt-in `strategySim.test.ts`): whole 175-nation worlds with bots in every
  seat, metrics per game and averaged. Used for every number in `docs/STRATEGY.md`.
- Baseline diagnosis recorded (pre-strategy code, 4 seeds x 120 months). Hard: 44% of attacks launched at under 40% forecast win
  chance, 41% repulsed with the line untouched, 24 stalled wars per game, 16 to 21 month median for wars that never saw a battle;
  Medium 26% and 24%; Easy hoarded a median 8 months of income. World: 50 to 81 nations alive at month 120, top nation holds 9 to 16
  countries (no runaway snowball).
- `src/ai/strategy.ts`: six postures (expand, consolidate, defend, opportunist, turtle, revenge), forecast-based attack planning,
  war-target choice with reach/threat/distraction rules, a "could this war be won" forecast on a copy of the state, peace timing,
  unit mix by posture, follow-through after a declaration, second front, alliance quality. Small marked hooks in `bot.ts`.
  `src/ai/strategy.test.ts` (20 tests) pins each posture decision, plan/forecast agreement, reach, threat-behind, peace, units,
  determinism and a real-world Hard run. Mutation-checked: removing the odds bar, the reach check or the stalemate rule fails tests.
(B) Scenarios
- `src/data/scenarios.ts` (Standard + 11 scenarios, plain data), `src/engine/scenarios.ts` (`applyScenario`, goal lines),
  scenario goals (survive, tier, economy, deadline) in `humanStatus`, `goalSentence`, `goalProgress`; `NewGameOptions.scenario`.
  `scenarios.test.ts` (14 tests): Standard is bit-identical, every op applies for the suggested nation, determinism, any nation can
  play any scenario, the situation each briefing promises, goals. 24-month bot sims for every scenario in `scenarioSimA/B/C.test.ts`.
  Mutation-checked (survive off by one).
- Picker (`ScenarioPicker.tsx`), Setup row, Briefing section (`ScenarioBriefing.tsx`), end-screen text. Screenshots taken at
  1440x900 and 390x844 for the picker.
(C) Engine
- Late-game decisions scale with empire size (flat sums by sqrt of countries, gap 12 down to 6 months): `eventsScale.test.ts`.
- Wars nobody fights fizzle out after a year (AI vs AI): `staleWars.test.ts`. Both mutation-checked.

## DONE BUT UNTESTED

- Academy funding by Medium/Hard bots, hoarding rule (spend surplus on troops), second-front attacks: covered only indirectly by
  the long-run metrics, no focused unit test yet.
- Briefing and end-screen text for scenarios: not yet looked at in a browser (screenshots of the in-game Briefing pending).

## PARTLY DONE

- Re-measurement: baseline v4 (merged code, old bot) and new v5 runs (3 difficulties x 4 seeds x 120 months) are running; tables
  go into `docs/STRATEGY.md` (placeholders `RESULTS_TABLE`, `ENGINE_TUNING` still to fill).
- Golden hashes in `turnGolden.test.ts`: not yet re-pinned (they will differ because the AI changed on purpose).
- Missiles and aircraft in the AI: the merged code already retaliates and Hard develops aircraft; the strategy layer does not yet
  choose missile kinds by target or counter-pick aircraft developments.
- Scenario picker design polish (cards should show difficulty and goal at a glance).

## NOT STARTED

- Help.tsx entry for scenarios; README is updated (scenario paragraph, architecture lines).
- Missile-kind choice by target (tactical vs armies, ballistic only when worth it, cruise for harassment) and aircraft counter-picks.

## Checks at this audit

- `npx tsc -b`: clean. `npm run lint`: clean (0 warnings). `npx vitest run`: running in the background, result recorded below.
