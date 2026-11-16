# Faction and Diplomacy: one flow (status)

## The report

"If I partner someone as a nation on the diplomacy tab, I can not find them in my faction to invite."

### Reproduced (Playwright, 1440x900, Germany on 175 nations)

Pact with Albania and Croatia, a guarantee for Belgium, found a faction, open Pool and members. The invite list was the whole world ranked by
strength (China, India, USA, ...). Croatia was row 108, Albania row 138 and Belgium row 49 of 174, in a box five rows tall. Only an alliance got a chip
("Ally"); a pact or a guarantee looked like any stranger.

### Root causes

1. The list was ordered by new-game strength rank, not by relationship, so small partners sank to the bottom of a 200 px scroll box. Only alliances were marked.
2. Nations already in a faction (rivals found factions with their allies) were filtered out silently. Puppets and nations at war with a member were shown but vague.
3. The whole box vanished when the faction was full.
4. Clicking a row that cannot be chosen did nothing, with no word.
5. A queued invite was not part of the list's inputs (stale `orders`), so a row did not say it was already invited.
6. A rival that its difficulty keeps out (Easy) turned every invitation down: the order cost a little opinion and the answer showed only in the War log tab. Declines and accepts never reached the Diplomacy desk or the monthly news.
7. The Diplomacy list only held neighbors, enemies, allies and deal partners: a pact or guarantee partner across the sea, and your faction mates, could be missing.
8. There was no way from a country's card to a faction at all, and no way to ask to join someone else's.

### What changed

- `src/engine/partners.ts`: `partnerRelations` (ally, pact, guarantee both ways, trade, loan), `inviteCandidates` (every living nation, with the reason from the order's own rule, partners first, then those that can be invited, then opinion), `invitablePartners`.
- `factions.ts`: the invite refusal names the faction ("already in a faction (Balkan League)") and the member at war; a rival that its difficulty keeps out is refused up front; new order `factionRequest` (ask to join; 5 influence; rival-run factions answer at the month end, player-run ones keep a `requests` entry, and a member who invites the asker lets it in at once); `tell` puts invite and request outcomes into the Diplomacy "Last month" dispatches and the news (rival-to-rival stays quiet); `factionNews` and the advisor mention requests.
- `ai/factions.ts`: `inviteScore`, `inviteOutlook` (likely, may accept, unlikely), `botAdmits`. `botAcceptsInvite` draws the same random number as before.
- UI: `NationPicker` (groups, chips, relation search, blocked rows say why and never become the choice, reveal), `pickerItems.ts` (`nationItems` and `inviteItems`, one builder), `FactionLinks.tsx` (`FactionRow` on country cards, `FactionNotices` in both desks), `diplomacyList.ts` (`closeNations`), store `factionFocus` and `openFaction(nation)`, advisor tips "Invite X to your faction" and "Found a faction with X".

### Tests

`src/engine/__tests__/factionPartners.test.ts` (20), `src/ui/factionInvite.test.ts` (6, on the real world), plus the changed Easy-rival assertion in `factions.test.ts`.

### Not done / unverified

- Human to human with two browser contexts was not run (net transport); covered by engine tests with two humans (`factionRequest`, `factionJoin` dispatches).
- A rival's decision on a request uses the members' opinion of the asker; it has not been tuned in a long simulation.
