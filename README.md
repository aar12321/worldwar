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
2. **Country** (`C`): buy upgrades for your whole country. Factory (money), Farm (food), University (research), Barracks (training slots and defenders), Port (trade and sea attacks) and Civic Hall (influence and research). Upgrades work the moment you buy them. The Economy tab sets taxes and the draft; the Laws tab passes laws.
3. **Military** (`M`): you have one military. Train units (they arrive after 1 to 3 turns), drill each unit type, buy permanent weapon levels (0 to 5, gated by factory level), and appoint a commander who drills for free. The stat sheet shows every unit's attack and defense and where each bonus comes from. Battles use exactly those numbers.
4. **War is a campaign.** Click a neighboring country and press **Declare war** (costs influence). Then open the **War Room** (`A`): choose how much of your military to send (Probe, Main force or All in) and how to fight (Assault, Blitz or Siege). The room shows honest odds, expected losses and what the war costs. Each win pushes back the country's **Defense Line**; when it reaches zero the country falls. Big countries and capitals have long lines, small ones short. Lines heal a little in months nobody attacks them.
   - **Units you send are away until the turn ends**, so your home army fights at reduced strength and rivals can punish an all-in attack.
   - **Every war costs a monthly bill** that grows with your military and the enemy's size, and tires your people. You can be in **at most three wars** at once (the Wars panel, `W`, tracks them).
   - **Conquered land starts restless** and produces about 40% at first, settling over a year. Holding many countries strains stability. The People tab in Country shows food, work, pay, peace and order.
5. **Next turn** runs the rivals, training, research, income, diplomacy, rebels and any attacks on you, then replays the battles you were in. Decision events appear every few months.

Shortcuts: `Enter` next turn, `A` open the War Room for the selected country, `W` wars, `C` country, `M` military, `T` research, `D` diplomacy, `L` news, `?` help, `Esc` close.

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
