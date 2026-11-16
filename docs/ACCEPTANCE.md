# Acceptance pass

A player's-eye pass over every feature the plan and the later list promised: found through the real screens, used to a visible result, and checked on desktop (1440x900) and phone (390x844). Driven with Playwright against `vite` (software GL). Money, tech, countries and war score were handed over through the store only to skip long waits; every feature itself was performed by clicking and typing. Online play ran two browsers against the real Supabase relay.

Columns: **desktop / phone** say where it was checked. "Turn" and "live" say the mode. A fix names its commit topic.

## Result at a glance

All listed features were reachable and worked end to end except where the table says otherwise. Four real defects found and fixed (online ready dots stuck on guests; no control for the liberate peace term; map colors hidden behind any open desk with nothing else leading to them; missile palette entry opened the wrong tab). Nothing found that is still broken. Items not exercised in a browser are listed at the end with the reason.

## A. Online play

| Feature | How reached | Works end to end? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Create room, code | Setup, Play with friends online, name, Create a room | Yes (real relay, desktop) | Big 5-letter code, player list | none |
| Join by code | Same window, code box, Join | Yes (second browser) | Both lists update | none |
| Pick nations | Lobby nation list | Yes | "Your nation", player rows show the nation | none |
| Ready, month resolves | HUD Ready button | Yes: both Ready, month 2 on both | "0 of 2 ready" dots, Waiting for others, monthly report | **Bug fixed:** the guest kept "2 of 2 ready" and no Ready button after the month (a ready list for the old month arrived after the new state). Now a new month clears the dots and a late list from an old month is dropped; two tests in `net/session.test.ts` |
| Offers between humans | Diplomacy, human card ("Played by Bob"), Peace pact | Yes: Bob sees it next month, accepts | Toast "You have a new offer waiting in Diplomacy", badge on the rail, "Awaiting your answer" with Accept/Decline; sender sees "Waiting on other players" | none |
| Events online | Engine and session tests (one decision per player, default choice) | Tests only | n/a | not forced in the browser (events are random) |
| Saves and resume / seat pick | Setup online window lists saved rooms; session tests | Tests, list present | n/a | not exercised in the browser |
| Host leaves, takeover | Players and chat, Leave the game, confirm | Yes: the other player's month resolved and they took over | Report shown on the guest | none |
| Kick | Players and chat, Remove, confirm | Yes: the guest returns to the menu | Confirm dialog explains the AI takes the seat | none |
| Rematch, scoreboard | End-of-game window (host Rematch, Final standings) | Code and tests; a won game was not played in the browser | n/a | needs a finished game |
| Per-player colours | In game | Yes | Alice red, Bob blue on the globe and rows | none |
| Reconnect pill | Guest offline for 45 s | Yes: "Reconnecting..." under Ready, gone on return | Yes | takes about 30 s to show |
| No undo online | Order tray | Yes (no Undo online, by rule) | n/a | none |
| Phone | Host at 390 px | Lobby, game, people panel, Remove all fit, no sideways scroll | Yes | none |

## B. People tab

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Sections, 22 policies | Economy, People (Overview, Health, Learning, Work, Family, Safety, Campaigns) | Yes | Each policy shows Off, Pilot, National, Universal with effects and the cost "4 influence, then 2.3 money a month" | none |
| Raise a policy | Health, Pilot | Yes: "1 of 4 in force", care budget -2.3 | Budget tab shows "Programs for the people -2.3" | none |
| Campaigns | Campaigns, Run it | Yes: "Running, 6 months left, ready again in 18" | Yes | none |
| Stability breakdown, care budget | Overview | Yes | Every cause in points, "heading for 72%" | none |
| Phone | More sheet or Ctrl+K | Opens, no overflow | Yes | none |

## C. Projects tab

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| National projects (levels, rush, pause) | Economy, Projects, National | Yes: Start, then "8 months left, -40 a month, Rush 160, Pause" | Budget line "Building costs" | none |
| Local projects, slots | In your countries | Yes: eight kinds, needs shown (university, coast, mountains) | "0 of 2 up to 2 at once" | none |

## D. Missiles and aircraft

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Missile program | Military, Systems, Raise to level 1 | Yes | Level, capacity "5 of 5 this month" | none |
| Build 1 / custom | Systems, Build 1, Custom stepper, Build N | Yes: joins stock at once | "in stock" count per type | none |
| Fire 1 / custom (turn) | War Room, Missiles: Fire 1 cruise missile, Fire N | Yes (order queued, resolves at month end) | Cost and effect on the button | none |
| Not built yet | War Room missile box | "Open the program" link | Yes | none |
| Hypersonic | War Room, Train under Forces | Reachable | Shown with stock 0 and a link | none |
| Aircraft development | Forces, Develop; Ctrl+K "Aircraft development" | Yes: 16 developments, "Start development" with cost and needs | Yes | none |
| Palette entry for missiles | Ctrl+K "Missile program and stockpile" | **Fixed:** it opened Forces; the program lives in Systems | Yes | now opens Systems |
| Shields, countermeasures, retaliation, live flight | Rules and live flight text in War Room and nuclear card | Verified for the nuclear flight; re-checked after the merge: tab and War Room rows open; deeper play left to the missile work | n/a | left to that work |

## D2. Missile War (after merging main at 8647cbd)

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Missile War tab | Military, Missile War; Ctrl+K "Military > Missile War" | Yes on desktop and phone: opens, no error screen, no sideways scroll | Tension ladder (Calm to Nuclear brink), next steps, Defences with radar, interceptor rounds, batteries, mobile launchers and their costs | none |
| War Room missile rows | War Room, Missiles | With no stock it says so and offers "Open the program" (desktop and phone) | Yes | the aim toggle, raids and scramble need missiles in stock and a live war; not exercised in the browser |

## E. Space program

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Gate message | Economy, Space with no Fifth-Generation Fighters | Yes: says what to research | Yes | none |
| Hire, launch site, rocket development | Agency: Hire 4, Raise to level 1; Rockets: Develop | Yes: "Developing level 1: 4 months left, 15.0 a month" | Budget shows "Space budget -32.4" | none |
| In-house vs outsource | Missions tab | Both priced side by side, odds shown, private companies table | Yes | none |
| Labs, claims, outposts, mines | Labs, Colonies | Present with cost and "land on X first" gates | Yes | full flight sequence is covered by `spaceLong.test.ts` |
| HUD chip | Flight under way | Yes: "Suborbital test flight: in flight, 2 mo left, Space >", click opens Space | Yes | hidden while a desk is open, by design |
| Globe ring at the launch site | Flight under way | Code present; not distinguishable in a still image behind the capital labels | Unverified | |

## F. Active military, borders, theatres

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Deployment (stations) | Military, Deployment | Yes: coastal, submarine, air, one card per border | Yes | none |
| Theatres, presets, alert levels | Military, Theatres, Balanced | Yes ("Forces were moved this month") | Cards per front, alert Relaxed / Normal / High | none |
| Borders map | Map control; keys 4 to 7 | Yes: coloured borders, tension badges, garrison badges, dashed sea lanes, legend | Yes | **Fixed:** the map control hides while any desk is open (the Briefing opens first), so a new player never saw Borders. Ctrl+K now has "Map colors: ..." and the box was widened because "Borders" was cut off. Help and README say where it is |
| Unit cards, strait badges | Show on globe; click a badge | Badges and sea chokepoints drawn | Yes | none |
| Shows of force | Theatres cards | Present | Yes | cost and effect text; not fired |

## G. Superpower

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| World reaction | Empire, World reaction | Yes: threat 37 of 100 Alarmed, what is coming, who draws together, pact offers | Yes | none |
| Warheads build / launch | War Room, Nuclear strike card | Yes (live): build button with costs, 4-month build, launch cooldown | Count "2 warheads" | none |
| Confirmation | Launch the missile | Yes: lists consequences, retaliation by "China and United States of America", a tick box is required | Yes | none |
| Live flight arc | After launch, clock running | Yes: dashed arc from the launch site to the target, target highlighted | Yes | none |

## H. Factions

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Found | Faction rail entry, name, Found the faction | Yes: queued, exists next month | Share 100%, rules, Pool worth, Joint army | none |
| Invite, contribute, vote, contracts, war log | Faction tabs: Council, Pool and members, Contracts, War log | Present and labelled (Invite a nation, Put in or take out, Put the war to the vote, contract forms) | Yes | joint war and live army: `factionLive.test.ts` |
| Notifications | Rail badge for votes and invites | Test (`factionToasts.test.ts`) | n/a | |

## I. Puppets

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Make a puppet | War, Diplomacy, Negotiate peace, "Make them a puppet state" | Yes: Denmark accepted next month, loyalty 59 | Yes | none |
| Puppets tab | Empire, Puppets (appears with the first one) | Yes: tribute, loyalty, tax and draft, laws, Rule it, Annex (12 months), Set it free | Yes | none |
| Liberate peace term | Diplomacy, Negotiate peace, "Set a puppet free" | **Added:** a drop-down of the puppets of that master you may free (engine `liberablePuppets`), cost in war score, the LIBERATE_TEXT strings, the offer sends and shows "Already proposed" | Yes | test `liberation.test.ts` |

## J. War stage

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Declare war | Country panel, Declare war, confirm | Yes | Wars badge, "Plan an attack" | none |
| Per-unit steppers, quick buttons | War Room | Yes (six unit kinds, None / Half / Probe / Main force / Max) | Yes | none |
| Win gauge and breakdown | War Room | Yes: "~100% Likely, 85% to 100%", "What decides it" rows with Why? | Yes | none |
| AI Battle Command levels | War Room | Level notes shown; level 3 (set through the store) gives goals, "Plan this attack for me", Rank targets, Auto-command | Yes | none |

## K. Scenarios, settings, help

| Feature | How reached | Works? | On screen? | Issue / fix |
| --- | --- | --- | --- | --- |
| Scenario picker, Briefing progress | Setup, Standard game / Choose | Yes: "Small Among Giants" started, Briefing shows "Months survived 0 of 60" | Yes | none |
| Difficulty | Setup rivals Easy / Medium / Hard (described) | Yes | Descriptions on the cards | |
| Country dropdowns | Agencies target and others | Lists present; searchable pickers in Faction | Yes | none |
| Ctrl+K | Top bar search icon, Search in the rail, Ctrl+K or / | Yes | **Fixed:** a country now comes before the Agencies and Diplomacy rows of the same name | |
| Settings: text size, contrast, colour-blind | Settings, Look and feel | Present: Small, Normal, Large, Largest; High contrast; Color-blind safe colors | Yes | |
| Keys sheet, Help | "?" or the help icon; Keyboard shortcuts tab | Yes | Help lists every feature; accurate (checked Missile program, Aircraft, Borders text) | Borders text updated |
| Advisor links | Briefing advice buttons | Research, Military, Cities, map all land on the right desk | Yes | none |
| Briefing guide | Briefing | First steps plus a new "More to explore" row: People, Projects, Space, Deployment and theatres, Missiles, World reaction, Factions, Diplomacy | Yes | **Added** |
| Live game | Setup, Live | Clock runs, Play / Pause, 1x 2x 4x, days left in the month | Yes | none |

## Every desk and tab opens

Ctrl+K to each of the 27 desks and tabs of `registry.ts` at 390 px, then 1440 px: all open, none showed the error screen, none overflowed sideways. Empty states say what to do (Wars: "Open. Pick a neighbor on the globe and declare war"; Space: "Nothing yet. Hire a few engineers..."; Puppets tab appears with the first puppet). Console: the only error is a dev-server 403 for the Inter font file caused by this checkout symlinking `node_modules` from outside the project; it is not in the game.

## Not verified, and why

- Online: events, saved-room resume, rematch and the final standings need a finished or random-event game; covered by `net/session.test.ts`.
- Missile shields, countermeasures and retaliation in a live game: another agent is rewriting missile play.
- Space globe ring and a full flight sequence: the flight sequence is in `spaceLong.test.ts`; the ring is not visible in a still image.
- Faction invite, contribute and vote through two humans in a browser: the screens were opened and labelled, the rules are test-covered.
- Phone width was swept for opening and overflow; single features (War Room, Space) were exercised at desktop width only.
