# Two-player demo rehearsal (live, then turns)

Rehearsal of tonight's demo on current `main` (merged at `16ded50`), on the **real Supabase relay** (`kind: supabase`), with two
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
* Nations: **France and Germany** (neighbours, war possible at once, armies march in seconds) for the showcase. **USA and China**
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
9. Military → Theatres / Deployment (one-click postures), Economy → People / Projects / Government / Space tabs: just open them.
10. Peace: Diplomacy → Make peace (territories, puppet, reparations) once one side is winning.

### Known rough edges (avoid or explain)

* The month end is a short freeze on every screen (the AI plans; ~0.6 s on this loaded machine). At 4× it comes every ~15 s.
  Prefer 2×, especially with a phone.
* Factions: founding, inviting and joining all wait for the 1st of the next month.
* A missile **ceasefire** can only be offered to AI rivals, not to your friend.
* The Missile War header can still say "Calm · No missiles in the air" while the "In the air" list below shows an incoming salvo
  (the stage label follows world tension, not flights).
* Offers that became moot (a pact offer after you are already allied) stay in the inbox with "Cannot accept: Already allied" until
  they expire.
* On a phone the country card covers most of the globe; close it (×) to see the map. Desks fill the screen.
* On the globe, a country's name can be hidden behind its city chips at the default zoom (e.g. Germany).
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
| 23 | Engine cost per live day (real map, 2 humans, node) | ordinary day p50 < 1 ms, p95 7 ms; **month end p50 630 ms, max 840 ms** (AI planning, every screen); game state 650 KB | Month-end hitch (not fixed: engine work, out of scope) | Guide recommends 2× | - |

## Not verified

* Two real computers on different networks, a real phone browser and its background throttling (all runs were two contexts on one
  machine through the sandbox proxy).
* Frame time with effects on Auto on a real GPU (software GL under heavy load here).
* Nuclear launch and its confirmation (needs a Superpower with Hypersonic Missiles; the confirm rule exists in `confirmRules.ts`),
  starting an aircraft development, and running the AI auto-command were not driven in the two-player room; the screens were
  opened. Territories and puppets through a peace between the two humans were not reached (a white peace offer was sent and shown).
* "Players vote" pause rule in the browser (unit tests only).
