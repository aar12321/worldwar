# Worlds of Others

A browser-based grand strategy game of total global hegemony. You command one of 175 nations; every other nation is run by an AI rival. One turn is one month, starting January 1936. All orders are submitted simultaneously and resolved together when you press **Next Turn** (or the optional turn clock runs out).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (Vitest)
npm run build      # type-check + production bundle
```

## How to play

1. Pick a nation on the main menu (search the list or click the globe), choose a victory condition (25% / 40% / 60% of world population), and begin.
2. Click a region to open its panel: build Factories, Farms, Universities, Barracks, and Ports. Each country holds a few muster territories. An empty muster summons one army, and you can recruit or train that army only while it is standing there.
3. Train an army up to five times, from Green to Guard, for up to +40% combat power. Sign a weapons contract on the Nation panel, or buy arms from another nation, to sharpen one unit type. Select an army, press **Attack** (or **Move**), then click a highlighted region on the globe to draw a front. Assign a general for trait bonuses.
4. Balance the five resources in the HUD (hover any resource for a breakdown):
   - **Manpower**: civilians work; the draft rate moves them into the military pool.
   - **Capital**: taxes, factories, and port trade, minus upkeep.
   - **Food**: shortages give armies -30% combat power and erode stability.
   - **Political Points**: wars, laws, crackdowns, treaties.
   - **Tech Points**: spend in the Tech Tree (press `T`).
5. Every 2 to 4 turns a **Critical Decision** event demands a choice before the month can end.

Shortcuts: `Enter` next turn, `Esc` cancel / close, `T` tech, `N` nation, `D` diplomacy, `L` dispatches.

## Architecture

```
src/
  engine/      Pure, deterministic simulation (no DOM). resolveTurn(state, map, orders) -> new state
    economy.ts   resources, labor, food, stability, rebels
    combat.ts    3-round battles: terrain, combined arms, generals
    warfare.ts   moves, attacks, captures, secession
    supply.ts    supply BFS from the capital, attrition, surrender
    events.ts    decision event scheduling and effects
    diplomacy.ts / espionage.ts / tech.ts / orders.ts / victory.ts / visibility.ts
  data/        Tech tree, units, terrain, events, country stats, starting nations
  ai/bot.ts    Rule-based bot orders for every non-player nation
  map/world.ts Natural Earth 110m countries -> regions, adjacency, coastlines, sea lanes
  ui/          React components: globe, HUD, panels, tech tree, events, battle FX
  store.ts     Zustand store: orders, turn flow, FX queue, autosave (localStorage)
```

The engine is seeded and side-effect free, so the same seed and orders always produce the same world. That makes it straightforward to move turn resolution to an authoritative server for real multiplayer later.

## Tech stack

Vite, React 19, TypeScript, Zustand, Framer Motion, Tailwind CSS v4, three.js via `react-globe.gl`, `world-atlas` + `topojson-client` + `d3-geo` for map data, Vitest.
