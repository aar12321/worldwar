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
