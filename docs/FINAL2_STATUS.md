# Final pass 2: status

Branch worktree of `main` (5e1c123). Every rule below was mutation-checked (broken on purpose, a test failed, restored). Goldens (`turnGolden.test.ts`) are unchanged: all four pass with the original hashes, so nothing here moved an untouched game. All new state is optional (`liberationWars`, `Army.faction`), absent until used.

## 1. Puppets and bots: DONE

What changed (`src/ai/puppets.ts`, `bot.ts`, `ai/deployment.ts`):

- **Making puppets.** `wantsPuppet` decides whether a bot asks for the loser as a puppet instead of land. Never Easy. Medium needs war score 30 and may hold one puppet; Hard needs 25 and up to three (and never more than 1 + half its own countries; the loser's own puppets, which pass up with it, count against that). The loser must hold land worth at least 30 war score (not a tiny nation), earn no more than 1.25 times what the master earns, and neither side may be a puppet already. Before: Hard only, at war score 40, with no cap. Acceptance by a bot loser is unchanged (`score > 8`, else "we will never be your puppet").
- **Garrisons.** A Medium or Hard master posts troops in a puppet that is a land neighbour and below loyalty 60 (it keeps the post until 75 so it does not flap), as much as full cover needs (1.5 divisions per country of the puppet) out of at most 20% of its ground forces. Posted forces cost the normal upkeep; the pressure report names the garrison; the chance of the puppet breaking free is halved. A change of a puppet's garrison of 5% is worth an order (other posture changes still need 10%).

Simulation (all-bot worlds, the player's seat too, events off, 120 months, seeds 1 to 6; `puppetsBots.test.ts`, opt-in `VITE_PUPBOT=hard`):

| | puppets made, per game (6 seeds) | most held by one master | loyalty, lowest / mean over a life | tribute, share of master's gross (max / mean) | largest nation (countries) | loyalty at 0 |
| --- | --- | --- | --- | --- | --- | --- |
| Hard, old rules (net 40, no cap), seeds 1 to 6 | 4, 2, 2, 1, 6, 7 (22) | 2 | 30 / about 45 | 0.25 / 0.22 in one game | 11 to 19 | 0 months |
| Hard, new | 2, 1, 3, 3, 2, 3 (14) | 1 | 34 / 41 to 60 | 0.115 / 0.017 to 0.066 | 12 to 20 | 0 months |
| Medium, old | 0 in every game | 0 | | | 14 to 18 | |
| Medium, new | 0, 1, 0, 1, 1, 2 (5) | 1 | 54 / 56 to 61 | 0.047 / 0.01 to 0.04 | 14 to 18 | 0 months |
| Easy, new, seeds 1 to 3 | 0 | | | | 11 to 14 | |

- Loyalty never collapses: no puppet at 0 in any game, and the lowest loyalty in any life of a puppet a bot made is 34 (old rules: 30; a puppet passed up with a conquered master reached 22 in an intermediate run). Garrisoned puppets (a land neighbour, up to 48 months) averaged 47 to 60 over their lives and those across water 41 to 62: the garrison is a pressure of up to +0.8 a month and halves the chance of breaking free, but the measured means do not separate cleanly (the sample is 14 Hard puppets); the existing Hard rules (taxes down, tribute down, aid) do the rest.
- No tribute exploit: the engine holds all tribute to 25% of the master's gross (the rest at half). Measured peak over every master-month: 11.5% (Hard) and 4.7% (Medium) with the new rules. Before the richness limit one Hard master reached 34.7% (a small nation ruling a country richer than itself, with its puppets passed up): that is what the 1.25 limit and the inherited-puppet count are for.
- No snowball: the biggest nation holds 12 to 20 countries, the same range as before (11 to 19). Puppets are late (months 39 to 119), short lives are mostly conquest by a third nation.
- Goldens: no change (the 30-month worlds never reach the bar).
- Tests: `puppetAI.test.ts` (14: Easy never, Medium and Hard bars, the cap, the loser's puppets, richness, tiny nation, human master, valid terms; garrison sizing, cap, non-neighbour, order goes out, no flapping). Mutations: 7 killed, 1 equivalent (the Easy guard is duplicated by the cap of 0).

## 2. Puppet counting: DONE

`victory.ts` (`countriesTaken`, `economicShare`) and the scenario tier counter (`scenarios.ts`, now `empireCount`) use `countWeight` of `data/puppets.ts`: 0.6 loyal (75+), 0.35 restive (under 25), 0.5 otherwise, and exactly half for a puppet with no loyalty (old saves), as before. `puppetCount.test.ts` (6), 2 mutations killed.

## 3. Liberation: DONE

New peace term `PeaceTerms.liberate = <puppet id>`: the winner at war with a puppet's master sets that puppet free. Needs a cause: the winner declared the war under "Free X from Y" (recorded by `declareWar` in the optional `GameState.liberationWars`, cleared at peace), or the puppet cries out (loyalty under `PUPPET.liberate.below`, 20). Cost: half of what making the puppet cost in war score (`liberateValue`). Effect (`liberatePuppet` in `diplomacy.ts`): independent, loyalty and tribute cleared, the puppet's opinion of the liberator +40 ("Freed us"), at peace with the liberator if the master had dragged it into the war. Validation (`liberationProblem`): not a puppet of the master, not at war with it, the proposer is a puppet itself, no cause, war score. `describeProposal` reads it out. AI: Hard asks for it first when it has cause and the score (`liberationChoice`), Medium and Easy never; a bot master refuses it like a puppet demand when only just persuaded.
UI hooks, in `data/puppets.ts` as `LIBERATE_TEXT`: `term`, `short`, `hint`, `describe(puppet, master)`, `cause(puppet, master)` (the reason for war text, also used by `callForHelp`), `none`, `refusal`, `log`, `opinion`. Engine helpers for a screen: `liberablePuppets(s, holder, master)`, `liberationProblem`, `liberateValue`. The Diplomacy screen has not been given a control for it (not touched, as asked).
Tests `liberation.test.ts` (14), 7 mutations killed.

## 4. Faction joint offensive in live games: DONE (real army)

In a live game the pooled army now sets out on the 1st (the day the vote that declared the war passed, then every month it is home) as a real `Army` with the lead member's id and `Army.faction = { id, war, base }`, marches on the globe, fights on arrival through the same code (`fightFactionArmy`, shared with the turn game), and comes home. It cannot disappear or be duplicated because it carries a **copy** of the pool's soldiers: the pool keeps its units, and losses are charged to the pool when it fights and when it gets home (`settleFactionArmy`); nothing is ever added to a member's military. One army per faction at a time (a turn game's second attack of the month is not made in live). Safe against: recalls (`recallProblem` refuses, the live AI skips it), nation-force counts (`forceUnits` and `homePower` skip it), a home that is another member's soil (`holdsHome`), the war ending (it turns back, the pool is whole), the lead falling, a saved game (`normalizeGame` drops an army whose faction or war is gone; no soldier is lost with it). Turn mode is identical: `fight()` builds the same army and passes `exact`, the old code path, and all existing turn faction tests pass unchanged.
The old parity test (`factions.test.ts`, "turn and live months are the same month") compared the whole game after fighting, which cannot hold now that live fights days later with different dice; it now compares the vote, the declaration, who leads, the ledger and the wars between nations. `factionLive.test.ts` (9): launch day, copy of the pool, the whole march and the losses charged, another member's soil, no recall, peace turns it back, one at a time, saves, turn game untouched. 7 mutations killed.

## 5. Space in real play: DONE, no bug found

`spaceLong.test.ts`: a human-like script (hire, pad, develop and build the rocket the next rung needs, flights in ladder order, claims, outposts, mines, labs, discoveries) runs 120 months in a turn game and in a live game ticking day by day (3,650 invariant checks), events off, no rival acting. Checked: the two games are identical month by month (the whole state, bar live-only fields); `invariantProblems` clean every day; nothing non-finite in the nation or the world; the mines pay what `spaceYield` says (budget line "Space mining", steel and oil production against a twin with no mines); flights finish in live (11 launches, 2 failures, the moon outpost with two mines by month 120); a save from month 60 loads and plays on; old saves with no space fields were already covered (`space.test.ts`). Mutations killed: mining income doubled; (steel mining half: this run reached only moon mines, which make money and helium-3, so the steel flow stays guarded by `space.test.ts`, "mined steel, oil and money flow").

## 6. Nuke undo: DONE, decided

Finding: in a paused live game the launch is deterministic and no time passes, so an Undo could not reveal anything the launch did not already show; but Undo was also offered for missile salvos and orbital strikes, for attacks fought at once in a turn game (the battle report is a free look at the dice, undo and try another stance), and for offers a rival answers on the spot in a live game (a free look at the verdict). And an Undo of an earlier step would have carried a launch away with it. Rule (`undoable` in `orders.ts`, used by the store): no Undo for `nuke`, `strike` (any weapon), `attack` in a turn game, `propose` and `respond` in a live game. Such an order also clears the Undo stack (so an earlier step cannot be undone through it) and says "This cannot be taken back" in a toast. A live attack (an army that has not marched) and everything else keep Undo. Online had none already. `undoRules.test.ts` (7), 4 mutations killed.

## 7. Other unverified items from the status documents

| Document | Item | Result |
| --- | --- | --- |
| FACTIONS | live joint offensive not changed | DONE (item 4) |
| FACTIONS | store wiring from `factionNews` to toasts untested | DONE: `factionToasts.test.ts` plays a real vote into war through `endTurn` (mutation: removing the toast line fails it). The live-clock path (one more call) is the same function, not separately tested |
| FACTIONS | browser flows by eye only | NOT DONE (needs a browser) |
| SPACE | long real-play run | DONE (item 5) |
| SPACE | flights not animated per day in live | NOT DONE, by design (flights advance monthly in both modes so the games agree; confirmed by the live/turn equality above) |
| SPACE | Space tab, HUD chip, globe ring checked by eye | NOT DONE (UI) |
| SPACE | space not connected to missile program or aircraft tree | NOT DONE (design idea, not a gap in the brief) |
| SUPERPOWER | mutation checks not re-run in the final pass | DONE: 19 mutations of `nuclear.ts` against `superpower.test.ts`: 17 killed, 2 survived (no test said the answering nations carry a reason for war, or that building a warhead needs a factory); `superpowerExtra.test.ts` now guards both (both mutations die). The 19th pattern did not exist in the file (the called-off check is in `live.ts`, covered by "called off if the war ends") |
| SUPERPOWER | multi-seed statistics | DONE, 120 months, Hard, 6 seeds: no warhead was built or fired in any game (nukes need a Superpower and rich desperate rivals; Hard rivals reach it rarely), 43 to 68 nations alive at the end. Medium: none either. The rule behaviour is covered by `superpower.test.ts` and `superpowerSim.test.ts` |
| SUPERPOWER | nuclear card, reaction panel, globe arc by eye | NOT DONE (UI) |
| BORDERS | globe badges through the drawer on a phone; thin border lines | NOT DONE (UI) |
| BALANCE | Hard-bot spend on aircraft and missiles not measured | DONE (`botSpend.test.ts`, opt-in `VITE_SPEND=hard`): 120 months, 6 Hard seeds, 3 Medium. Hard bots: 71 to 114 aircraft developments a game (their money is paid month by month, not at the order), 3 to 12 missile fundings and 2 to 11 missile builds, 1 to 4 strikes; money at the order 0.2% to 0.5% of all bot output (about 1,000 to 4,200 over 120 months against a million earned). Space orders cost 750 to 1,500. Medium: space only (412 to 480, 0.05%). Nothing to rebalance |
| BALANCE | mutation-check of key regression tests | PARTIAL: the rules added here are all mutation-checked; the older balance regressions were not re-swept |
| BALANCE | visual pass in a late-game state; BALANCE.md aircraft section | NOT DONE |
| STRATEGY | Easy and Medium bots bank more cash; hoarding | MEASURED earlier in FINAL_STATUS (no hoard); unchanged |
| UX | shared widgets, animations, density untested; `Term` rarely used; text under 12 px | NOT DONE (UI) |
| VERIFY | pressing Remove on another online player; a real elimination | PARTIAL: `net/session.test.ts` already covers kick (host removes, the kicked seat is told, a guest cannot kick); the button and an elimination screen need a browser |
| FINAL | quiet nations | decided then: left alone; nothing new |

## Goldens

None changed. `turnGolden.test.ts`: 4 of 4 pass with the original hashes (the 30-month worlds never reach a puppet, a liberation or a faction war, and the new posture rule needs a puppet).

## Checks

- `npx tsc -b` clean. `npm run lint`: 10 warnings, all in UI files this pass did not touch (the same as FINAL_STATUS).
- One full `npx vitest run --testTimeout=120000` (the last thing run): 92 files passed, 4 skipped (the opt-in probes), 1 failed: `ai/tiers.test.ts` "only the top tier turns a crushing win into a puppet", which pinned the old rule that Medium never makes a puppet (changed on purpose in item 1). Rewritten for the new rule (Easy never, Medium at war score 30, Hard at 25, a tiny country or a puppet never) and re-run alone: 10 of 10. 1310 tests passed in the full run, 1 failed (now fixed), 18 skipped.

## Files

`src/ai/puppets.ts`, `bot.ts`, `deployment.ts`, `diplomat.ts`; `src/data/puppets.ts`; `src/engine/puppets.ts`, `diplomacy.ts`, `warscore.ts`, `victory.ts`, `scenarios.ts`, `factions.ts`, `armies.ts`, `live.ts`, `helpers.ts`, `militaryStats.ts`, `migrate.ts`, `orders.ts`, `types.ts`; `src/ai/liveBot.ts`; `src/store.ts`; README and the Help text. Tests: `puppetCount`, `puppetAI`, `liberation`, `factionLive`, `spaceLong`, `superpowerExtra` (engine), `undoRules`, `factionToasts` (ui); opt-in probes `puppetsBots`, `botSpend`.
