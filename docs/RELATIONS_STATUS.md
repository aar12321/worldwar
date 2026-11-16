# Relations: status

The Relations desk (`O`) is a command center for how other nations feel about you: more ways to win a nation over than buying it presents, and ways to keep them. Code: `src/engine/relations.ts` (rules), `src/engine/relationParts.ts` (kept-up opinion lines), `src/engine/relationsView.ts` (previews, reasons, health, needs), `src/data/relations.ts` (every number), `src/ai/relations.ts` (rivals), `src/ui/Relations.tsx` and `src/ui/Locate.tsx` (screens). Switch: `RELATIONS.on` (the golden tests use it).

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

**Keeping it up.** Treaty anniversary +6 (fades 0.5) every 12 months of a pact or alliance. Steadfast ally: +0.4 a month after a year, to 10. Neglect: with a pact, alliance, trade deal or embassy and no contact for 12 months, -0.8 a month to -10. Contact is any act or running program. Opinion modifiers fade on their own, so the desk shows "relations cool by X a month unless maintained" and when they would be merely cordial. A new line, **Same system of government** +2 (or **Opposed systems** -2, democracy against junta or one-party), applies to every opinion.

**Joint war plans.** Hits are recorded per plan. If the partner struck the same country in the same month (live: within 3 days) the second blow is a combined strike: the Defense Line drops a further 0.9. If either partner takes a country the other is paid `split` of its value from the taker's treasury. Plan partners share war-score credit like a faction's army. A strike window sets the country and, live, the day (both armies leave on the same day through the existing joint-strike clock). The plan ends with the war, on time, or when one side makes a separate peace (-10 from the other).

**Rivals.** Medium and Hard: each month a chance (22% / 40%) that a rival with 25 influence and 90 money to spare tends a friendship: plans with a friend that fights the same enemy, aid to a friend in dire need, embassies (three at most), visits, culture, research, students, trade missions, and (Hard) ventures. Easy: 2.5% a month, only a visit or food for a dire friend. Toward a player a rival asks: food or oil, a joint war plan against a shared enemy, a venture, a trade mission, a state visit, backing at the Council. A request lasts four months. Yes: they owe you a favour and +5; no: -1.5; ignored: -4. Easy rivals never punish either. A bot standing in for a player answers its own inbox.

## What is in the screens

Relations desk (`O`; phone: More sheet and the bar): Nations (search, sort, filters All, Watchlist, Allies, Neighbors, Rivals, Trade partners, My faction, Cooling; trend arrows; chips), a partner card (opinion, health meter with a decay warning, what is moving it each month, reasons grouped as shared enemies, trade, treaties, aid and gifts, visits and exchange, military, faction, government, border tension, bad acts, needs and wants, every action with cost, effect and why-not, history with them), Requests, Running (embassies and their bill, programs, plans, favours both ways), Log. **Locate** is on every row and card here, in Diplomacy cards, Faction members, the jump window ("Locate X on the map") and as Shift+L in the desk: it closes the desk, selects the capital, turns the globe, rings it three times and leaves a toast with **Back to desk**.

## Tests

`relations.test.ts` (rules, caps, cooldowns, programs, ventures, aid, favours, plans, requests, upkeep, views, fuzz of malformed orders, old saves, turn/live parity, no-loop checks), `locate.test.ts`, `relationsSim.test.ts` (short always; long opt-in), `turnGolden.test.ts` (re-pinned; proof below).

## Goldens

The Normal and Hard bot worlds moved (the small war did not): rivals now act in the desk and opinions carry the government line. Proof: with `RELATIONS.on` switched off, in the last-but-one test of `turnGolden.test.ts`, the previous pins (`6b42de15579c5`, `196fdf3f5c5b29`, and the small war's two) return exactly, and every layer test runs with it off too. New pins (after the merge with Territory and the +-2 government line): `1f72167c03ee2`, `1719b377e4ad6a`.

## Sims (Hard, 60 months, seeds 1 to 3, bots in every seat)

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
- Existing generic opinion boosts elsewhere (for example investing in a business, +12) are not under the new warmth cap.
- Trade and loans still live in the Diplomacy desk: each partner card has a "Treaties and trade" link and Diplomacy cards have "Build relations".
- Online (several humans): relationship acts toward another player are refused; the screen was checked in single-player turn and live games only.
- Not checked: the Requests tab with a live request in a browser (covered by engine tests), screen reader behaviour, colorblind palettes.
