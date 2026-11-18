# Blocs: status

The faction, redesigned as an **alliance bloc**. The request: "Not a big fan of factions. How can we improve this gameplay and make it amazing, high quality and fun?"

## Why the old faction was not fun

The faction was an LLC: a common pool of money, materials and soldiers with ownership shares, contributions and locked withdrawals, a charter, votes on every war and contract, and a pooled army that fought under the lead member's stats. Lots of bookkeeping (ledgers, claims, haircuts, exit fees), a decision every month that changed little on screen, and the joint war was mostly invisible (one battle a month in a log). Nothing pulled the members toward a shared goal.

## What it is now

One loop: **the bloc picks a target, everyone brings their own forces, they hit together, and the bloc grows stronger for it.**

| Piece | What the player does | Payoff |
|---|---|---|
| **Joint operations** (Operations tab) | Any member picks an enemy country and a D-Day; every member pledges divisions from its own army with per-unit steppers, seeing the live odds of the force | On D-Day the pledges fight as one force with **+8% per extra member** (combined arms). Live: the force sets out to arrive on D-Day, with a countdown and the march on the globe. A **joint battle report** shows each member's sent/lost/share; the country goes to who sent most; treasure split by what each sent |
| **Calls to arms** | When a member goes to war, the others get **Join / Decline** (one click, open to the end of next month). The leader can call the bloc against any enemy | Joining is a legitimate war (no reason needed, no blame) and gives prestige |
| **Season objective** | Each season (3 months) the leader picks one from the offer: take 2 countries, hold the line, defend a member, win an operation, grow, arm (+25%), outmatch the rival bloc | +40 prestige, +3 influence each |
| **Level and perks** | Prestige from objectives, wins, calls answered | Combined Arms (1), Common Market (2), Shared Research (3), Mutual Defence (4: rival members join a member's war at once), Joint Production (5) |
| **Roles** | One per member: Arsenal, Shield, Breadbasket, Spymaster | +2 steel / defend 10% harder / +3 food / +1 research a month |
| **Feed** | Everything the bloc did, plus member messages (chat goes through the order path) | Toasts and advisor items for calls, operations, objectives, levels |
| **The world** | The **Blocs** map (key `8`) colors every bloc (yours blue, at war with yours red); the Overview ranks your bloc against the strongest | Rival blocs are visible |

Nothing is pooled: every army and treasury stays its owner's. Leaving costs goodwill only.

## Rules and where they live

- `src/data/blocs.ts`: every number (`BLOC`), the perks, roles and objectives with their texts. `BLOC.on` switches the whole layer.
- `src/engine/bloc.ts`: state (`Faction.bloc`), levels and perks, objectives (`goalChoices`, `goalProgress`), operations (`opForce`, `forecastOp`, `runBlocOpsTurn`, `launchBlocOps`, `fightBlocArmy`), calls to arms, order rules (`blocProblem`), execution, the month (`runBlocMonth`), migration (`migrateBlocs`), news (`blocNews`, `blocDue`).
- `src/engine/blocCombat.ts`: what blocs add to a battle (Shield, combined arms) and the live army coming home (`shareBack`, `opArmyHome`), kept apart so combat and armies do not import the bloc rules.
- Orders (`types.ts`): `blocRole`, `blocGoal`, `blocCall`, `blocAnswer`, `blocPlan`, `blocCommit`, `blocCancel`, `blocChat`. Turn games: month-end orders, in their own phases (`blocCall` after `declareWar`, so a leader declares and calls in one month; answers, plans, pledges after). Live games: they happen at once (`LIVE_NOW`), online through the host like every live order.
- Turn games: an operation fights in the month resolution of its D-Day, after the month's attacks; the members' divisions leave and what survives returns at once, in the proportions each sent. Live games: it sets out on the day that makes it arrive on D-Day, marches as one army (`Army.op` carries who sent what), fights on arrival, comes home and is shared back. It cannot be recalled by one member.
- The old pool orders are refused with the new way to do it (`factionContribute`, `factionWithdraw`, `factionPropose`). With `BLOC.on` off the old faction plays exactly as before (all legacy tests run that way).
- AI (`src/ai/blocs.ts`): rivals join or found blocs around allies and nations fighting the same enemy (fewer new blocs the more there are), take the role that suits them, answer calls by opinion, strength and how busy they are, pledge most of their free divisions to an operation against an enemy they fight, and, as leader, invite, call the bloc to arms and plan an operation only where the force they would send has fair odds (Hard 40%, Normal 50%, forecast on fixed seeds). Never against a player in their grace months. Easy rivals never take part. Own random stream.
- UI: `src/ui/Bloc.tsx` (the desk: Overview, Operations, Members, Feed; the found screen), `FactionPanel` shows it when `BLOC.on`; the Blocs map in `Globe.tsx`/`MapModes.tsx`; advisor items in `advisor.ts`; wording on Diplomacy cards in `FactionLinks.tsx`.

## Old saves (migration)

`normalizeGame` calls `migrateBlocs` for every faction without a `bloc`: each pool resource and unit type is shared back to the living members **in proportion to what each had put in** (the ledger; equally if nobody had any of it), contract collateral goes back to the member, open votes and contracts are dropped, a pooled army on the march (live) is dissolved (its soldiers were the pool's, refunded above), and a line in the feed says so. It runs once (a faction that has its `bloc` is left alone). A damaged bloc in a save is reset to a fresh one. New factions get their `bloc` at founding, so every screen of an online game holds the same state from the first month.

## Tests

- `src/engine/__tests__/bloc.test.ts` (19): founding and the closed pool, the switch, planning rules, pledging rules, a turn-mode operation end to end (one force over the leader's border, combined arms in the report, losses per member match the report, country to the biggest sender, prestige), a member not at war is left out, combined-arms scaling and forecast, a live operation (sets out in time, arrives on D-Day, fights once, survivors shared back, conservation), no recall, calls (auto call on a new war, join/decline, prestige, leader-only rules, Mutual Defence), roles (unique, income, Shield factor), perks (Common Market at level 2), objectives (auto start, leader choice, conquer met with rewards, defend failed), the feed, migration (ledger shares, collateral, once only) and damaged saves.
- `src/engine/__tests__/blocFuzz.test.ts`: 6 seeds x 120 random orders (good and bad) with months in between, and 4 seeds of live games; nothing throws, no negative or NaN divisions, roles unique, at most two open operations, pledges only by members, bloc orders alone never move a division.
- `src/net/liveBloc.test.ts`: **two humans online in a live room** (MemoryHub): the host plans, both pledge through `sendCommand`, both screens get each pledge, a forged pledge for the other nation is refused, the clock runs, the force marches and arrives on D-Day, both screens hold the same report and fingerprint.
- `src/net/session.test.ts` (rewritten case): three humans online in a turn game found a bloc, the leader declares war and calls, both others join with one click, all three pledge to one operation, every screen agrees.
- `src/engine/__tests__/blocSim.test.ts` (in the sims set): two years of rival blocs on the real world, Normal and Hard; Easy never forms a bloc.
- Legacy: `factions.test.ts`, `factionsFinal.test.ts`, `factionLive.test.ts`, `factionToasts.test.ts` run with `BLOC.on` off and still pass (the switch-off proof that the old rules are intact). `territories.test.ts` checks a bloc never plans on its own territory.

- `balance.test.ts` (order wiring) checks every bloc order has its rules, executor and phase; `deployment.test.ts`'s posture-free hash runs with blocs off (it predates them).
- Mutation checks (12, all killed by bloc.test/blocFuzz): combined-arms bonus removed; survivors shared equally; pledge not checked against the army; migration split equally; roles not unique; Mutual Defence inert; live force leaving on D-Day instead of arriving; anyone can call to arms; captured country kept by the lead; the old pool left open; Shield inert; a member not at war fighting anyway.
- Full `vitest run` after the last change set: 1742 passed, 0 failed except the two fixed right after (order-wiring and the posture-free hash), both re-run green.

### Sim numbers (24 months, real world)

```
normal: 14 blocs, 28 members, 23 roles, 1 operations (1 fought, 1 by 2+ members, 1 won), 20 objectives met, levels 3/3/3/3/3/2/3/3/2/2/2/1/1/1, biggest bloc 2% of countries, strongest 2% of the world's strength
hard:   13 blocs, 25 members, 22 roles, 0 operations, 20 objectives met, levels 4/3/3/3/3/3/2/2/2/1/1/2/1, biggest bloc 2% of countries, strongest 2% of the world's strength
```

Reading: blocs form, take roles and meet objectives; no bloc runs away (2% of countries). Rival-led operations are **rare**: rival blocs form around shared enemies that are usually much stronger than them, and a country is defended by its owner's whole army, so the forecast rarely clears the bar. A first version without the odds check planned 11 operations on Hard and won 1: the check is deliberate (no wasted armies, no runaway). Rivals do pledge big (75 to 85% of their free divisions) to operations a player plans, which is where the bloc pays off for a person.

## Goldens

The Normal and Hard bot worlds were re-pinned (rivals now play blocs); the small war did not move. Switch-off proof: `withoutBlocs` in `turnGolden.test.ts` ('blocs are the only thing that moved the current pins') returns the previous pins `1f72167c03ee2` and `1719b377e4ad6a` exactly, and every earlier layer test also runs with blocs off.

## Not done / unverified

- Rival-led operations are rare in two-year sims (above); tuning the AI to fight more would risk runaway and was left conservative for tonight.
- The Shield bonus and the live countdown are tested in the engine; the screenshots cover the turn game desk at 1440x900 and 390x844, not every live frame.
- Mutual Defence joins a rival member at the moment the call opens; a human member always gets the one-click card.
- Not tested in two real browsers over the network (the MemoryHub tests run the real session code).
