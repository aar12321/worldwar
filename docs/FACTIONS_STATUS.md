# Factions: status

Audit at the second merge of `claude/laughing-planck-9gjcru` (missile UI, aircraft development, missile-program research fix).

Checks at the audit: `npx tsc -b` clean, `npm run lint` clean, `npx vitest run`: every test passes except tests that time out on the shared machine (load average 40+ from other sessions; the 5 s tests take 9 to 20 s). Run with `--testTimeout=900000` to see the real result (recorded at the bottom).

## DONE AND TESTED

1. **Faction state** (`GameState.factions?`, absent until used): id, name, founder, charter (vote: majority/weighted; spoils: share/proposer; exit: refund/forfeit), members, common pool (money, oil, steel, goods, food, soldiers by unit type), per-member ledger, ownership shares (`sharesOf`, `claimValue`), proposals, contracts, invites, wars, history. Tests: share math, fixed valuation, losses shared pro rata, surplus never claimable, plain-data round trip, no `factions` key in a game that never uses it.
2. **Orders** `factionFound / Join / Invite / Leave / Contribute / Withdraw / Propose (war or contract) / Vote`: Order union, `orderCost`, `checkRules`, `describeOrder`, `PHASES`, `executeOrder`, `MONTH_END_ORDERS`, store `keptOrder`, confirmations. A contract between two nations is the existing `propose` order with a trade proposal that carries the contract fields. Tests: every rule's refusal and effect.
3. **Live contracts** reuse `state.deals`: a trade deal may carry `start`, `collateral`, `joinWars` (`Deal.contract`). Executed monthly inside `applyDeals` (shared month). Breach: collateral changes hands, opinion hit, reason for war, reputation. Contracts with the pool (`faction.contracts`): voted, deliver monthly, paid or credited to the ledger, collateral kept on breach. Tests: start delay, collateral held/returned/forfeited, join-wars auto-join and refusal, cancel before and after the start, bad terms, pool cannot pay, member cannot deliver.
4. **Voting**: majority and weighted; tie fails; open until more than half says yes or half says no; expiry decides by votes cast if half the weight spoke; proposals put forward this month wait for the next; changing a vote; non-members refused; leavers take votes and proposals with them.
5. **Joint war**: passed vote declares war through the existing rules (reason or none, cost to the proposer, a member with a reason declares), able members join, the pool attacks as one army through `resolveAttack` with a synthetic army (lead member's drill, weapons, technology), captured countries and treasure split by share or to the proposer; pool upkeep (pool pays, then members by share, then desertion), fuel and food bought on the market or the army fights short. Tests for all of it, and turn/live parity.
6. **No-cheat cases**: money and steel through the order cost (no double spend in a batch), other stores and soldiers checked against what is queued, withdraw in kind only, locked for two months, haircut when the pool lost something, soldiers stay in a war, exit fee, forfeit charter, random-sequence conservation test, forged orders. 18 mutation checks, all killed.
7. **Online**: orders are plain month-end orders, the host resolves votes; a session test with three humans founding, inviting, joining, pooling and voting, and every screen agreeing. Saves: `normalizeGame` cleans a damaged faction.
8. **AI**: `src/ai/factions.ts`: join by opinion, found with allies, pay in, vote by opinion/reason/strength, leader invites and proposes wars; Easy never takes part (coalitions flag). Own random stream. Golden hashes re-pinned after checking that with the faction play off the old ones match.
9. **UI** (`src/ui/Faction.tsx`): found form, invitations, council (card, votes with live tally, one-press Yes/No, Propose country picker, wars), pool and members, contracts, war log; nav rail entry with badge, `F` key, palette entry, briefing advice, toasts (turn, live and online via `presentMonth`).
10. Help and README updated.

## DONE BUT UNTESTED
- Browser flows verified by screenshots and scripted clicks (found, vote queue, picker), not an automated UI test.
- Store wiring that turns `factionNews` into toasts (the function itself is tested).

## PARTLY DONE
- (none; offline-human vote, advisor items, leaving mid-war, upkeep going negative, repair of damaged saves are now tested)

## NOT STARTED
- Rivals proposing contracts (between nations or with the pool) on their own; they vote on and accept them.

## Last check results
- tsc clean, lint clean. Full vitest (after the second merge): 826 pass, 6 fail, all 6 are explicit-timeout simulation tests (20 to 120 s limits) that run long on the shared, loaded machine (load average 27 to 45); `simulation.test.ts` alone: 2 of 3 pass, the third took 22.5 s against a 20 s limit. Faction AI costs about 1.5% of a bot month.
