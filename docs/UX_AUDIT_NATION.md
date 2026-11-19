# UX and logic audit: the nation side

Scope: the Economy desk (Country, People, Budget, Bank, Business, Projects, Space, Market, Stocks, Government), the Empire desk
(Overview, Provinces, World, World reaction, Statistics, Territories, Puppets), Research, the Briefing and the advisor's targets.
Military, Diplomacy, Bloc, the HUD, the rail and Help belong to another audit; Relations and the War Room planner are being
redesigned elsewhere and were not touched.

Rule followed: consolidate, do not delete. Every control that was on a page is still in the game; where a number appeared in two
places, one place keeps it and the other links there or keeps a single summary line. No engine rule changed, so the golden hashes
did not move. The engine files touched are the advisor's *targets* (where a button goes) and its type, nothing it computes.

Screenshots: `node scripts/nation-shots.mjs --out <dir> [--mode live] [--only economy-budget,tech]` opens Poland (seed 3), plays
three months, binds a territory and a puppet so their tabs show, hides the globe, and saves the top and the whole page of every
tab at 1440x900 and 390x844, printing each page's height.

## What was duplicated, and where it lives now

| What | Was in | Lives in | The other place now |
|---|---|---|---|
| Talent and staffing (engineers, scientists, doctors, who uses them) | People, Who works (four coverage chips); Government, Talent; Space, Agency | Government, Talent | People keeps the skill mix and what factories and universities run at, with a "Who needs them" button to Talent; Space keeps its own staff and links "Who else wants engineers" |
| Government summary (approval, cabinet, unemployment, civil service, talent short, bills) | A row of tiles above every Government section, plus each section's own tiles (Jobs opened with two rows of the same figures) | The Overview | Tiles lead the Overview only; Jobs and Talent open with their own tiles |
| Unemployment and the labour force | Government tiles, the Overview's Jobs card, the Jobs section; People tile | Government, Jobs (People keeps one tile) | The Overview's Jobs card, a repeat of the tiles, became "Laws and elections" |
| Inflation | Bank tile and the Central bank card's "Inflation now" | Bank tile | Line removed |
| Wealth fund balance | Bank tile and the fund card's "In the fund" | Bank tile | Line removed |
| World Bank loan limits | Empire Overview tier table and a three-line card in Empire World | Overview table | World keeps one sentence and a link to Diplomacy, where loans are made |
| Tax and draft | Budget only (the HUD shows the rate read-only; puppets have their own) | Budget | Unchanged. The draft slider now says why it stops at 20% (Conscription law) |
| Project slots | Projects tiles (each tile also repeated its own number as "up to N at once") | Projects | Tile subtitle says what the number means; the Empire table keeps "Projects at once" as a tier fact |
| Stability breakdown | People Overview (the reasons); Government shows the desk's own share and approval | People | Unchanged; Government links back by its tile only |

## What was trimmed (page heights, before and after, at 1440x900 and 390x844)

The numbers are the scrolled page height in pixels (from `nation-shots.mjs`). See the table at the end, filled from the runs.

- **Budget**: three tiles first (left over a month with what comes in and goes out; the treasury after this month's orders, or
  how long it lasts when the month runs at a loss; food a month and in store); taxes and draft next; the 25 money lines grouped into Income, Military, People and care, Building, Running the
  state, Debt and business, each a fold with its subtotal and a "Set in ..." button. Costs are no longer all red; only the
  bottom line warns.
- **Business**: six cards of buttons became one Sectors card. Each row shows size, State and Subsidized; tapping it opens the
  grants, buy, seize or sell, and the subsidy, exactly as before.
- **Projects**: "Yours" (built or building) first, then "You can start", then "For a bigger empire" folded per tier. Locked
  projects are still there in full inside the fold.
- **Bank**: Directed credit and Wealth fund, when locked, share one small "Opens with a bigger empire" card; War bonds is a card
  only at war (or while war bonds are owed) and a line under Bonds otherwise.
- **Market**: each good had Buy 5, Buy 20, Sell 5, Sell 20 and a custom Buy and Sell. Now one amount with 5, 20 and 50 presets
  and one Buy and one Sell.
- **Country**: "Upgrade everything at once" and "Set a governor for every country" fold under the empire list. The page now
  names the country it shows (it showed only its trait) and says if it is still settling.
- **Stocks**: the kit's tiles (they fold into rows on a phone) in place of hand-made ones; the rules paragraph folds under
  "How shares work".
- **Government, Laws**: laws in force first; the other forms of government fold away.
- **Research**: "What your technology gives you" was open by default and pushed the tree down a screen; it is closed, with a
  count. The header shows research a month beside what is available. A filter shows one branch, or only what can be researched
  now (all seven branches stacked were 19 screens on a phone).
- **Projects tiles**: building costs and upkeep are one tile ("Projects a month", split in its subtitle), so the row is three.

## Logic issues fixed (all on screen; no engine rule changed)

1. **Projects: months left, total cost and rush ignored the build speed.** The engine adds `projectSpeed` (engineer coverage
   times public works, 0.4 to 1.1) to progress each month and charges the monthly bill until done. Cards counted one month a
   month: short of engineers a project said "6 months, 300 money" and took up to 15 months and 750. Cards now divide by the speed,
   say "about", and say why when slowed; a rush's saving is in real months.
2. **Public works said "Costs X a month at standard"** while showing the chosen level's cost, without the upkeep multiplier the
   Budget line uses. It now shows the Budget's own Public works line, and its effects come from `WORKS` and `worksSpeed` (it also
   names Defense Line repairs, which the level changes).
3. **Bank bond rate** was worked out in the page and left out the reserve currency's discount; it now calls `newBondRate`.
4. **Empire tier hint** said "each puppet's count half". Puppets count 0.35 to 0.6 by loyalty (`countWeight`), territories 0.5.
5. **People, Taxes gauge** was `100 - tax * 250`, so the neutral 20% showed half-full and yellow. It follows the engine's tax
   lines in the stability sum.
6. **Space said "Factories are staffed at X"** where X was engineer coverage; People's "Factories run at" is a different number
   (`factoryStaff`). Space now says both, named for what they are.
7. **Stability breakdown** said "add the lines and you get where it is heading", but the engine clamps the sum to 0..100. When it
   clamps, a line says so.
8. **Advisor "You could borrow"** opened the Budget, which has no bonds; it opens the Bank. People advice (engineers, scientists,
   doctors, epidemics, health, schools, jobs) opens the section that holds the fix.
9. **Briefing, More to explore** said "Factions" (the desk is Bloc) and sent "Missiles and systems" to Systems, not the Missile
   Program tab. Government is listed.
10. **Puppets: Set it free** released at once with no question (a territory's Release asks). It asks now, with undo.
11. Smaller: "Next election in 0 months" reads "this month"; the trade accord line reads "for N more months"; the wealth fund
    tile's locked subtitle says "needs a Great power"; the Territories tile uses the engine's `maxTerritories`.

## Consistency

- New shared pieces in `src/ui/economy/parts.tsx`: `Fold` (a summary line with its number that opens onto the detail) and
  `GoTo` (a quiet button that follows an advisor target, so links between tabs use the same deep links as the advisor).
  `openGovernment(section)` (`economy/government/section.ts`) opens Government on a section.
- Tiles: Budget, Projects and Stocks use the kit's `Tiles compact` like People, Government and Bank.
- Locked features say what opens them in one place per page, with the tier name and the number of countries.

## Left for later (not changed)

- **Country, Upgrades**: eight upgrade cards are tall on a phone (the effect text sits inside each button). A compact row per
  building would halve it.
- **Space**: rocket development, pad building and lab progress may also run at a speed other than one a month; not checked.
- **Government sections** are kept in a module variable, not the store, so the advisor's election card opens the Overview
  (which now shows the election tile), not Laws.
- **Missile Program talent**: its engineers view is on the Military desk (another audit); it should link to Government, Talent
  the same way Space does.
- **People tile "Out of work"** and Government's unemployment are the same number in two desks; kept, as a single tile.
- **Empire World tiles** (world rate, world inflation) repeat the Bank tiles' subtitles; kept as world context.
- The HUD's money breakdown (other audit) may want the Budget's grouping.
