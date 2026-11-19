# UX and logic audit: the world side

This audit covered the Military desk (Forces, Deployment, Theatres, Armies, Wars, Missile Program, Missile War, Agencies, Systems),
Diplomacy, the Bloc desk, the country card, the HUD with its alert chips and map control, online players and chat, Help, the jump
window (Ctrl+K), and the parts of the AI Command Center that are not the attack planner. The Economy, Empire, Research and Briefing
desks were audited separately. The Relations desk and the War Room attack planner belong to other work and were not touched.

The aims were:

* one home for each control and number;
* pages that lead with the figures and the next useful action, with the reasoning one click away;
* screen text that matches the engine.

## How it was checked

`scripts/world-shots.mjs` builds a demo state and screenshots every tab at 1440x900 and 390x844, in a live game and a turn game. In
the demo state:

* the player is Germany, at war with France;
* the missile program is at charter level 1, with 3 cruise missiles in store and radar level 1;
* Poland is an ally, and a stale pact offer from Poland is waiting;
* in a live game, a 4-missile cruise salvo from France is in the air.

The script also prints how tall each desk's scrolling body is. A two-player room was also opened over the real relay (turns and live,
two browser contexts) to check Diplomacy, Wars, the Bloc desk and the players and chat pop-over from both seats.

Scroll height of each desk on a desktop, in pixels, in the demo state:

| desk | before | after |
|---|---:|---:|
| Diplomacy | 19 155 | 4 983 |
| Theatres | 5 058 | 1 464 |
| Deployment | 4 628 | 1 644 |
| Systems | 2 364 | 922 |
| Wars | 718 | 512 |
| Missile War | 2 357 | 2 267 to 2 582 (the "In the air" list now shows; the ledger folds) |
| Missile Program | 3 762 | about the same (the build rows moved in; only the open kinds get one) |
| Forces, Armies, Agencies, Bloc | unchanged | unchanged |

## What was duplicated, and where it lives now

| What | Where it was | Its home now | What the other places show |
|---|---|---|---|
| Building missiles (charter, each kind with its cost, Build 1 or a chosen number) | The Systems tab held the whole old program card. The Missile Program tab had a "Workshop: build 3" button with no cost shown | Missile Program › *Production and stockpile*: a build row for each kind the charter has opened, then the production line | Systems: a one-line summary with *Open the Missile Program*. The advisor's "Open the program" goes to the Missile Program tab, not Systems |
| Each border: tension, what makes it, yours and theirs, close or reopen | The Deployment *Borders* list and the Theatres cards (the same tension bar, garrison, theirs and cover) | The Theatres card, with *Why the tension is N, and the border itself* folded under it | Deployment: one line naming the hottest border, with *Open Theatres*. Deployment keeps the posting sliders and the threat watch. The country card keeps its single-border summary, which is context for the selected country |
| A war's verdict, reasons, score breakdown and fronts | Military › Wars, and every Diplomacy row at war (a war-score bar plus the whole *Who is winning* panel) | Military › Wars | Diplomacy: one line ("War score +3 · winning") with *Fronts and odds in Wars →*. The HUD's "Wars 1/3" and the Bloc's "bloc's wars" are summaries and stayed |
| Bloc invitations and requests, with Join and Let them in | The Bloc desk and Diplomacy | The Bloc desk | Diplomacy: one line ("Rhine Accord invites you to join") with *Answer on the Bloc desk* |
| "Blocs" | The Bloc desk's blocs (factions), and Diplomacy's alliance groups computed from alliances, also called "X bloc" | Bloc desk | Diplomacy calls them "X alliance" and says they are not the Bloc desk's blocs. The list is folded |
| Declare war and Build a case | The country card and the Diplomacy row | Both, on purpose | The country card is the quick path from the globe that the README describes. Diplomacy keeps them with the treaties, folded |
| Training units | Forces, and a territory's army in the Territory desk | Forces for your army | The Territory desk trains the territory's army, not yours, so it is not a duplicate |
| Auto-station (Deployment) and the one-click postures (Theatres) | Both | Both, on purpose | Auto-station fills the sliders as a draft; a preset posts a posture and sets the alert at once. Deployment's help says that presets and the alert are in Theatres |

## What was trimmed (nothing was removed)

**Diplomacy**

* The inbox comes first, before crises, sent offers and news.
* Each nation row shows who the nation is, its chips, its opinion (with reasons on a click) and, at war, one war line. Treaties, trade,
  money, sanctions, war and the bloc row fold behind *Treaties, trade and more*, next to *Build relations →*. The row you arrive at
  (from the country card, the advisor, the jump window or the Wars tab's *Make peace*) opens unfolded.
* The alliance groups and the "Around the world" news are folded.

**Wars**

* Four tiles: wars out of the limit, war bills, weariness, held land.
* Before, every empty war slot had its own dashed card, up to eight. Now the empty slots are one number, and at peace the tab shows an
  empty state.

**Theatres**

* Danger and watch fronts come first, hottest first. The quiet fronts fold into one line that names them. A front you pick on the map
  opens its fold.
* The map of theatres is capped at 640px wide. On a desktop it was 1236x618.
* The readiness explanation folds.

**Deployment**

* The long rules paragraph folds into *How forces on station work*.
* The border list moved to Theatres.

**Missile War**

* The kill ledger shows four figures: fired, got through, shot down and the exchange. The other eight fold.

**Missile Program**

* A kind the charter has not opened yet is a line ("Later: tactical missiles at charter level 2"), not a card.

**Country card on a phone**

* It is a bottom sheet of at most about half the screen, and its buttons come first.
* While it is open, the top bar keeps one row of figures.

**Tiles**

* Forces, Deployment, Wars and Theatres use the kit's `StatTile` and `Tiles`. `Tiles` now takes a `four` option for a row of four.
* On a phone the tiles fold into rows.

## Logic issues fixed

1. **Missile War said "Calm · No missiles in the air" while a salvo was incoming.** There were two causes:
   * The rung follows world tension, not flights.
   * The desk read the slower copy of a live game, which skips days on which only the clock, armies or flights moved. A salvo launched
     on a quiet day did not show at all: the *In the air* list was empty, and the next steps said "0 incoming".

   The tab now reads today's flights and date. The ladder shows *N incoming* and *N outgoing* chips, and the line under it leads with
   the salvos (`ladderNote`, tested in `missileWarUi.test.ts`). The Calm blurb no longer claims that nothing is flying.
2. **Scramble was refused with "That salvo is gone"** for a salvo that the tab showed. Buttons were checked against the slower copy.
   `OrderButton` now takes an optional fresher `game`, and Missile War passes it.
3. **Stale offers lingered.** A pact offer from a nation that is now your ally sat in the inbox with a dead Accept and "Cannot accept:
   Already allied" until it expired. It also counted on the Diplomacy badge and in the advisor's "is waiting for an answer".
   * `engine/offers.ts` `offerIsMoot` (pure, read-only, tested in `offers.test.ts`) tells an offer the world has overtaken from one
     with a shortfall you can fix. Examples of overtaken: a pact from a nation now allied with you, peace when you are no longer at
     war, a call to a war that is over. Examples of a fixable shortfall: money, influence, a box to untick.
   * Moot offers fold into *An offer that is no longer possible*, with *Clear* (a polite decline).
   * The badge (`offersWaiting`) and the advisor do not count them.
4. **Theatres with nothing on station:**
   * a readiness bar was drawn at about 70%;
   * three alert buttons were always disabled ("Post some forces on station first").

   Both now show only once you have a posture. The alert tile reads "None · nothing on station".
5. **Wars tab overload.** Up to eight dashed "War slot N: Open. Pick a neighbor…" cards were shown, one for every empty slot.
6. **The Bloc found screen did not show that a founding was waiting for the month's end.** Only the order tray and a toast did. The
   screen now says so above the button.
7. **The auto-command switch and *Plan the month now* were enabled in an online game,** where the store refuses them with an error
   toast. They are now disabled, with the reason shown.
8. **Missile War step buttons all said *Open the program*,** including the steps that open Systems or Wars.
9. **Wording:**
   * "1 wars · 1 allies" now reads "1 war · 1 ally";
   * the Bloc desk's "1 members" and "1 countries" are singular now;
   * war costs read "money a month".
10. **Phone:**
    * an alert chip ("Missiles incoming…") sat over a desk's title and close button, so a desk could not be closed while missiles
      were in the air;
    * the country card covered most of the globe.

    A desk and the card now start below the chip.
11. **Globe:**
    * Hamburg and Munich hid "Germany" at the default zoom. A city within a few degrees of its country's name pin is now a dot
      (`globe/labels.ts` `nearLabel`, tested). Cities farther away keep their names.
    * The map control was 300px wide and cut off "Blocs".

No engine rule changed. `offerIsMoot` and the advisor's offer count are read-only and are not used when a month is resolved. The golden
hashes pass unchanged, so no switch-off proof was needed.

## Engine-facing text that now matches the engine

* README and Help:
  * the Military desk has nine tabs, not six;
  * missiles are built in the Missile Program tab;
  * a border is closed from its card in Theatres.
* The Missile Program's production line says where missiles are fired from, which is now Missile War, after the attack-planner merge.

## What is left

* **Briefing** (another audit's desk): the "Missiles and systems" link (`Briefing.tsx`) still opens Systems. It still works, through
  the summary card, but it would be better pointed at `program`.
* **Agencies:** each agency card offers up to four *Raise to level* buttons, and Systems up to three. One button and a level stepper
  would be calmer. Not changed.
* **Missile Program** is still the longest Military tab (about 4 200px), with seven sections on one page. Its sub-sections could
  become a segmented control like the Government desk's.
* **The theatre "Front" chip** on the globe can sit next to a country name. It did not overlap in the demo state, but nothing prevents
  it.
* **Stale offers in the engine:** moot offers are still kept until they expire. A rule that drops them at month end would move the
  golden hashes, and the UI now handles them.
* **Country card on a phone:** the top bar, with one row of figures, the nav bar and the clock bar still take about half of a 390x844
  screen. Making the HUD collapsible would give the globe more room.
* **Not verified:**
  * a real phone browser;
  * the online check in a live room with a war declared between the two humans (the declare-war order was refused in the scripted
    live run, and the turn-room run covered the war);
  * a declared war removing the pact offer between the two humans online, which meant the stale-offer fold could only be shown in a
    single-player game;
  * screen readers on the new folds (`<details>` and buttons with `aria-expanded`).
