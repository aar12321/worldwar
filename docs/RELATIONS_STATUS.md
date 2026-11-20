# Relations: status

The Relations desk (`O`) is a command center for how other nations feel about you: more ways to win a nation over than buying it presents, and ways to keep them. Code: `src/engine/relations.ts` (rules), `src/engine/relationParts.ts` (kept-up opinion lines), `src/engine/ties.ts` (trade, investment and peace lines, trust), `src/engine/relationsView.ts` (previews, reasons, health, needs), `src/data/relations.ts` (every number), `src/ai/relations.ts` (rivals), `src/ui/Relations.tsx` and `src/ui/Locate.tsx` (screens). Switches: `RELATIONS.on`, `TIES.on` and `DEALINGS.on` (the golden tests use all three).

All actions are one order, `{ type: 'relate', act, target, ... }`, with a cost, an effect, one cooldown per partner per act, a preview (`previewRelate`) and a refusal sentence. A player's act happens at once (turn and live alike, so there is no parity gap); a rival's runs with the month's orders (phase after Diplomacy). Rivals take only what their opinion of you allows, and say so before you try.

## How each way moves opinion

`+x (fade/mo)` is the opinion the partner gains and how fast it fades. Every gift is multiplied by a **warmth factor** (1 at first, down to 0.2 the more you gave that nation lately; the pool fades 8% a month), and the total all actions can have given one nation at any time is capped at 45.

| Way | Cost | Effect | Cooldown / notes |
|---|---|---|---|
| State visit | 10 money, 5 influence | +14 (0.9) | 12 mo. Needs their opinion above -25. Under -5: 30% protocol incident (-8). At 25+: 25% warm reception (+4). Seeded by the state, so undo cannot re-roll |
| Cultural exchange | 12, 1 | +9 (0.45), +30% between the same government | 9 mo |
| Festival | 20, 2 | +11 (1.1) | 12 mo |
| Diplomatic support | 3 influence | +7 (0.5) and a favour owed | 6 mo, only while they are in a dispute |
| Embassy | 15, 3; 0.8 money a month | opinion line 4 now, +0.35 a month to 10; their real numbers (intel); opens joint programs | 12 mo. Closing costs -4 and runs the cooldown, so open/close is no trick |
| Military attaché | 12, 2; +1.2 a month | second line 2 now, +0.35 a month to 6; opens exercises, training, basing | needs embassy |
| Student exchange | 14, 2 | +4, then +0.5 a month to 8; both +0.4 research a month for 12 months | 12 mo, needs embassy |
| Joint research | 22, 3 | +5, then +0.6 a month to 10; both +1.0 research a month for 12 months | 18 mo, embassy, opinion 5+, two at a time |
| Trade mission | 10, 2 | +7 (0.6); both +1.2 money a month for 12 months | 12 mo |
| Preferential tariffs | 5, 4 | +4; both +1.6 money a month for 24 months | needs a trade deal and an embassy |
| Joint venture | 30 to 200 each, 3 influence | both put in the same; both earn 1.2% of the stake a month, you also collect the normal dividend; opinion +6, then +0.5 a month to 10 | opinion 15+, embassy, partner must afford it, two at a time. Walking away: -6 and you keep half your stake |
| Aid in kind (food, oil, steel) | the goods, 1 influence | worth `amount x price x 0.25` (3 to 16) times 2.2 in dire need, 1.4 short, 1 ok, 0.4 flush; "Rescued us" in dire need plus a favour owed | 3 mo per resource |
| Forgive a debt | the payments | the deal's own thanks (+15/+18), plus a favour owed | |
| Share a technology | 6 research, 4 influence | +16 (0.6); they gain it | 18 mo, opinion 15+; they must have its prerequisites |
| Cede a border country | 12 influence | +24 (0.5), two favours owed; the country is gone | 36 mo, opinion 25+; not your capital |
| Joint exercises | 12, 2 | +8 (0.6) both ways | 10 mo, attaché |
| Arms sale | 4 steel, 1 influence | you earn about 22; +3 (+6 if they are at war) | 6 mo, needs arms exports on, friends only on "friends" |
| Training mission | 10, 2 | +9 (0.7), intel on their forces for 6 months | 12 mo, attaché |
| Intelligence sharing | 2 influence | +6; both see each other's numbers for a year | 12 mo, opinion 25+ |
| Basing rights | 4 influence | +10, then +0.3 a month to 8, for 24 months | pact or alliance, attaché, opinion 30+ |
| Join their sanctions | 15 influence | +10 (0.5) | 12 mo, they must be sanctioning the target |
| Joint war plan | 5 influence | +4, then a line of 3 now and +0.8 a month to 12; "Fought beside us" +10 afterwards | both must be at war with the enemy; 3 to 24 months; neither can declare war on the other; two plans at a time |
| Apology | 3 influence, 0 to 100 money | softens their worst grudges by 8 plus a fifth of the money; 60+ also withdraws a grievance | 12 mo, only if there is something to apologise for |
| Recognise their claims | 5 influence | +6, or +14 and a grievance withdrawn | 24 mo |
| Mediate | 5 influence | +8 from them, +5 from the other side; -2 war weariness for both if at war | 10 mo |
| Call in a favour | one favour | money +25, influence +4 or research +6 from them; they think -2 of you | 3 mo; favours last 36 months, at most 3 per partner |

**Keeping it up.** Treaty anniversary +6 (fades 0.5) every 12 months of a pact or alliance. Steadfast ally: +0.4 a month after a year, to 10. Neglect: with a pact, alliance, trade deal or embassy and no contact for 12 months, -0.8 a month to -10. Contact is any act, running program or (with ties on) running trade deal. Opinion modifiers fade on their own, so the desk shows "relations cool by X a month unless maintained" and when they would be merely cordial. A new line, **Same system of government** +2 (or **Opposed systems** -2, democracy against junta or one-party), applies to every opinion.

**Joint war plans.** Hits are recorded per plan. If the partner struck the same country in the same month (live: within 3 days) the second blow is a combined strike: the Defense Line drops a further 0.9. If either partner takes a country the other is paid `split` of its value from the taker's treasury. Plan partners share war-score credit like a faction's army. A strike window sets the country and, live, the day (both armies leave on the same day through the existing joint-strike clock). The plan ends with the war, on time, or when one side makes a separate peace (-10 from the other).

**Rivals.** Medium and Hard: each month a chance (22% / 40%) that a rival with 25 influence and 90 money to spare tends a friendship: plans with a friend that fights the same enemy, aid to a friend in dire need, embassies (three at most), visits, culture, research, students, trade missions, and (Hard) ventures. Easy: 2.5% a month, only a visit or food for a dire friend. Toward a player a rival asks: food or oil, a joint war plan against a shared enemy, a venture, a trade mission, a state visit, backing at the Council. A request lasts four months. Yes: they owe you a favour and +5; no: -1.5; ignored: -4. Easy rivals never punish either. A bot standing in for a player answers its own inbox.

## Ties and the starting mood (`TIES`, `src/engine/ties.ts`)

Players felt that most nations started out wary or hostile, and that trade, investment and partnerships counted for little next to war. Both were true. The audit (measured with `tiesSim.test.ts`: 8 player nations x 3 seeds, 174 rivals each, every rival's opinion of a new player in the first month):

| | ties off (before) | ties on (after) |
|---|---|---|
| All rivals: mean opinion of you | -0.35 | +1.30 |
| All rivals: wary or worse (-5 or less) / hostile (-25 or less) | 21.0% / 0.8% | 7.3% / 0% |
| All rivals by label | Neutral 51%, Cordial 28%, Wary 20%, Hostile 1% | Neutral 72%, Cordial 21%, Wary 7% |
| Neighbours: mean | -11.3 | -1.1 |
| Neighbours: wary or worse / hostile | 57.7% / 11.4% | 20.9% / 0% |
| China or India: "Fears your power" on every neighbour | -20 from month one (neighbours at -30 to -42) | none until 2 countries are taken |

The start is the same on Normal and Hard (difficulty does not enter the first month). What caused it, and what changed:

1. **Fear of a big nation from month one (logic error).** With the default goal (the whole world) `coalitionActive` fired when a player held 12% of the world's people, so China and India were feared by every neighbour (-20) before doing anything. Now size alarms nobody until the player has taken 2 countries (`TIES.fearAfterTaken`), and the line is -15. Reputation (infamy 60+) still alarms the world at once.
2. **Easy showed coalitions (logic error).** The bots gated coalitions by difficulty but the desk, the diplomat and the default opinion did not, so Easy players saw "Fears your power". `coalitionActive` now returns false on a difficulty without coalitions, whoever asks.
3. **The desk asked without the map (inconsistency).** The desk's default opinion called `coalitionActive` without the map, so the classic goal's "half the countries" test never ran there while the bots' did. It now passes the map.
4. **A permanent border penalty.** Every neighbour carried -6 (-14 for an expansionist) for ever, whatever the treaties or trade. Now -2 (-6 for an expansionist); none with a pact, an alliance or a shared bloc; halved by a running trade deal.
5. **Temperament skewed cold.** An expansionist was wary of everyone from the start (-6, the Wary line is -5). Now expansionist -3, opportunist 0, isolationist +2, honourable +4, merchant +5.
6. **Trade read as neglect (logic error).** "Neglected" (-0.8 a month to -10) counted a partner with a running trade deal as untouched, so a two-year trade partner felt neglected. A running deal now counts as contact.
7. **Investment thanks stacked (unbounded in practice).** Every `invest` order added +12 to one line that stacked to 60, so five small investments bought +60. The thanks is now +3, stacking to 6; the money itself is a lasting line (below).
8. **Gifts stacked.** A Diplomacy gift added up to +30 to a line that stacked to 60; it now stacks to 30.
9. **No double counting of ventures.** A joint venture's stake is also an investment record; it counts in the venture's line, not again in the investment line.
10. **A state visit warned of a protocol incident even with a friend.** The preview now warns only when they think poorly of you (under -5), and mentions the chance of a warm reception at 25+.

What the ties are worth now. Each is a line in "why they feel this way", worked out from the state with a ceiling, and the same between two rivals as toward you:

| Line | Worth | Ceiling | Ends or fades |
|---|---|---|---|
| Trade partners (a running trade deal) | 4, + its monthly worth at base prices x 0.1 (to +4), + 0.4 a month of unbroken trade (to +6); a renewal within 2 months keeps the run | 14 (was a flat 10) | when trade stops; "Honored our deal" +10 (fades 0.3) when a deal completes |
| Invests in our economy | +1 per 12 of your money in their businesses, outside ventures (investments amortise 0.6% a month) | 10 | falls with the stake; "Seized our investment" -30 if they nationalise |
| Invested in our businesses (thanks for each new investment) | +3 | 6 | fades 0.2 a month |
| Joint venture (a program) | +0.5 a month | 8 + stake / 40, at most 12 (was 10 for any stake) | ends with the venture; walking out -6 |
| Generous gifts (Diplomacy) | up to +30 each | 30 in all | fades 0.5 |
| Aid, rescue, shared technology, forgiven debts | as before (see the table above) | the 45 earned cap | fade |
| Faction partners (shared bloc) | +12 | 12 | ends with the bloc |
| Long peace (neighbours, or two nations that have fought) | +0.2 a month after 12 months without war | 5 | a war resets it |
| Border tensions | -2, expansionist -6; 0 with a treaty or bloc; halved by trade | | |

The negatives are unchanged: at war -50, declared war -40, attacked without cause, missile strikes, spies caught -25, broken pacts and deals -30 to -50, sanctions -25, border incidents. **Trust** is a separate reading (0 to 100, 50 untested; with `DEALINGS` on it counts in a rival's answer, below): treaty kept (+4, then +0.5 a month to 15), steady trade (+3, then +0.6 a month to 10), a deal honoured +8, an embassy +4, a shared bloc +8, a long peace (to 8); against it a reputation for aggression (infamy x 0.5, to -30), broken promises (0.6 per point of remembered betrayal, to -40) and war (-40). Labels: Trusted 70+, Reliable 57+, Untested 43+, Doubtful 25+, Distrusted.

State: `GameState.ties` (optional) keeps the last month each pair was at war and the run of trade per pair; absent until there is a war or a trade deal, so old saves load and a quiet game carries nothing. No new order: every tie comes from the existing ones (Diplomacy's trade, invest and gift offers, the desk's ventures).

**24 months later** (bots in every seat but an idle player; `tiesSim.test.ts`, more seeds by `VITE_TIESSIM_RUNS` and `VITE_TIESSIM_DIFF`), ties on / off:

| Game | Rivals wary or worse | Neighbours: mean, hostile | Alliances at the end | Wars declared in 24 months |
|---|---|---|---|---|
| Normal, Poland seed 1 | 12.5% / 21.7% | -2.9, 0% / -8.7, 11% | 58 / 56 | |
| Normal, Poland seed 2 | 9.9% / 22.0% | +0.3, 0% / -8.9, 10% | 55 / 48 | 36 / 34 |
| Normal, China seed 2 | 7.4% / 20.1% | +0.4, 0% / -28.7, 50% | 52 / 42 | |
| Normal, Germany seed 1 | 3.2% / 19.4% | +0.8, 0% / -8.6, 11% | 57 / 46 | 53 / 48 |
| Normal, India seed 1 | 0.6% / 20.0% | +3.4, 0% / -22.6, 25% | 57 / 48 | 40 / 52 |
| Hard, Poland seed 2 | 6.3% / 20.8% | 0, 0% / -11.0, 10% | 58 / 52 | 30 / 33 |
| Hard, Poland seed 3 | 6.8% / 19.7% | 0, 0% / -11.6, 10% | 43 / 52 | 39 / 52 |
| Hard, China seed 2 | 6.7% / 19.6% | +0.6, 0% / -29.1, 53% | 55 / 45 | |
| Hard, Germany seed 1 | 3.2% / 18.6% | +0.6, 0% / -11.3, 14% | 66 / 58 | 43 / 43 |
| Hard, India seed 1 | 0.6% / 20.9% | +3.4, 0% / -22.9, 22% | 61 / 57 | 42 / 56 |

The mood holds for a player who does nothing (from there it is earned either way). Rival to rival, the mean opinion rises from about 0.3 to about 1.5, and under 0.1% of pairs reach +-90. Alliances end about 10 to 20% higher (no nation holds more than 4), and wars are not more frequent: as many or fewer were declared in every measured game but one (Normal, Poland seed 2: 36 against 34).

## Gaps closed (`DEALINGS`, `src/data/relations.ts`)

One switch, `DEALINGS.on`, for everything here; with it off every rule is exactly as before (the golden proof below).

1. **Offers the world has overtaken are withdrawn.** `dropMootOffers` (`src/engine/offers.ts`) uses the same test the screens use (`offerIsMoot`: accepting it now would be refused for a reason the nation cannot fix; a shortfall of money or influence is not moot). It runs at each month's end, after treaties lapse and before offers expire (a pact that lapses this month makes a new pact offer possible again, so that offer stays), and in a live game after every order that happens at once (accepting an alliance withdraws the same nation's pact offer that day). Each withdrawn offer has a news line ("Germany's offer of a non-aggression pact to Poland was withdrawn: they are allies now.") and an `expired` dispatch. A moot offer on its last month no longer costs "Ignored our offer". A bot standing in for a player skips moot offers instead of answering them (the answer would only fail). The Diplomacy desk still shows offers that became moot during your own turn (before the month ends) under "no longer possible".
2. **Relations opens the exact composer.** The Actions tab (and a player's card) has Trade deal, Invest, Loan and Pact or alliance (Negotiate peace while at war); each opens Diplomacy on that nation with that composer open, scrolled into view and marked (`openDiplomacy(id, { compose })`, `diploCompose` in the store). The header's "Diplomacy →" still opens the nation.
3. **Trust counts.** Trust becomes a factor from -1 (trust 0) through 0 (50, untested) to +1 (trust 100) (`trustFactor`, `src/engine/ties.ts`), and each answer weighs it with a fixed weight (`DEALINGS.trust`): a pact's score ±10 and an alliance's ±12 (the dice are ±6); a guarantee ±10 and a loan ±15 points counted as opinion; a trade deal's price ±8%; a joint venture's opinion needed ±8 (`reception`). A refusal that distrust tipped says so ("your word counts for little with us"). Rival to rival the same rules hold. Diplomacy shows the answer before you ask (`offerOutlook`, read off `evaluateProposal` itself at its worst, middle and best dice): "Pact: Likely to accept · "peace with a strong neighbor is wise" · Trust 64 (Reliable) counts for you" under the treaties, the loan and the trade you have set up (the trust part only when it weighs anything). Plain investment needs nobody's consent, so trust enters investment through the joint venture.
4. **A long peace on an old save.** A save loaded without `GameState.ties` (made before ties) starts its record when loaded (`TiesState.since`, `startTiesRecord` in `normalizeGame`); a war going on then is recorded. No pair has a long peace (or its trust) until 12 months of the record have been seen, then it grows as usual. A new game, a save at month 1 and a save that kept its record are unchanged. (A game in which nobody has ever fought or traded also has no `ties`; loaded after month 1 it starts the same way, which only delays a long peace.)
5. **A missile ceasefire between two players.** The `missileTruce` order toward another player (both human) no longer asks for an AI's answer: it sends a `truce` offer through the normal offer path (`propose`), which waits in their Diplomacy inbox; accepting applies the usual ceasefire (`applyTruce`), declining is news. Offering twice is refused ("Awaiting their answer"), as is offering while they have offered you one. Turn games: it reaches them at the month's end and their answer counts at the next; live: at once. A bot standing in for a player answers as a rival would. Tested on the online MemoryHub (`src/net/missileTruceOnline.test.ts`: live accept, live decline, turns).
6. **Investment and the relations caps (decision).** The thanks for each new investment (+3, its own line to 6) now counts like any act of the desk: it goes through `warm` (worth less the more that nation was given lately) and counts toward the 45 that all acts together can give, and it is contact (no neglect) and a line in the partners' history (`thankInvestment`). Why: it was the one way to buy warmth outside the desk's caps, and an investment is a goodwill gesture like a trade mission. The money itself stays a separate lasting line ("Invests in our economy", up to 10), as trade deals and ventures are: it is a tie, not a gift. There is still no cooldown on investing: each investment is real money in their economy, and the thanks has its own ceiling.
7. **`relations-shots --two`.** Another player sat in the Neutral tier of the list and its counts (opinion 0), so the board read 125 neutral with the other player among them. Players are now their own tier and filter ("Players"), first after allies; the tiles leave them out. The player's card no longer says "send them an offer in Diplomacy" twice: it says they answer every offer themselves and offers the composer links.

**Measured** (`dealingsSim.test.ts`, in the sims set; `VITE_DEALSIM_SEEDS`, `VITE_DEALSIM_DIFF`): Hard, 24 months, bots in every seat, on / off.

| Seed | Alliances at end | Pacts made | Wars declared | Most allies | Trust among neighbours (mean, 5th, 95th) | Pairs where trust weighs anything | Pact or alliance answers trust changes |
|---|---|---|---|---|---|---|---|
| 1 | 59 / 59 | 9 / 9 | 44 / 44 | 3 / 3 | 51.3, 41, 53 | 11% of 1232 | 1.6% of 926 |
| 2 | 57 / 58 | 18 / 19 | 29 / 30 | 3 / 3 | 51.4, 40, 53 | 12% of 1244 | 3.0% of 940 |

The world stays coherent: alliances, pacts and wars move by one or not at all, nobody gathers allies, and trust tips 2 to 3% of answers between rivals, where it is near untested. It matters most where a record exists, which the sim's idle player never builds: a partner of long treaties, steady trade and an embassy, or one that broke pacts and is feared for aggression (the tests in `dealings.test.ts` show both directions; the effect on a real player's game was not measured).

## What is in the screens

Relations desk (`O`; phone: the bar). **Nations:** a list beside the open nation on a wide screen (one then the other on a phone, with "← Nations" to go back). Find a nation by name; sort by opinion (warmest or coolest), trust, trade value, strength (as your intelligence sees it), distance between capitals, cooling fastest or name; filter chips with counts (Players, Allies, Friendly, Neutral, Wary, Hostile, At war, Bloc, Trade partners, Neighbours, Watchlist; chips with nobody in them are hidden). The list is grouped by tier (At war, Allies, Friendly, Neutral, Wary, Hostile; long tiers show 8 until "Show all"). Each row: opinion, a trend arrow when it is moving, its label, chips (War, Ally, Pact, Bloc, Trade, Embassy, Neighbour, favours owed), the sorted-by number, Watch and Locate. With no nation open (wide screens): tiles for each tier that filter the list, the requests waiting, cooling partners, biggest trade ties and your neighbours, coolest first. **A nation** opens on its headline: status, temperament and bloc chips, Locate, Watch and Diplomacy; their opinion of you with its trend, their trust in you, and "Mostly because" with the three biggest reasons; a warning when relations are cooling or neglected. Then three tabs: **Why** (every reason in groups: treaties and peace, trade and investment, bloc, shared enemies, visits and exchange, aid and gifts, military cooperation, government and temperament, borders and power, grievances; what moves it each month; the trust breakdown; what they need and want, each with "Act →" to the action), **Actions** (a line saying trade deals, investment, loans and treaties are made in Diplomacy, with a button to each composer there; "Suggested now", up to three open actions, what they need first; then every group with how many of its actions are open, each row with its effect or the reason it cannot be done, its cost and its button), **History**. **Requests**, **Commitments** (embassies and their bill, programs and ventures, plans, favours both ways) and **History** tabs as before. **Locate** is on every row and card, in Diplomacy cards, Bloc members, the jump window, and Shift+L in the desk. Screenshots: `node scripts/relations-shots.mjs [--mode live] [--two]`.

Nothing here repeats Diplomacy: proposing trade deals, loans, investment, pacts, alliances, guarantees, sanctions, war and peace stay there. Forgiving a debt appears in both: here it also earns a favour.

## Tests

`relations.test.ts` (rules, caps, cooldowns, programs, ventures, aid, favours, plans, requests, upkeep, views, fuzz of malformed orders, old saves, turn/live parity, no-loop checks), `ties.test.ts` (every tie line and its ceiling, each fixed bug with ties on and off, trust, rows, the reason groups, old saves), `locate.test.ts`, `relationsSim.test.ts` (short always; long opt-in), `tiesSim.test.ts` (in the sims set: the starting mood and 24-month drift, on and off), `dealings.test.ts` (trust in each answer, its bounds, the venture, investment under the caps, old saves), `offers.test.ts` (moot offers withdrawn at the month end and live, not as ignored), `dealingsSim.test.ts` (sims set), `src/net/missileTruceOnline.test.ts`, `src/ui/diploCompose.test.ts`, `turnGolden.test.ts` (re-pinned; proof below).

## Goldens

The relationship layer first moved the Normal and Hard bot worlds (proof: with `RELATIONS.on` off the pins `6b42de15579c5` and `196fdf3f5c5b29` return). Ties moved all three state hashes (the small war's battle log did not): Normal `10cf7a356e2bea` -> `a0f8d651bfe97`, Hard `11d73d1672f834` -> `1879299a3721df`, small war `d077c31c237c4` -> `19d872c4a61078`. Proof: with `TIES.on` switched off ('ties are the only thing that moved the current pins', `withoutTies`) the previous three pins return exactly; `withoutBlocs` (and so `withoutRelations`) now switches ties off as well, so every older layer test still proves its own pins. The deployment test that pins a world from before these layers switches ties off too.

Dealings moved the Hard bot world only (the Normal world and the small war did not move): Hard `1879299a3721df` -> `1909d086a0093`. Proof: with `DEALINGS.on` off ('dealings are the only thing that moved the current pins', `withoutDealings`) the three previous pins (`a0f8d651bfe97`, `1879299a3721df`, `19d872c4a61078`) return exactly; `withoutTies` switches dealings off too, so every older layer test keeps its proof.

## Sims (Hard, 60 months, seeds 1 to 3, bots in every seat)

Measured when the relationship layer was added, before ties; ties have their own measurements above.

`VITE_RELSIM=hard VITE_RELSIM_SEEDS=1 npx vitest run src/engine/__tests__/relationsSim.test.ts -t long` (a seed at a time; each run prints a `RELSIM` line to stderr). With the rules on, then off:

| Seed | Acts by rivals in 60 months | Requests made / answered | Alliances at end | Most allies one nation | Opinion pairs (mean, 5th, 95th, at +90 or more, at -90 or less) | Opinion of the player (mean, 5th, 95th) |
|---|---|---|---|---|---|---|
| 1 on | culture 68, visit 60, embassy 33, plan 2, venture 1 | 38 / 33 | 51 | 4 | -0.3, -15, 10, 2, 0 of 1130 | 0.1, -12, 10 |
| 1 off | none | none | 42 | 3 | -1.1, -15, 6, 0, 2 of 1140 | 0.1, -8, 6 |
| 2 on | culture 63, visit 43, embassy 30, plan 3, research 1, students 1 | 29 / 26 | 60 | 4 | -0.2, -11, 9, 1, 0 of 1190 | 0.5, -10, 10 |
| 2 off | none | none | 49 | 4 | -0.5, -11, 6, 0, 0 of 1250 | 0.6, -6, 6 |
| 3 on | culture 50, visit 38, embassy 28, plan 1 | 27 / 25 | 49 | 4 | -1.3, -17, 10, 4, 2 of 1000 | 1.2, -10, 10 |
| 3 off | none | none | 57 | 4 | -1.2, -15, 6, 1, 3 of 1070 | 2.0, -8, 6 |

Opinions stay in range and nobody is pinned at the ends (at most 4 of 1000 pairs at +90, about as many as without the layer). Alliances end 49 to 60 with the layer, against 42 to 57 without: no runaway, and no nation holds more than 4. The 5th to 95th spread widens a little (the 95th percentile of opinion is 9 to 10 instead of 6): friends are warmer, strangers are not colder.

## Not done / unverified

- Diplomatic support does not yet change a World Council vote; it is goodwill plus a favour.
- Basing rights are trust and warmth only: no movement or reach bonus.
- Exercises and training give goodwill and intel, not drill.
- Preferential tariffs and trade missions give a small flat money bonus, not a route model; "open and close routes" is the mission's start and End.
- Ceding gives a whole country (the map has no strips).
- Mediation does not end a war.
- AI strike windows need both nations able to reach the same enemy country; otherwise they only share spoils.
- Gifts through a Diplomacy trade offer are still capped by their own ceiling (30), not by the 45 earned cap of the desk's acts (investment thanks now is: see Gaps closed).
- Trade and loans live in the Diplomacy desk: the Relations desk links to each composer there, and Diplomacy cards have "Build relations".
- Stock stakes in a foreign company do not exist in this game (shares can only be held in companies in your own territory), so there is no stock-stake line; foreign stakes are investments, which have one.
- A long peace starts counting from the first month of the game; a save from before ties starts it when loaded (see Gaps closed), so a pair that fought before that save gets no long-peace line for having fought (only neighbours do).
- AI rivals still never offer a player a missile ceasefire (they make one between themselves, and answer a player's); two players offer each other through the inbox.
- The acceptance odds are shown for pacts, alliances, guarantees, loans and trade offers, not for peace (its own screen shows the war score) or calls to arms.
- The tier threat of the coalition model (`threatOf`: a Superpower draws rivals together from its tier alone) is unchanged; only the opinion line "Fears your power" and `coalitionActive` are now earned.
- Online (several humans): relationship acts toward another player are refused and the card says so; checked in a two-human game on one machine (live screens), not over the network.
- Not checked: the Requests tab with a live request in a browser (covered by engine tests), screen reader behaviour, colorblind palettes.
