# Territories: status

A new vassal status next to puppets. Rules in `src/engine/territories.ts`, every number in `src/data/territories.ts`. State is optional: `Nation.territoryOf` (the master) and `GameState.territories` (record: master, since, taken, last, revenue). A game with no territory has neither field.

## Done

- Peace-table term `PeaceTerms.territory`: price `min(100, 1.6 x puppet price)`; exclusive with puppet and liberation in one deal; never for a nation a person runs; tier limit on how many a master holds (1, 1, 2, 3, 4); validated in `validatePeaceTerms`, costed in `termsCost`, described in words, shown with cost preview in the Diplomacy peace composer.
- Cut: 30% of revenue (taxes + factories + trade + business tax, before the territory's own costs) every month for ever; none when revenue is not above zero; never more than the treasury; not the puppet tribute, not under its 25% cap.
- Faction: put into the master's faction (founded with the default charter if the master has none); takes no seat, no vote; cannot leave (own order refused; master cannot leave while holding one); put back by the monthly housekeeping if ever out.
- Wars: joins every war the master declares, is dragged into, or already had; pacts/alliances with the foe are dropped; a war on a territory is a war on its master (unless allied/pact); cannot declare war or make peace itself; peace between master and foe ends the territory's war; the master may ask for peace in its name only where the master is not at war with that foe.
- No reparations: peace terms refuse to charge a territory either way; ones it owed are forgiven on binding and dropped if one ever stands.
- People: its people, output, workforce stay its own (population share, economic share unchanged). Countries count 0.5 toward tier and Countries Taken, fully for map control and hold-the-world.
- Military: `commandTerritory` order (train, cancel, drill, weapons, attack, station, alert, recall, commander, cancel deal, peace in its name), validated and paid as the territory's own (its treasury, its attack slot); turn, live, online (month-end or immediate as the inner order is). Its own orders for these are refused.
- Trade: `forceTrade` (with the master at once; with others they still consent; fair floor 70% at market prices; at most 6 deals); the territory cannot cancel; it accepts the master's offers without a word and turns down every other kind of offer.
- Ending: `releaseTerritory`, `annexTerritory` (12 months, influence 15 per country x 1.5, land 60% settled, army and treasury absorbed); master death frees it; chains pass up (a master becoming a vassal, a new territory's puppets and territories).
- AI: only Hard asks for one (lead 40 beyond the price, one at a time, not of a richer land); a loser gives in only past score 16; a territory's own bot plans its army and a bot master gives the orders; a person's territory plans only its economy.
- UI: Territories tab (Empire desk, only when held), War Room "Send territory forces" with per-unit picker, Diplomacy peace term and badges, Faction desk chip, advisor lines, Help, README. Scenario op `territory`.
- Tests: `territories.test.ts` (rules with mutation checks), `territoriesParity.test.ts` (live/turn year, fuzz, scenario), `ui/territories.test.ts`. Sim harness: `territoriesBots.test.ts` (VITE_TERRBOT), `territoriesCompare.test.ts` (VITE_TERRCMP).

## Numbers (sims)

- Natural Hard bot play, seeds 1-3, 96 months: 0 territories made (puppets: 0, 1, 1). The conditions are strict on purpose; no snowball (largest empires 23, 12, 15 countries).
- Same neighbour handed to a Hard master, 60 months, France + Spain (seed 2): master gross none 137, puppet 195, territory 256, conquest 293. Territory sits between puppet and conquest; the cut taken was 1216 money (about 20 a month); population share unchanged (0.9%) against conquest 1.5%. Seeds 1 and 3 (Poland, Egypt) are noisy (the master or the neighbour is eliminated by the bots' own wars) and not used for the comparison.

## Decisions on the spec's ambiguities

- Revenue base = gross revenue lines (same as the puppet tribute and economic victory), capped by the treasury.
- Faction: no seat and no vote (master speaks), so it never blocks invitations.
- Territory conquests belong to the territory (its own army, its own land); it then pays the cut on that land too.
- Forced trade needs the partner's consent (a person gets it in their inbox); a floor stops draining it for nothing.
- Humans cannot be made territories (online or single player). A human master commands by hand.
- Liberation does not apply to territories; other nations may still declare war on it (and so on its master).
- Release also takes it out of the faction. Master death: independent.

## Not done / unverified

- Goldens: none re-pinned and none moved (turnGolden and the other pinned worlds pass unchanged: no bot in them makes a territory). Full suite: 1624 passed; the 6 failures of the first run were fixed (wiring test knows commands, kept orders after reload, puppet AI tests switch the new Hard option off, one unused text key); `bot.test.ts` 'at most one new proposal' has an explicit 30s limit and takes 25-47s, so it times out under load and passes alone (not caused by this work).
- Screenshots (1440x900 and 390x844) of the Territories tab and army card were read; the peace composer and War Room section were not captured.
- No per-territory "Send with my army" in turn-based online play beyond the shared switch (the switch is a browser preference).
- A territory's captured land is the territory's, not the master's: a design choice not tested against the AI over long games.
