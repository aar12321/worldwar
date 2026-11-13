# Worlds of Others

A browser-based, turn-based grand strategy game of total global hegemony. You command one of 175 nations; every other nation is run by an AI rival, or by a friend: one to four people can play the same world online. One turn is one month, starting January 2026.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (Vitest)
npm run build      # type-check + production bundle
```

## How to play

The game is turn based. One turn is one month, starting January 2026. Nothing moves until you press **Next turn** (or Enter).

1. Pick a nation on the main menu (search the list or click the globe), and choose how skilled your rivals are. **You win by holding the whole world**: every country yours or a puppet of yours. It is a long game, built for about 12 to 15 hours of play. Taxes start at the neutral 20% (and business tax at 15%), so every change you make has an effect. **Easy** rivals play the basics, wait a long time before attacking you, and never band together against you. **Medium** rivals also grow cities, set budgets and laws, fund business, and form alliances and blocs. **Hard** rivals also borrow, invest abroad, sanction, counter the units you field, press an ally's enemy together, and turn a crushing win into a puppet state.
2. The game is run from **five desks** on the left:
   - **Briefing** (`B`): your goal, a first-steps checklist for new players, and your advisor's list of what needs you this month. Every item has a button that takes you to the fix.
   - **Economy** (`E`): seven tabs. *Country* shows **your whole empire in one list** (every country you hold, its trait, how settled it is, and a **governor** who upgrades it each month on a plan you choose), then grows your cities (each takes a focus that boosts the whole country: industry, farming, harbor, research, fortress, finance) and buys Factory, Farm, University, Barracks, Port and Civic Hall upgrades. *Budget* shows where money comes from and goes, sets income tax and the draft, and runs the treasury: borrow with bonds, pay interest, keep a credit rating, or default. *Market* buys and sells food, oil, steel and goods at world prices, within a monthly trade limit that ports raise, with auto-buy for shortages. *Stocks* is the world exchange: made-up companies whose prices follow the economy, stability, taxes and troubles of their home countries, with dividends, crashes and rallies. Owning a tenth of a country's companies makes it fond of you; at war, your shares there are seized. *Business* has six private sectors that grow by themselves (set the business tax, give grants, subsidize, invest abroad). *Government* picks democracy, monarchy, junta or one-party rule, splits tax money across military, education, health and infrastructure, and passes ten laws. *People* shows food, goods, work, pay, peace and order.
   - **Military** (`M`): four tabs. *Systems* runs the Frontier programs (below). *Agencies* runs your intelligence service (the CIA in the USA) abroad and your security service (the FBI) at home: gather intelligence, build a case for war, sabotage, arm rebels, help a friend keep order, steal technology, back a coup on a shaky nation, and (with Cyber Warfare) cyber attack. Odds come from agency level, experience, technology, partners and the target's own security, and are shown before you commit. A noticed failure costs reputation and hands the target a reason to fight you. *Forces* trains infantry, tanks, artillery, fighters, bombers and warships (they arrive after 1 to 3 turns; vehicles cost steel and burn oil, and fighters decide how much bombers can do), buys permanent weapon levels and drill, and appoints a commander. Every unit shows its attack and defense and where each bonus comes from; battles use exactly those numbers. *Wars* (`W`) lists your wars (three at most), their monthly bills and each front's Defense Line.
   - **Diplomacy** (`D`): offers waiting on you, deals, and every neighbor's opinion of you with pacts, alliances, guarantees, trade, loans, investment, sanctions and peace terms, including making a defeated nation a puppet that pays tribute.
   - **Research** (`R`): spend research on technologies, in six branches. The **Frontier** branch holds the milestones: combat drones, cyber warfare, missile defense, artificial intelligence, hypersonic missiles, robotics, quantum computing, orbital systems and nanotechnology. Each unlocks something real, with a counter: **Combat Drones** (a unit that takes the first losses and shreds tanks and guns; shot down by fighters and shields), **Robot Infantry** (no soldiers needed, their losses never tire your people; hacked by a higher Cyber Command), **Hypersonic Batteries** (strike first in their own opening round, crack the Defense Line directly, and can hit a country within 6000 km; an Interceptor Shield stops a share), and six systems bought in three levels with upkeep: **Cyber Command**, **Interceptor Shield**, **AI Battle Command** (more attacks a month, exact odds, a stance recommendation), **Quantum Codebreaking** (warnings of where an enemy could strike), **Orbital Network** (intelligence on enemies, easier landings, one orbital strike a year) and **Nano-armor** (less damage, part of every loss comes back). The strikes are in the War Room.
   - News (`N`), help (`?`) and settings sit in the top-left bar.
3. **War needs a reason.** A great power cannot just attack a neighbor. A reason comes from a border incident, an attack on your ally or a country you guarantee, a rival caught spying on you, sanctions against you, standing with a victim in a crisis, an operation by your intelligence service, or a **case** you build yourself (20 influence, ready in 3 months). With a reason, war costs 10 influence. Without one it costs 60, drops your stability, and the world distrusts you: every attack and captured country adds to your **reputation for aggression**, which makes other nations uneasy until it fades over a couple of years. Rivals follow the same rules.
   **The news** arrives in stages, never early: a rumor, a disturbance, then a crisis (unrest in a country, or one nation threatening another). You can send aid, mediate, or back the victim, or ignore it. Left alone it may boil over into uprisings or war, and allies may call you to join.
   **War is a campaign.** Click a neighboring country and press **Declare war**. You can attack across a border or a short sea lane; a port plus warships reaches any coast in the world, and fighters or strike aircraft with a factory as an airbase reach anything within 7000 km (these fight with a landing penalty). Then press **Plan an attack** (`A`) to open the War Room: choose how much of your military to send (Probe, Main force or All in) and how to fight (Assault, Blitz or Siege). The room shows honest odds, expected losses and what the war costs. Each win pushes back the country's **Defense Line**; when it reaches zero the country falls. Big countries and capitals have long lines, small ones short. Lines heal a little in months nobody attacks them.
   - **Units you send are away until the turn ends**, so your home army fights at reduced strength and rivals can punish an all-in attack.
   - **Every war costs a monthly bill** that grows with your military and the enemy's size, and tires your people. A small country can be in three wars at once, and one more for every 12 countries it holds (up to eight). Your military can also launch more attacks a month as the empire grows: three, plus one for every six countries (up to nine). Training slots, influence and the number of unsettled countries you can hold also grow with the empire. A nation whose capital has fallen and whose army is gone, or under a fifth of yours, surrenders whole. A puppet that has served three months can be **annexed** for 20 influence, and no nation costs more than 80 war score to make a puppet, however big.
   - **Every country has a trait** (chip foundries, financial hub, energy giant, rare minerals, breadbasket, mountain stronghold...) that helps your whole nation once it settles. When a nation falls its conqueror also takes 40% of its treasury and learns a technology it knew.
   - **Conquered land starts restless** and produces about 40% at first, settling over six months. Holding many unsettled countries strains stability.
4. **Next turn** runs the rivals, training, research, income, diplomacy, rebels and any attacks on you, replays the battles you were in, then shows a **monthly report**: what changed, the news, and what the advisor would do next.
5. The **map control** (bottom left) switches the globe between Nations, Relations (allies, pacts, enemies) and Fronts (how much Defense Line is left).

## Play with friends (1 to 4 players)

On the main menu press **Play with friends online**, type a name, and **Create a room**. You get a five-letter code. Friends press the same button, choose **Join a room** and type it. In the lobby everyone picks a nation, and the host sets the rules: rival skill (Easy, Medium, Hard), how you win, and how long each month lasts (no timer, 1, 1.5, 2 or 3 minutes). Nations nobody picks are run by the AI, and AI nations still ally, trade and fight each other.

- **Everyone plans the same month at once.** Press **Ready** when you are done. The month moves on when every player is ready, or when the timer ends. Press the button again to keep planning. Players who are away are skipped, and their nation is run by the AI until they return.
- **Attacks wait for the end of the month online.** In a one-player game an attack plays out the moment you order it. Online, it joins your plan and is resolved at month end in a seeded order, so nobody wins by clicking faster. Builds, trades and training still happen at once.
- **No random events online**, since one player's choice would stall the others.
- The first player to reach the goal wins. A player whose nation falls keeps watching; the game ends when someone wins or every player has fallen.
- Open **Players and chat** under the Ready button to see who is ready and to talk. If your tab closes, press **Rejoin** on the same menu to take your seat back. If the host leaves, the next player takes over the game.

### Connecting players

The room code is shared through [Supabase Realtime](https://supabase.com/docs/guides/realtime) broadcast. No tables or accounts are needed, only a project's URL and public ("anon") key, which the browser reads at build time:

1. Create a free project at supabase.com. Realtime broadcast is on by default.
2. Copy **Project URL** and the **anon public** key from *Project Settings, API*.
3. For local use put them in `.env.local` (see `.env.example`). For a deployed site set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` where the site is built, then build again: Vite bakes them in.

```bash
cp .env.example .env.local   # then edit the two values
npm run dev
```

Without them the game still runs, and **Play with friends** works in a practice mode between tabs of the same browser (open the page twice). It cannot connect different computers.

How it works: the host's browser runs the same pure engine as a one-player game and is the referee. Other players send their plan for the month to the host, who checks every order against that player's own nation, resolves the month, and sends the new game back (compressed, in pieces under 50 KB). Everyone's game is therefore identical. The room is a trust-your-friends design: the host's browser holds the truth, and there is no server-side anti-cheat. Messages are not encrypted beyond what Supabase provides, so do not share the room code with strangers.

Shortcuts: `Enter` next turn, `B` briefing, `E` economy, `M` military, `W` wars, `D` diplomacy, `R` research, `N` news, `A` War Room for the selected country, `?` help, `Esc` close.

## Architecture

```
src/
  engine/      Pure, deterministic simulation (no DOM). resolveTurn(state, map, orders) -> new state
    resolveTurn.ts  one month: month-end orders, training, attacks, rebels, economy, diplomacy, events
    orders.ts       validation and costs. Orders in MONTH_END_ORDERS wait for Next turn; the rest apply at once
    militaryStats.ts  the per-unit stat sheet and military power (battles and the AI read the same numbers)
    combat.ts / warfare.ts  3-round battles, whole-country capture, garrisons, rebels
    arms.ts / training.ts   weapon levels, training slots and queue
    economy.ts / diplomacy.ts / espionage.ts / tech.ts / victory.ts
  data/        Tech tree, units, buildings, terrain, events, country stats, starting nations
  ai/          Rule-based orders for every nation no human plays (same rules as the player): bot, diplomat, management, opinion, blocs
  net/         Online play: protocol (messages, room codes, compressed snapshots), transport (Supabase Realtime, same-browser fallback), session (lobby, host, ready, timer, host handover)
  map/world.ts Natural Earth 110m countries -> regions, adjacency, coastlines, sea lanes
  ui/          React: globe, HUD, drawers, Modal, battle window, diplomacy, tech tree
  store.ts     Zustand store: orders, turn flow, battle queue, autosave (localStorage)
```

The engine is seeded and side-effect free, so the same seed and orders always produce the same world. `GameState.humans` lists the nations people play (one in a one-player game), so a multiplayer game and a single-player game run the same code. Online, the host resolves each month and everyone else receives the result.

## Tech stack

Vite, React 19, TypeScript, Zustand, Framer Motion, Tailwind CSS v4, three.js via `react-globe.gl`, `world-atlas` + `topojson-client` + `d3-geo` for map data, Vitest, and `@supabase/supabase-js` for online rooms.
