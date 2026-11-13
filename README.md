# Worlds of Others

A browser-based, turn-based grand strategy game of total global hegemony. You command one of 175 nations; every other nation is run by an AI rival. One turn is one month, starting January 1936.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (Vitest)
npm run build      # type-check + production bundle
```

## How to play

The game is turn based. One turn is one month, starting January 1936. Nothing moves until you press **Next turn** (or Enter).

1. Pick a nation on the main menu (search the list or click the globe), choose a victory condition (take 3, 6 or 12 countries, or lead 25% / 40% / 60% of world population), and begin.
2. The game is run from **five desks** on the left:
   - **Briefing** (`B`): your goal, a first-steps checklist for new players, and your advisor's list of what needs you this month. Every item has a button that takes you to the fix.
   - **Economy** (`E`): four tabs. *Upgrades* buys Factory (money), Farm (food), University (research), Barracks (training slots and defenders), Port (trade and sea attacks) and Civic Hall (influence and research); they work the moment you buy them. *Budget* shows where money comes from and goes, and sets taxes and the draft. *People* shows food, work, pay, peace and order. *Laws* passes laws.
   - **Military** (`M`): two tabs. *Forces* trains infantry, tanks, planes and warships (they arrive after 1 to 3 turns), buys permanent weapon levels and drill, and appoints a commander. Every unit shows its attack and defense and where each bonus comes from; battles use exactly those numbers. *Wars* (`W`) lists your wars (three at most), their monthly bills and each front's Defense Line.
   - **Diplomacy** (`D`): offers waiting on you, deals, and every neighbor's opinion of you with pacts, alliances, trade and peace terms.
   - **Research** (`R`): spend research on technologies.
   - News (`N`), help (`?`) and settings sit in the top-left bar.
3. **War is a campaign.** Click a neighboring country and press **Declare war** (costs influence). Then press **Plan an attack** (`A`) to open the War Room: choose how much of your military to send (Probe, Main force or All in) and how to fight (Assault, Blitz or Siege). The room shows honest odds, expected losses and what the war costs. Each win pushes back the country's **Defense Line**; when it reaches zero the country falls. Big countries and capitals have long lines, small ones short. Lines heal a little in months nobody attacks them.
   - **Units you send are away until the turn ends**, so your home army fights at reduced strength and rivals can punish an all-in attack.
   - **Every war costs a monthly bill** that grows with your military and the enemy's size, and tires your people. You can be in **at most three wars** at once.
   - **Conquered land starts restless** and produces about 40% at first, settling over a year. Holding many countries strains stability.
4. **Next turn** runs the rivals, training, research, income, diplomacy, rebels and any attacks on you, replays the battles you were in, then shows a **monthly report**: what changed, the news, and what the advisor would do next.
5. The **map control** (bottom left) switches the globe between Nations, Relations (allies, pacts, enemies) and Fronts (how much Defense Line is left).

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
  ai/bot.ts    Rule-based orders for every non-player nation (same rules as the player)
  map/world.ts Natural Earth 110m countries -> regions, adjacency, coastlines, sea lanes
  ui/          React: globe, HUD, drawers, Modal, battle window, diplomacy, tech tree
  store.ts     Zustand store: orders, turn flow, battle queue, autosave (localStorage)
```

The engine is seeded and side-effect free, so the same seed and orders always produce the same world. That makes it straightforward to move turn resolution to an authoritative server for real multiplayer later.

## Tech stack

Vite, React 19, TypeScript, Zustand, Framer Motion, Tailwind CSS v4, three.js via `react-globe.gl`, `world-atlas` + `topojson-client` + `d3-geo` for map data, Vitest.
