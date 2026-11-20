# Two-player demo rehearsal (live, then turns)

Rehearsal of tonight's demo on current `main` (merged at `16ded50`, then again after merging `4c1bbd9`: Missile Program tab, Government desk, alliance blocs), on the **real Supabase relay** (`kind: supabase`), with two
Playwright Chromium contexts on one machine (software GL). Host "Hana" at 1440x900; guest "Bo" at 1440x900, and a second pass with
the guest at 390x844 (phone). Screenshots are in the session scratchpad (`.../scratchpad/demo/shots/`, names below), not in the repo.

Caveat on numbers: the machine was shared with three other agents' browsers (load average 12 to 20 on 4 cores), and the globe is
drawn in software. Frame rates measured here (0.5 to 3 fps) say nothing about a real laptop; relay round trips (90 to 130 ms) and
game behaviour do.

## Demo guide (for tonight)

### Start a 2-player live game

1. Both open the site. Host: **Play with friends online** → type a name → **Create a room**. The lobby shows a five-letter code
   and "LIVE · 1× · host sets the clock". Click the code to copy it and send it to your friend.
2. Friend: **Play with friends online** → name → type the code → **Join** (about 1 second on the relay).
3. Each picks a nation in the left list (search box at the top). The host sets the rules on the right (see below), then **Start game**.
4. Both land on the **Briefing** with the clock stopped. Close it (×). The host presses **Play**. The friend's button says
   "Ask: Play" and only sends the host a request (Host only rule).

### Recommended settings for a fun first 20 minutes

* **Live**, clock **2×** (1× is slow for a demo; 4× makes the month end come every ~15 s, and each month end is a short hitch on a
  slower laptop or phone). Pause rule **Host only** (no vote dialogs to explain).
* Rival nations **Easy** or **Medium**. How to win **Short** (the default "The world" is the longest game).
* Nations: **France and Germany** (neighbours, armies march in seconds) for the showcase. A war between you is **not** possible
  at once: a war with no reason costs 60 influence and every nation starts with about 30 (+3 a month). Each of you presses **Build a
  case** on the other's country card in the first minute (20 influence, ready in 3 months), and the war then costs 10. The Declare war
  button says so when it is greyed out. **USA and China**
  if you want a calmer economic game first; a war between them needs ships and takes longer to reach.

### What to show, in this order

1. Lobby and the code (copy button), the friend appearing in the player list, LIVE badge.
2. Briefing ("How you win", First steps), then **Play** at 2×: the date, the month bar, money ticking, the sync line
   ("In sync · ping ~100 ms").
3. Chat: Players and chat under the clock. A friend's message also pops up as a note.
4. Diplomacy between you: one proposes a **Peace pact** or **Alliance** from the Diplomacy desk (or the country card →
   Diplomacy). The other gets a note "France proposes a defensive alliance…" with an **Answer** button that opens the inbox at the
   top; Accept. The sender sees "Germany accepted…". Trade offers work the same way.
5. **Relations** desk and **◎ Locate** (flies the globe to a country).
6. Faction: found one ("waits for the 1st"), invite the friend; the invite arrives as a note at the month's end; join from the
   Faction desk.
7. War: the friend leaves the alliance, or pick France/Germany without one. Country card → **Declare war** (confirm dialog). The
   other screen gets a red "Germany declared war on you!". Open the **War Room** (country card → Plan an attack): win odds, the
   march, per-unit sliders, stance; **Launch army**. Both armies march on the globe; the battle pin drains the Defense Line; the
   Armies dock (bottom left) lists the march.
8. Missiles: Military → **Missile War** → Open the program → **Raise to level 1**, **Build** cruise missiles, then strike from the
   country card or War Room. The target gets a purple "Missiles incoming" chip and the salvo report (interceptors, batteries).
   The defender can buy radar / a battery in the same tab.
9. **Missile Program** (Military → Missile Program), from both seats: the "Next steps" box has *Do it* buttons: found the research
   institute, hire two rocket engineers, raise the charter to level 1. Pick a development (e.g. Improved motors) with the *Foreign
   contractor* to be fast, and build the *Engine test stand* the month after (one facility at a time). When the note "Improved motors
   is ready for its test launch" comes, press **Test launch**: a 3-2-1 countdown, the arc to the sea, "Test launch succeeded … in
   service. Milestone: First light." on both screens.
10. **Government** (Economy → Government): *Cabinet* → **Appoint** a minister (Finance is first); *Policies* → **Draft** a reform
    (e.g. the flat tax: "About 4 months to the vote, 62% to pass now"). Both are instant and show on the friend's screen too.
11. **Bloc** (nav → Bloc): found it **in the first minute** (it opens on the 1st of next month), invite the friend the month after,
    the friend joins from their Bloc desk (another month). Then both declare war on a common neighbour (France and Germany: Belgium),
    and on the Operations tab one member plans an operation (target, D-Day in N days), both **pledge** divisions with the steppers;
    the card shows "D-Day in 12 days", odds and +8% combined arms. On D-Day the joint force strikes as one; the leader gets the battle
    and the other member gets "Rhine Accord's joint operation won the battle for Belgium. You sent 4.9 divisions and lost none."
12. Military → Theatres / Deployment (one-click postures), Economy → People / Projects / Government / Space tabs: just open them.
13. Peace: Diplomacy → Make peace (territories, puppet, reparations) once one side is winning.

### Known rough edges (avoid or explain)

* ~~The month end is a short freeze on every screen (the AI plans; ~0.6 s on this loaded machine).~~ Shorter now (row 31): the rivals
  plan on a frozen state with each nation's economy, strength, prices and opinions worked out once, and a live screen plans the month
  ahead on a quiet tick before the last day, so the one long pause is two shorter ones (about 90 ms and 60 ms here). It is still
  there on a slow phone at 4×: prefer 2×.
* Blocs: founding, inviting and joining each wait for the 1st of the next month, so a bloc takes three month ends to stand up
  (about 45 s at 4×, 90 s at 2×). Found it right after pressing Play. The Bloc found screen now says that a founding is pending
  (it used to show only in the order tray and the toast).
* Missile Program orders and Government appointments give no toast of their own on the screen that gave them (the guest sees
  "Sent to the host…"); the tab updates. A second facility while one is building is refused with "A Nation builds one facility at a time".
* A missile **ceasefire** can only be offered to AI rivals, not to your friend.
* ~~The Missile War header can still say "Calm · No missiles in the air" while the "In the air" list below shows an incoming salvo~~
  Fixed (docs/UX_AUDIT_WORLD.md): the ladder leads with the salvos in the air and reads today's flights.
* ~~Offers that became moot stay in the inbox with "Cannot accept: Already allied" until they expire.~~ Fixed: they fold into "no
  longer possible" with Clear, and the badge and advisor do not count them (docs/UX_AUDIT_WORLD.md).
* ~~On a phone the country card covers most of the globe.~~ Fixed: it is a half-screen sheet with its buttons first. Desks fill the screen.
* ~~On the globe, a country's name can be hidden behind its city chips at the default zoom (e.g. Germany).~~ Fixed: nearby cities are dots.
* If the friend's connection drops for less than ~45 s, they come back to the host's game (nothing is undone); orders they sent
  while offline are dropped after 25 s with "The host did not answer". If the **host** closes the tab, the friend takes over at
  once and is told the clock is theirs.
* Saved rooms: "Saved games" in Play with friends; open your seat, the friend joins with the same code and takes theirs back.
  Do not use the nation list behind the dialog by mistake (it starts a single-player game).

## Log

| # | step | result | issue | fix | shots |
|---|---|---|---|---|---|
| 1 | Open app, Play with friends online, Create a room (live default) | OK. Code, LIVE · 1× · host sets the clock, rules card, "Connected" on the relay | Code and "Share this code" are drawn over the globe with low contrast once the globe zooms to a nation (cosmetic, not fixed) | - | 01, 02, 03 |
| 2 | Friend joins by code, both pick (France / Germany) | OK, join ~0.9 s on the relay (11 s once under extreme machine load) | - | - | 04, 05 |
| 3 | Start | OK, both on Briefing at 1 Jan, clock stopped, "Waiting for the host to start the clock", in sync, ping ~100 ms | - | - | 06, 07 |
| 4 | Guest presses Ask: Play; host Play; 1×, 2×, 4× | Host toast "Bo asks to start the clock"; 2× ≈ 1 day/s, 4× ≈ 2 days/s, both screens on the same day | - | - | 08, 09, 09b |
| 5 | Pause rules | Guest Pause in Host-only room only sends a request ("Bo asks to pause"); host pause freezes both ("Host paused (Hana)") | - | - | 10 |
| 6 | Pact / alliance / trade between the two humans | Worked, but **the receiver got no note at all** for a friend's offer (only a badge), and the sender heard nothing back when an AI answered at once | Offers between humans unnoticed mid-month | `orderNews` in `livePresent.ts`: a friend's offer is toasted with an Answer button (opens the inbox), "Offer sent to …" for the sender, and the answer (friend or AI) comes back the same day. Test `src/net/liveNews.test.ts` | 12–17, 14-host-* |
| 7 | Diplomacy desk in live | Section of today's news titled "Last month" | Wrong label in live games | "This month" in live | 17 |
| 8 | Relations desk, Locate | OK | - | - | 20, 21 |
| 9 | Faction found / invite / join | OK; invite arrives at the month end as "Germany invited you to join Rhine League"; join waits for the 1st | - | - | 22, 23 |
| 10 | Declare war between humans (confirm dialog) | Works; the attacked player was told "Germany: Declare war on France" (an imperative order line, same for attacks: "France: Attack Germany with 3 infantry, 0.5 tanks…") | Reads like a command, not news; not red when aimed at you | `friendLine`: "Germany declared war on you!" (red), "France sent an army against your Germany. It arrives 4 January 2026." Test in `liveNews.test.ts` | 24, 25, 26 |
| 11 | War Room per-unit deployment, win odds, launch from both seats | OK; both armies march, battles fought the same on both screens, reports "Your attack on … was repulsed" | **Armies dock drawn under the nav rail** (cards cut in half on desktop) | `.armies-dock` left 116px (as the drawer). Test in `navLayout.test.ts` | 27–32 |
| 12 | Missiles: program level 1, build, strike, radar + battery, Missile War tab | OK; salvo report on both screens, checksums equal | Missile War header "Calm · No missiles in the air" while a salvo is incoming (not fixed: the missile feature is being reworked in parallel) | - | 33–38 |
| 13 | People / Projects / Government / Space / Theatres / Deployment and every other desk tab (32 tabs) | All open, no console errors, no error boundary | - | - | 40-* |
| 14 | Guest offline 20+ s (context offline) during a 2× game | **Whole room rolled back 16 game days.** The relay kept reporting the guest "connected" for 35 s; after 12 s of silence the guest crowned itself host (term 2) on its stale copy; on reconnect the real host followed the higher term and threw away what it had played | Split brain after a short drop | A quiet host is replaced after 12 s only by players who hear most of the room, otherwise after 45 s, never while `navigator.onLine` is false; tabs send goodbye on `pagehide` so a closing host is still replaced at once. Tests in `liveResilience.test.ts` (fails on the old rule). Re-run on the relay: guest stayed a guest, came back in sync at the host's day, nothing undone | 41, 42 |
| 15 | Same, after reconnect | Sync line showed "slowest friend 6848 ms" for ~20 s | Heartbeats held in the dead line were measured as the ping | Pongs older than one heartbeat period are ignored. Test in `liveResilience.test.ts` | - |
| 16 | Guest on phone (390x844), USA / China | Lobby, briefing, running clock, chat note OK | **Live clock bar: 4× and "Players and chat" hung outside the box** (260px desktop cap) | `.hud-live` full width under 900px. Test in `navLayout.test.ts` | 50–54 |
| 17 | Host tab hidden | Guest: "The host's tab is in the background: the clock may move in jumps."; back to "In sync" when visible | Real background throttling not reproduced (visibility emulated) | - | 55 |
| 18 | Host closes the tab | Guest took over (clock kept running at 2×), but was not told | Silent takeover | Toast "Hana left, so the game runs on your screen now. You are the host: the clock is yours." (`takeoverNote`, test in `liveNews.test.ts`) | 56 |
| 19 | Saved-room resume | Guest reloads → Saved games → "China (Bo)" opens paused at the saved day; a new browser joins with the code, "Room … is already playing", takes "United States of America · was Hana"; same checksum; clock resumes | - | - | 57, 58, 58a |
| 20 | Rematch | Both back in the lobby, LIVE kept, nations kept | - | - | 59 |
| 21 | Turns mode | Lobby Turns, Ready on both, January resolves, monthly report on both | - | - | 60–65 |
| 22 | 10-minute live soak at 4× with a war (attacks every minute, 41 game months) | Both screens same checksum at the end; 1 resync on the guest in 10 min; toasts 0–6 per 30 s; JS heap after GC 65 MB at month 42 and 64.5 MB at month 48 (no growth); DOM 350 → 520 nodes as armies and labels grew | - | - | - |
| 23a | Final re-run on the fixed build (fresh room, France / Germany) | "Germany declared war on you!" (red) on the host; "Germany is marching on France. It arrives 4 January 2026."; peace offer between the humans arrives with **Answer**, which opens Diplomacy at the inbox (Accept / Decline at the top, "This month" news); aircraft development screen opens; War Room "AI Battle Command" at level 3 (dev money and tech, same on both screens) shows the planner, target ranking and auto-command; checksums equal | The attack note first read "against your France" | Reworded to "is marching on" (test in `liveNews.test.ts`) | 70–76 |
| 24 | Merged `4c1bbd9`, fresh room France / Germany, Missile Program from both seats: Do it ×3 (institute, 2 engineers, charter 1), foreign contractor on Improved motors, test stand the next month, **Test launch** from both | All orders accepted through the host; institute and stand open at month ends on both screens; both tests launched the same day, landed, "Test launch succeeded: Improved motors is in service. Milestone: First light." on both; `mprog` stats equal (1 test, 1 success); checksums equal at every check | A second facility while one builds is refused ("A Nation builds one facility at a time"): by design | - | 80, 81, 89 |
| 25 | Government from both seats: Cabinet → Appoint (Finance), Policies → Draft (flat tax) | Both ministers and both bills identical on both screens, checksums equal | - | - | 82, 83, 84 |
| 26 | Bloc: host founds "Rhine Accord" (desk found screen), invites Germany the next month, guest joins from its Bloc desk | Works on both screens over three month ends | Tray/toast said "Found the faction …", "Invite Germany to the faction"; the invite note said "See the Faction desk" (the nav says Bloc); and **the joiner was shown "Germany accepted your invitation to Rhine Accord"** (a note written for the inviter) | Bloc wording when blocs are on (`describeOrder`, `factionNews`; test `blocWords.test.ts`); the one who answered is not shown answers written for the asker (`newsFor`, used by every diplomatic toast; test in `liveNews.test.ts`) | 85–88 |
| 27 | Both at war with Belgium; host plans a joint operation (D-Day in 12 days), both pledge 4 infantry + 1 tank | Operations tab on both: "D-Day in 12 days (19 April 2026)", odds 58%, force 9.8 div., +8% combined arms, both pledges; the force marched and struck on D-Day; the same result object on both screens | **The guest, who sent half the force, got no word of the battle** (the report is under the leader's flag) | `jointShare`/`jointLine` in `livePresent.ts`: members who sent divisions get "Rhine Accord's joint operation won the battle for Belgium. You sent 4.9 divisions and lost none." (test in `liveNews.test.ts`); re-run on the fixed build (bloc formed through the dev hook identically on both screens, to skip the two month-end waits): seen on the guest, checksums equal | 90–95 |
| 23 | Engine cost per live day (real map, 2 humans, node) | ordinary day p50 < 1 ms, p95 7 ms; **month end p50 630 ms, max 840 ms** (AI planning, every screen); game state 650 KB | ~~Month-end hitch (not fixed: engine work, out of scope)~~ Shorter: row 31 | Guide recommends 2× | - |
| 28 | ~~**War declared by one human on the other was refused** in a scripted live run (the turn room "worked")~~ | Reproduced on the relay and in the MemoryHub harness. Cause: the influence rule, not the net layer. A war with no reason costs 60 influence; France and Germany start with 30 (+3 a month). The script had patched 400 influence into the host's *screen copy* (`__store.setState`) only, so the host's true game (the session's) refused with "Not enough influence (costs 60)"; in the turn room the war showed on the screen that had patched itself. With influence on both screens' true game (the `patchBoth` hook), war goes through from the country card in live and turns: confirm dialog, "France declared war on you!" on the friend, both at war, checksums equal | The greyed Declare war button only said "Not enough influence (costs 60)", and this guide promised a war "at once" | `warRefusal` (`src/ui/warHint.ts`): the button says "…; you have 30. Build a case first (20 influence, ready in 3 months): then war costs only 10." The guide is corrected. Regression tests in `src/net/twoHumans.test.ts`: refused at 30 with the same words on the screen and in the host's ack, a one-screen patch is still refused, accepted once it is affordable on every copy; the same in a turn room | live-war-*, turns-war-* |
| 29 | Two-player flows on the relay, live and turns (France host, Germany guest; dev hook for influence, war score, Superpower tier) | **Peace into a puppet** from the Diplomacy composer: "Make them a territory" is greyed with "Germany is run by a player: a player's nation cannot be made a territory" (a rule); "Make them a puppet state" → Send terms → the friend accepts from the inbox → Germany is France's puppet on both screens and in the Puppets tab (live at once; turns over two month ends). **Nuke**: Missile War → Nuclear strike → Launch the missile → the confirmation names the victim, the dead and the blocs that declare war, and its button stays greyed until the box is ticked; live: 5-day flight, "France launched a nuclear missile at Germany!" then "NUCLEAR STRIKE" on the friend, the same population on both; turns: lands at the month end. **Aircraft**: the friend's Start development (radar) runs on both screens. **Auto-command**: the switch is greyed and the panel says "Auto-command plans a month at a time: it is for turn games" (live) or "Auto-command is not available in an online game" (turns). **Stale offer**: both offered an alliance and one was accepted; the other folded into "An offer that is no longer possible … Already allied", and Clear removed it on both screens. Checksums equal after each | (1) the Send terms and Offer deal buttons said "Bo sees it when the next month begins" in a live room, where the friend sees it at once; (2) the friend whose moot offer was cleared was told "France rejected Germany's defensive alliance" | (1) `offerWhen` (`src/ui/offerWhen.ts`); (2) `orderNews` reads a Clear of an offer that could no longer be accepted as "France cleared Germany's … offer: it was no longer possible (already allied)". Since the merge of main, an overtaken offer is withdrawn at once anyway. Tests in `twoHumans.test.ts`. Not changed: in a turn room a nuke on a one-country nation can end that player's game at the same month end (the ruins rebel against an army that is 97% gone); the dialog warns that the country "can fall" | live-peace-*, turns-peace-*, live-nuke-*, turns-nuke-*, aircraft-*, turns-aircraft, autocommand-open, turns-autocommand, stale-open |
| 30 | **Players vote** in the browser | Guest presses Play: "Bo wants to start the clock (1 of 2 needed)" on both screens; host presses Play: the clock runs; a pause needs both again ("Hana wants to pause (1 of 2 needed)"). A vote lapses after 20 s, as designed (on a first try the host's click came after slow screenshots and started a new vote) | - | - | vote-1-*, vote-3-host |
| 31 | **Month-end cost** (real world, France and Germany human, Normal rivals, 12 live month ends from January 2026; node, min of 5 runs per month end, load average 8 to 12 on 4 cores; `main` at `b174963` against this branch, measured back to back twice) | Whole month-end step (`stepRoomDay` on the last day): mean **170 / 186 ms → 151 / 135 ms**, longest 207 / 263 → 189 / 170 ms. Rivals' planning (`generateAllBotOrders`): **105 / 115 → 84 / 74 ms** (−25 to −35%). `runMonth` (orders, economy, the rest): 45 / 48 → 53 / 48 ms (unchanged, noise). In a live room the screen now plans the rivals' month on a quiet tick before the last day: the month end is a **pause of 84 to 94 ms, then one of 55 to 63 ms** (longest 116 and 88 ms) instead of one of 135 to 186 ms. Every month end's fingerprint is identical before and after; `turnGolden` passes unchanged | The month end froze every screen for one long pause (row 23) | `src/engine/frozen.ts`: while the rivals plan, the state is frozen and each nation's economy, military power, the market prices, the coalition check, opinions and the trade-partner set are worked out once (`whileFrozen` around `generateAllBotOrders` and the room's planner; the caches drop when planning ends). `planAhead` in `liveRoom.ts`: a quiet tick on the month's last day plans the rivals' month for exactly that state (a state that changed is a new object and is planned afresh), on the host and on guests. Tests: `src/net/livePerf.test.ts` (every rival order on the real world identical with the caches on and off over 4 months, planning leaves the state unchanged, a live month end the same with the caches on and off, a plan made ahead gives the same month end and is never used for a changed state, two screens planning ahead stay in step over 3 month ends). Not done: planning in a Web Worker or spread over several days (spreading would change the state the plan is made on, so the game) | - |
| 32 | **10-minute soak at 4×** after these changes (fresh live room France / Germany on the relay, war, both attack each other every minute, money topped up) | 615 s, 35 game months; at the end both screens had the same whole-game hash (`409080406`, 893 KB of JSON) and 0 resyncs, in sync throughout; JS heap after a forced GC 61.8 / 60.3 MB (month 5), 66.5 / 63.9 (16), 69.3 / 66.7 (28), 64.4 / 63.0 MB (35): flat; DOM 349 → 431 nodes. The war ended the game at month 35 (Germany fell, then France; "The game is over" on both, the clock stopped with why "over"), so the last minute ran on a finished game. Frame rates in this run (0.5 to 2.5 fps) are software GL under a load of 13 to 15 and say nothing about a real machine | - | - | - |

## Not verified

* Two real computers on different networks, a real phone browser and its background throttling (all runs were two contexts on one
  machine through the sandbox proxy).
* Frame time with effects on Auto on a real GPU (software GL under heavy load here).
* ~~Nuclear launch and its confirmation (needs a Superpower with Hypersonic Missiles; the confirm rule exists in `confirmRules.ts`),
  starting an aircraft development, and running the AI auto-command were not driven in the two-player room; the screens were
  opened. Territories and puppets through a peace between the two humans were not reached (a white peace offer was sent and shown).~~
  Driven on the relay in live and turn rooms (rows 29, 30).
* ~~"Players vote" pause rule in the browser (unit tests only).~~ Driven on the relay (row 30).
* A real GPU, a real phone and two separate computers are still not tested (see above).
