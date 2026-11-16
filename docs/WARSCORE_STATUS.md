# War score and "stronger but losing": status

Bug reports: "when the war score is clearly in my favor I am still losing" and, on a live game, "I am losing to smaller weaker nations even though my strength score is stronger".

## What was actually wrong

1. **War score was a tally that only grew** (`src/engine/warscore.ts`). Battle wins, kills and a flat +8/+14 per capture were added and never taken away: retaken land, rebels, a lost capital, old victories, none of it moved the number. Peace terms, the AI's "am I losing?" test (`ai/strategy.ts`) and peace acceptance (`ai/diplomat.ts`) all read it. Fixed: see "The model" below.
2. **Strength is not odds.** The Strength bar (`militaryPower`: units times (attack + defence) / 2) ignores the garrison, terrain, Defense Line, stance, the share of the force that goes, the defender winning ties (the attacker must also end 10% ahead) and the dice. Measured with the real fight (`forecastAttack`, 64 runs, equal mix of 6 infantry + 1 tank scaled):

   | your strength / theirs | probe (33%) | main (66%) | all in |
   |---|---|---|---|
   | 1.0 | 0% | 0% | 0% |
   | 1.5 | 0% | 0% | 78% |
   | 2.0 | 0% | 23% | 98% |
   | 3.0 | 0% | 98% | 100% |
   | 5.0 | 91% | 100% | 100% |

   In a live campaign (scripted human, re-attacking whenever its army is home, bot defender, Normal), 1.5x strength with main force: 0 battles won, 13 and 10 lost on two seeds, and the nation was wiped out by the "weaker" neighbor's counter-attacks (outcome `defeat`, 0 units, 0 countries). At 2x main: one seed won 3-1, one lost 12 in a row. All in at 2x, or main at 3x: won on every seed. So the engine is consistent (see "Checked and fine"); the number the player trusts is what misleads. Fixed in the UI and the docs: the country panel now shows "Strength is not odds" with the real chance of a main force and of everything (`outlookAt`, rough bands without AI Battle Command), and Help explains it.
3. **The live forecast overstated all-in.** `prepareAttack` used the whole reserve for an all-in forecast while `launchArmy` keeps a 10% home guard (`LIVE.homeGuard`), so the War Room promised an army that never marched (share 1.00 against 0.90, and named forces were not capped either). Fixed in `prepareAttack`; `liveForecast.test.ts` fails without it.
4. **Joint/faction wars:** a faction's army fights under its lead, so only the lead earned score and the other members showed 0 at the peace table. Fixed: members at war with the defender share the credit.

## The model (`WARSCORE.live`, `withOldWarScore` switches it off)

- Earned points per direction (battle wins +3, 0.6 per enemy division lost capped at 20 per battle, missile salvos) **fade 5% a month** (`fadeWarScore`, called from `runMonth`).
- Land is not stored as a score. `GameState.occupied` (optional) records "region -> nation it was taken from" at each conquest; the score counts +8 per such country (+14 for the loser's capital) **for as long as the conqueror holds it**. Retaken, seceded, ceded or the war ended: gone at once. A recapture erases the record. Nothing is stored that could drift.
- `GameState.warLedger` (optional) splits what each side earned into battles, casualties and missiles. `warBreakdown()` returns the parts (plus land and capital) that add up to the score.
- Net is `earned(a>b) - earned(b>a) + land held - land lost`, clamped to -100..100, so two sides at 100 earned no longer cancel a real lead.
- `warStanding()` is the separate "who is winning": score + army edge (log2 of the two strengths, capped at 18) minus home-front strain (stability under 35, war weariness over 25, rebels, no oil, no food) for each side. Verdicts: winning, ahead, even, behind, losing. Shown in the Wars panel and in Diplomacy with the reasons.
- Peace-table maths (`termsCost`, `validatePeaceTerms`) and the AI are unchanged: they read `netWarScore`, which now carries the land. Old saves load as they are (both new fields optional); their old capture bonuses sit inside earned points and fade.

## Checked and fine

- `resolveBattle` is symmetric; forecast and real battles agree: 120 live battles over 120 seeds, predicted 45.2%, won 47.5% (`liveOdds.test.ts`). Turn mode is covered by `forecast.test.ts`.
- Attacker/defender swaps, garrison counted once, losses applied to units named in the order, toughness, stances, weapons: no sign error found. Defender losses from a weighted (station) force are applied to unweighted counts, a small understatement of defender losses when forces are posted elsewhere; not changed (it would move every pin).
- No hidden bonus for bots (no difficulty term in `combat.ts` or `warfare.ts`). Bots do post garrisons (+35% on the border facing an attacker, `STATION.postBonus`), which the outlook includes.
- `humanStatus` / GameOver: "lost" comes only from true state (no countries, or capital gone with no army and no money to rebuild). Briefing text is static. The Diplomacy bar used to print "(winning)" from the score alone; it now prints the standing.
- Rebel fights never touch the score. A dead nation's score is cleared and no longer written to after the fight that destroyed it (`recordBattle`).

## Evidence

- `warScoreModel.test.ts` (15): retake swings, rebels, fade, capital, saturation, joint credit, old model behind its switch, breakdown, standing.
- `warScoreSim.test.ts`: bots in every seat, 36 months, 3 seeds, Normal. Leads of 10+ points that moved land within six months: 19, all for the leader. 137 winning/losing verdicts, all right. The old tally scored the same (31 of 31); bot wars rarely swing back, so the model's gain shows in the targeted tests above, not in this sim.
- `liveStrength.test.ts`: Strength is not odds; blind attacks at 1.5x lose more than they win; following the odds, 2x wins on every seed and is never wiped out.
- Mutation checks: decay 0, no conquest record, no joint credit each fail 1 to 6 tests.

## Goldens

All three pins in `turnGolden.test.ts` moved (new `occupied`/`warLedger` fields and fading scores). With `withOldWarScore` the previous pins return exactly, and every earlier layer test now runs under it, so their proofs stand.

## Uncertain

- Whether attackers needing about 1.3x (all in) to 2x (main) of the defender's strength is the intended balance. I left combat alone (it is tuned and the AI is calibrated on it); only the information was changed.
- The decay rate (5%) and the land values (8/14) are unplayed guesses.
- `warStanding` uses whole-force strength for the army edge, which has the same blind spots as Strength; it is a third of the verdict at most.
