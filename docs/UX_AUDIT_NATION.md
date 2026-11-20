# UX and logic audit: the nation side

Scope: the Economy desk (Country, People, Budget, Bank, Business, Projects, Space, Market, Stocks, Government), the Empire desk
(Overview, Provinces, World, World reaction, Statistics, Territories, Puppets), Research, the Briefing and the advisor's targets.
Military, Diplomacy, Bloc, the HUD, the rail and Help belong to another audit; Relations and the War Room planner are being
redesigned elsewhere and were not touched.

Rule followed: consolidate, do not delete. Every control that was on a page is still in the game; where a number appeared in two
places, one place keeps it and the other links there or keeps a single summary line. The first pass changed no engine rule (the
engine files touched were the advisor's *targets* and its type). The second pass changed one rule, behind a flag and with a golden
proof: the government desk's stability now shares the soft ceiling on care (below, "Second pass", item 5).

Screenshots: `node scripts/nation-shots.mjs --out <dir> [--mode live] [--only economy-budget,tech] [--empire] [--top]` opens Poland
(seed 3), plays three months, binds a territory and a puppet so their tabs show, hides the globe, and saves the top and the whole
page of every tab at 1440x900 and 390x844, printing each page's height. `--empire` makes it a large empire: eighteen nations nearby
are conquered through the engine's own `transferRegion` (19 countries, half settled), a puppet and a territory are bound and a war
with Russia starts, and the puppet's "Set it free" is opened, shot, confirmed and shot again (`free` in `--only`). `--top` skips
the whole-page shots (they are what takes long on a loaded machine). Every HTTP response of 400 or more is printed with its URL.

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

Scrolled page height in pixels, Poland after three months (turn mode), from `nation-shots.mjs` before (commit 200f726) and
after (this branch merged with main). The window is 575 px tall on a desktop and 332 px on a phone.

| Page | Desktop before | Desktop after | Phone before | Phone after |
|---|---:|---:|---:|---:|
| Country | 1161 | 1166 | 2141 | 2142 |
| People | 992 | 992 | 1626 | 1617 |
| Budget | 575 | 575 | 954 | 1047 (gains its tiles) |
| Bank | 827 | 716 | 1722 | 1372 |
| Business | 1359 | 723 | 2894 | 1352 |
| Projects | 2570 | 1251 | 4747 | 2230 |
| Space | 817 | 874 | 1646 | 1720 (gains the Talent link) |
| Market | 973 | 812 | 1849 | 1518 |
| Stocks | 626 | 677 | 1070 | 890 |
| Government | 861 | 844 | 1314 | 1258 |
| Empire World | 575 | 575 | 531 | 482 |
| Research (All) | 2873 | 2858 | 7360 | 7459 (Next steps: 1907) |

Country is the same height for a one-country nation (its folds open only with an empire list); Budget and Space grew a little
because they now lead with tiles or a link.

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
  count. The header shows research a month beside what is available. A filter shows one branch, or the next step in each branch
  (all seven branches stacked were 19 screens on a phone; Next steps is 1,907 px there).
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

## Second pass: the known gaps

Seen with `--empire` (19 countries, a puppet, a territory, at war) in turn and live mode, both sizes.

1. **Country, Upgrades**: eight cards became one list, a row a building (name, level, what a level does, the price on the button;
   the description is the row's tooltip). City cards lost the repeated "More workers, and a stronger focus" line (the section
   says it). Phone page 2,142 to 1,897 px with the empire fold; the upgrades went from about 1,050 px to 560.
2. **Country, a large empire**: the list of nineteen countries pushed the country's own page three screens down (paging does not
   help, it loads more as it scrolls). A "Showing" picker switches the country in one tap, and the list (governors, settling,
   filters) is a fold, open up to six countries. Desktop 2,000 to 828 px, phone 3,497 to 1,897.
3. **Space timers**: Space does not use the projects' `projectSpeed`; it has its own pace, and the tab ignored it. Rocket
   development runs at `rocketDevRate` (discoveries times engineers on staff against what the class asks, 30% at worst), rockets
   on the line at `rocketBuildRate` (faster with discoveries), a lab bench at `benchRate` (lab level times scientist staffing:
   the tab divided by the lab level only). Pads, labs, outposts, mines and flights move one month a month, as shown. The month end
   now adds these functions (same sums; goldens unchanged), and the tab counts months with `monthsToFinish` (it adds the rate the
   way the month end does, so it is exact) and shows money as the monthly bill times those months. `spaceTimers.test.ts` runs
   the real month end and checks the shown months and total for each kind at several staffing levels.
4. **Election advice**: the Government section is in the store (`govSection`), advice targets take `gov`, and
   `openGovernment(section)` goes through `goTo`, so a link works even with the tab already open. The election card says "Open
   Laws" and opens Government on Laws (`govLink.test.ts`, `advisor.test.ts`).
5. **Stability: one ceiling** (engine, behind `SOCIAL_RULES.deskShares`). The desk's stability added on its own line, so an ideal
   cabinet with reforms could add about +12 on top of care already near its soft cap of 18. Now `deskStability` puts what the desk
   adds on top of programs and projects under the same `softCap`; what it takes away counts in full. The Government overview and
   Groups show the counted value beside the raw one, and the People breakdown says the three share one ceiling
   (`careCap.test.ts`). Goldens: Normal `66d50a51fed96`, Hard `165d08ef09d489` (the small war did not move); with the flag off
   (`withoutDeskShare`, also inside `withoutTies`, so every older layer test keeps its proof) `a0f8d651bfe97`, `1879299a3721df`
   and `19d872c4a61078` return exactly.
6. **The 403 on every page** was ours: the Inter font (`@fontsource-variable/inter/.../inter-latin-wght-normal.woff2`) requested
   from `/@fs/home/user/worldwar/node_modules/...`. In a worktree whose `node_modules` links to the main checkout, the real path is
   outside Vite's allowed root and Vite answered 403. `vite.config.ts` now allows the link's real folder. Not a proxy block.
7. **Stocks with a big empire**: twenty full company cards (7,100 px on a desktop, 12,000 on a phone). Each company is one line
   (name, sector, your share, price) that opens onto the stake, trades and board orders; companies you hold open by themselves.
   2,170 px on both sizes.
8. **Tier between a conquest and the month end**: the tier is set at the month end, so the Empire overview said "-15 more
   countries to become a Regional power" and the Bank said "You hold 19 countries" beside "opens as a Regional power (4)". Both
   now name the tier the month end brings; the Bank counts as the tier does (`empireCount`) and takes tier names and sizes from
   `TIERS`.
9. **Set it free**: the confirmation reads well at both sizes; after it, the undo toast said "Done: Set Slovakia free?". Confirm
   buttons drop the question mark.
10. **War-time Bank**: War bonds is its own card at war (sold so far, room left, one button); looked right at both sizes.

## Left for later (not changed)

- **Missile Program talent**: its engineers view is on the Military desk (another audit); it should link to Government, Talent
  the same way Space does.
- **People tile "Out of work"** and Government's unemployment are the same number in two desks; kept, as a single tile.
- **Empire World tiles** (world rate, world inflation) repeat the Bank tiles' subtitles; kept as world context.
- The HUD's money breakdown (other audit) may want the Budget's grouping.
- After a confirmed order two undo controls show at once: the toast's Undo and the floating Undo pill (HUD, other audit).
- The empire list's filter and sort selects each take a full row on a phone (the shared `DataList`, used by other desks).
