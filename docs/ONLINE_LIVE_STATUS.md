# Live play with friends: status

## What was wrong (audit)

Before this work, online rooms were turn-only. Evidence in the code:

- `liveHold()` returned `'online'` for any online game, so a live clock could not run in a room, and `Setup.tsx` said "Live games are for one player".
- `RoomSettings` had no mode; `startGame()` never passed `mode: 'live'` to `createInitialState`; the lobby had only a month timer.
- The wire protocol sent a whole compressed game (about 45 KB, two messages) per month. At one game day per 2 seconds that is not a usable live protocol, and it carried no day, no per-order acknowledgement and no checksum.
- Orders went in one plan per month with a Ready button; there was no way to issue an order mid-month and hear back.
- No shared clock: pause and speed were a per-device setting, so a pause would have frozen only one screen, or all of them.
- The host's tab timers (throttled when hidden) and the single-player loop (`requestAnimationFrame`, which stops when hidden) could not drive a shared clock.

## What was built

Turn rooms are untouched (the turn golden test and the existing session tests pass unchanged). Live rooms are a second mode of the same `OnlineSession`.

### Lobby

The host chooses **Live** (first, the default) or **Turns**; for Live, the starting **clock speed** (1x, 2x, 4x) and **who can pause** (Host only, or Players vote). Joiners see the mode, speed and rule in the lobby (a LIVE badge under the room code) and the settings are read-only for them. Saved rooms list the live date.

### Protocol (deterministic lockstep, host as single authority)

Every screen runs the same pure engine (`advanceDay`, `applyOrderNow`, the AI planner), which is seeded. So the host does not send the game; it sends what happened, in order, and every screen reaches the same game.

| message | direction | content |
| --- | --- | --- |
| `stream` | host to all | `{term, seq, items[]}`: numbered, in order. Items: `day n` (n days passed), `cmd` (an accepted order, who sent it, its number), `clock` (running, speed, who set it, open vote), `ai` (nations the AI plays now), `fp` (checksum at an absolute day) |
| `cmd` | player to host | `{cid, order}`, `cid` counts that player's orders |
| `ack` | host to sender | `{cid, ok, reason}`: the host's answer, with a readable reason when refused |
| `clock-req` | player to host | pause / resume / speed |
| `state` | host to one or all | full compressed game in 40 KB pieces, with the stream number it is valid at: used for joining, seats, reconnects and resync |
| `ping`/`pong` | all / host | heartbeat with timestamp, measured round trip, and `hidden` (host tab in the background) |

Rules:

1. **The host is the only clock.** `OnlineSession.liveTick()` runs every 200 ms and turns elapsed real time into days (`Date.now`-based catch-up, not per-timer counting). A tab whose timers are throttled plays the days it missed, at most 12 per tick, with at most 60 days of backlog; a gap over 10 minutes (the computer slept) stops the clock instead of racing ("Paused: the host's computer was asleep"). Friends are told when the host tab is hidden (`hidden` in the heartbeat) and show "the clock may move in jumps".
2. **Orders.** A guest validates the order locally (instant error text), sends it with a number and shows "Sent to the host" and a pending count. The host checks it against that sender's own nation and the game as it is now, applies it, streams it, and acks. A refused order comes back with the reason; a forged one (another nation's) changes nothing. Re-sent orders (lost message, new host) are done once (per-sender result memory; guests learn it from the stream too).
3. **Conflicts** are settled by order of arrival at the host: two declarations of war on each other, one stands and the other is told "already at war"; two armies sent at one country both march and fight in the day order the engine fixes (by arrival day, then id). Month-end orders of all players run in the seeded `humanOrder`, so no one gains by sending first.
4. **Checks and resync.** After every month end and at least every 10 days the host streams a checksum of the whole game. A screen that differs, misses a stream number for 1.5 s, or has just reconnected, fetches the game again and drops back to "In sync".
5. **Clock control.** *Host only*: only the host pauses/resumes/changes speed; a friend's request shows the host a note. *Players vote*: any player proposes; it passes when more than half of the players who are here agree (votes lapse after 20 s), so one player can never freeze the others, and a player alone in the room can run the clock. The panel says who paused ("Host paused (Hana)", "Paused by Bo and Hana").
6. **Nothing local stops the clock.** Battle windows, the month report, a decision, the War Room and Help are the player's own overlays. A decision waits only for its own player and, if unanswered, the ministers choose at the month end (existing multiplayer rule). `pauseOnBattles` plays the battle over the running game.
7. **Leaving and joining.** A player who goes away (9 s without a heartbeat) is played by the AI from the next month's planning (`liveAi` in the game, streamed so every screen agrees); a newcomer takes the seat and receives a snapshot. If the host leaves, the lowest-id player takes over with a new term and broadcasts its game, so everyone continues from one copy at the same speed; orders still in flight are sent again. The old host coming back follows the new one.
8. **Fairness.** The host holds its own orders back by about half the slowest friend's measured round trip (at most 250 ms) when that is over 60 ms.
9. **Saves.** The game (with each player's waiting orders and the AI seats) is saved on every device at month ends, on pause and when the tab is hidden. Reopen from Saved games, the others rejoin with the code and take their seats; the clock starts stopped.

### UX

LIVE badge, room code, the shared clock (Play/Pause, 1x/2x/4x, "Ask: ..." for friends when the host holds the clock), who paused, a sync line ("In sync · ping 109 ms", "Catching up with the host...", "The host's tab is in the background", "The host is away"), the number of orders on their way, toasts when an ally attacks or declares war and for chat, and Players and chat in the panel.

## Tests

- `src/net/liveOrders.test.ts`, `liveClockRules.test.ts`, `liveResilience.test.ts`, `liveSaves.test.ts`, `liveSession.test.ts`: MemoryHub, two and three players: tick sync, order latency and acks, refusal, duplicates, forged orders, simultaneous war declarations and attacks, host-only and voted pause and speed, vote lapse, lone player, hidden host catch-up, long sleep, desync injection and recovery, dropped message, reconnect, orders sent while offline, replaced-host messages, host leaves and takeover, resend to the new host, old host returns, AI seat and late seat take, kick, rematch, decisions that do not block, saves and resume.
- `src/net/liveSim.test.ts`: two humans for 24 months of live days at 4x with scripted orders (builds, budgets, training, wars declared at the same moment, attacks, a refused order) and bots, with a host whose ticks come in random bursts (100 ms to 3 s). On every day both screens must have an identical full-state checksum; invariants (finite numbers, unique army ids, owners exist) are checked; no resync may happen.

## Measured

See the end of this file (filled in from the real-relay run).

### Real two-browser run (Supabase Realtime relay, reachable through the proxy)

Two Chromium contexts (software GL), 1440x900 and 390x844, one room made as Live by default, a friend joining by code, nations Brazil and Germany, on the real relay (`kind: supabase`). Observed:

| check | result |
| --- | --- |
| lobby shows "LIVE · 1× · host sets the clock" to the joiner, settings read-only | yes |
| clock starts stopped; guest sees "Waiting for the host to start the clock" | yes |
| 1x for 10 s | host day +5, guest within one day (4); 2x: +10 days in 10 s, both screens the same day; 4x: about 2 days per second |
| guest presses Pause in a Host-only room | nothing paused; host toast "Bo asks to pause." |
| host pauses | both frozen for 3+ s; guest shows "Host paused (Hana)"; full-state checksums equal |
| orders on the relay: build (guest), declare war (both), attack (both), set deployment (both), missile strike (both) | all accepted; both screens show the same 2 armies and 2 salvos in the air; money spent by the guest shows on the host's copy |
| 4x for 30 s of real time (about 60 game days, month ends, both armies and missiles landing) | checksums equal after pause; 1 battle report on each screen |
| host tab "hidden" | guest shows "The host's tab is in the background: the clock may move in jumps." |
| host closes the tab | guest became host after about the heartbeat timeout, clock still running at 4x, no stall |
| saved room reopened on the guest's device after a reload, as Germany | opens paused at the saved day; a new browser took Brazil's seat from the "already playing" screen, got the game, same checksum; clock resumed on both |
| rematch | everyone back in the lobby with "LIVE" mode kept |

Round trip to the relay (measured by the heartbeat, shown in the panel): 109 to 136 ms.

Traffic, host side, 4x speed, 30 s with fights (60 game days): 46 messages and 6.2 KB sent (1.5 messages/s, about 205 bytes/s, about 100 bytes per game day, including the 2.5 s heartbeats); the guest sent 6 messages (0.7 KB) and received 40 (5.3 KB). At 2x: 17 messages and 2.3 KB in 10 s. A full game snapshot is only sent to a joiner, a seat taker, a reconnecting or out-of-step screen: about 45 KB in two messages of at most 40 KB. Supabase Realtime is configured for 30 events per second per client; a live room uses about 2 per second at most, so four players are far inside it. The MemoryHub simulation (24 months, two humans, 4x, bursty host ticks) averaged under 3 stream messages per game day and none over 20 KB.

Phone (390x844): the panel collapses to LIVE, a sync dot, Play/Pause, speed and a chat button; the longer status lines are hidden there (they are in the title of the dot).

### Mutation checks

Each of these one-line changes to the rules makes its guarding test fail (run, seen failing, reverted): one vote is enough to pause (3 failures), the host accepts an order for another nation, the checksum is never compared, a missing stream message is never noticed, the host's catch-up is capped at 250 ms like the solo loop (3 failures), guests may pause in host-only rooms (6 failures), a re-sent order is done twice, month-end orders are not run in the seeded order, the AI does not play an away player's nation.

## Not done / not verified

- Only one real network path was tried (this sandbox through its proxy to Supabase, both browsers on the same machine). Two computers on different networks, packet loss and jitter on a real mobile line are untested; the loss and reordering cases are covered with the in-memory hub only.
- A really backgrounded Chrome tab (its timers throttled by the browser, intensive throttling after five minutes) was simulated (late ticks in tests, `document.hidden` set in the browser run), not observed.
- The e2e run gave both nations money and missiles through the dev-only `window.__session` hook (identically on both screens) so a war and a strike were possible in the first game months; the game's own rules otherwise.
- "Players vote" was tested in unit tests, not in the browser.
- The host's fairness delay needs a measured round trip over 60 ms; it was in range on the relay but its effect was not measured.
- A decision (event) default at the month end is covered by tests; the Event window's wording was not changed for live.
- Cancelling a queued month-end order is not possible once sent (a later order of the same kind replaces it); the tray says so.
- The host persists every 10 game days, at month ends, on pause and when its tab is hidden; a tab killed between saves loses up to ten days when the room is reopened from the save (a friend who takes over as host keeps the live game, nothing is lost).
- Auto-command, undo and the turn-mode Ready flow are off in live rooms by design.
