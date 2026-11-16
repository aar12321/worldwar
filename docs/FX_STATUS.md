# FX status: the animation layer

Everything lives in `src/fx/`. Animation reads reports and state only: no engine rule, no golden and no save changed. No sounds.

## What exists

| Piece | File | State |
|---|---|---|
| Timing tokens and easing, one file | `timing.ts` (CSS mirror in `ui/ux.css`) | done |
| Pools: effects, flights, particles (typed arrays, ring, oldest overwritten) | `pool.ts` | done, tested |
| Quality tiers, caps, adaptive stepping | `quality.ts`, `settings.ts` | done, tested |
| LOD and clustering | `lod.ts` | done, tested |
| Engine: one clock, pooled effects, one draw pass | `engine.ts` | done |
| Flight maths (kinds, arcs, trails without allocation) | `flight.ts` | done, tested |
| Sprite drawing from the art pack with procedural fallback | `sprites.ts` | done |
| Missile, intercept, impact, salvo and nuclear scripts | `sequences.ts` | done |
| Marching armies, fleets, sorties | `armyFx.ts`, `formation.ts` | done (see weak spots) |
| Scorch, craters, embers, smoke, factory fires | `decals.ts` | done, tested |
| Overlay canvas and game wiring | `FxOverlay.tsx`, `runtime.ts` | done |
| Battle scene (canvas) and number ticker | `battleStage.ts`, `BattleScene.tsx`, `Ticker.tsx` | done |
| War Room formation preview | `FormationPreview.tsx` (in `DeployPanel`) | done |
| Settings: Effects quality (Auto/High/Medium/Low/Off), Follow the action | `SidePanels.tsx`, `settingsDefs.ts` | done |
| Perf harness | `harness.ts` (run by `fx.test.ts`) | done |

How it is drawn: one 2D canvas over the globe (`.fx-overlay`), points projected from the three.js camera without allocating (`view.ts`). Sprites come from the 13 atlases via `getArt`; when an atlas is missing or not loaded yet, a cached radial-gradient or ring stands in, and with Effects Off the old arcs, points and rings are drawn exactly as before.

## Budgets (hard)

| | High | Medium | Low | Reduced motion |
|---|---|---|---|---|
| Live particles | 300 | 160 | 60 | 0 |
| Simultaneous effects | 24 | 16 | 8 | 6 |
| Flights with a full trail | 32 | 20 | 8 | 0 (plain arcs) |
| Trail segments per frame | 300 | 240 | 100 | 0 |
| Armies as formations | 40 | 20 | 8 | 0 (badges) |
| Missile bodies per salvo | 12 | 6 | 3 | 1 |

- Over the cap the least important, then oldest, effect gives way, never to something less important than itself (nuke 100 > blast 60 > burst 50 > flight 40 > flash 20 > ring 10 > glow 5). Particles overwrite the oldest.
- Zoomed out (`lod.ts`): no particles, one clustered impact, tiny sprites skipped. A salvo that would not fit its slots is clustered into fewer, bigger blasts.
- The loop runs only while something animates (effects, particles, or flights/armies while the game clock runs). A moved camera or changed state draws one still frame. Hidden tab: no rAF at all, and the first frame back does not count the time away. Idle: nothing runs.
- Auto: average frame time over 26 ms for 1.2 s steps down a tier; under 18.5 ms for 8 s steps up (3 s minimum between steps). Frames over 2 s are ignored. Choosing a tier by hand turns Auto off. Reduced motion shows one flash and one ring.
- Effects already playing finish when the tier drops; the new cap applies to new ones.
- Screen shake is bounded to 1.6, only the first and last blast of a salvo shake, vignette at most 0.35 alpha.

## Measured

Software GL (SwiftShader) on a shared 4 core box cannot resolve GPU cost: the globe alone took 200 to 450 ms per frame, so frame rates here say nothing about a real device. What was measured is the JS side of the layer per frame (`performance.now` around update and draw).

- Headless harness (`npx vitest run src/fx/fx.test.ts -t "perf harness" --reporter=verbose`, a no-op canvas through a Proxy, which itself costs time, with a ballistic salvo of 12 and a nuke being replayed throughout): 0 flights 0.3 ms, 20 flights 1.2 ms, 120 flights about 2.1 ms average (p95 about 2.9 ms), at most 300 particles, 24 effects.
- Real canvas in Chrome, live game with synthetic flights injected into the state (`__store`), 6 s each: 0 flights 0.1 ms; 20 flights 3 to 6 ms (includes JIT warm up, only 14 frames got drawn); 120 flights 3.3 ms average, worst 8 ms. This is over the 2 ms goal: those frames compete with software-GL rendering of the globe for the same CPU, and only 13 frames were drawn, so it is an upper bound, not a typical figure. Not verified on real hardware.
- Leak check (60 salvos and 3 nukes, 30 s after): effect pool capacity stayed 48, 241 re-uses, nothing left over except the lingering nuclear glow, heap change negative (GC). No growth observed.

## Quality tiers, how Auto behaves

On the test box Auto fell to Low within a few seconds (frames of 300 ms or more), as it should. Pick High in Settings to override.

## How to add an effect

1. Add a kind to `K` in `engine.ts` and a case in `drawFx` (and `start`/`emit` if it spawns particles or shakes). Give it a priority in `PRIO`.
2. Use `engine.add(kind, {delay, dur, prio, lat, lng, a, b, c, d, color})`. Fields `a..d` are per-kind numbers; the pool object is reused.
3. Script it in `sequences.ts` as a function that only calls `add`, `addFlight`, `smoke`, `debris`, `embers`, `sparks`. Check `engine.freeSlots` and `impactPlan` if it can come in numbers.
4. Draw with `Painter.sprite(clipId, frame, x, y, sizePx, rot, alpha, tint, additive, squash)`; art ids are in `src/art/MANIFEST.ts`. Sizes are world units (globe radius 100) times `view.pxPerUnit`.
5. Wire the trigger from a report or state in `FxOverlay.tsx`. Never add state to the game for it.
6. Add a test in `fx.test.ts` (caps, reduced motion) and look at it: dev handles `__fxEngine`, `__fxSeq`, `__fxRuntime` (`freeze = true`, then `step(ms)` for exact frames).

## Not done / weak

- Nuclear sites leave no persistent mark across a reload (the glow lasts 24 s of wall time; there is no report to derive a decal from).
- Patrol boats and submarines on station do not have their own animated wakes: only sea invasions, sorties and marches do.
- The globe's plain badge stays as the click target under each formation.
- The battle scene is cramped on a 390 px phone and its sticky header covers the Defense Line title while scrolling.
- The `Ticker` is used in the battle window only, not yet in the Missile War or Economy numbers.
- Interceptors in live games are shown only for the last second, after the flight is gone (the report does not exist earlier).
- Colour-blind palette: trail colours come from the existing blue, orange, pink set, and each kind has a different trail strip (thick, thin, dashes, braided, zigzag, dots); armies' banner emblems differ (diamond yours, square others, triangle threat); icons carry their own outline shapes. Checked by reading the code and the shots, not with a simulator.
- Tested by eye in 1440x900 and 390x844 screenshots only; the follow-action camera was never captured moving.
