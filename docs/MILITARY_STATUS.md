# Active military: diagnosis and Presence (status)

## Diagnosis: why stationed forces felt invisible and low-impact

Read from the code and from 60-month AI games (3 seeds, Easy/Medium/Hard, `strategySim`):

1. **Posts only changed combat numbers.** A garrison, patrol or air screen did three things: +35% on its own post in a battle, Defense Line points, and a share of a landing/missile sunk. Nothing happened in months without a battle, so a posture was a silent number.
2. **No economy, no intelligence, no diplomacy.** Patrols earned nothing and protected no trade; no blockade, no strait control; submarines and air screens learned nothing; no incidents beyond the existing "border incident" roll.
3. **Posting was free of choices.** One posture, one cost (the units' upkeep, paid anyway). No readiness, no alert, no exercises, no way to make a point to a neighbor.
4. **The AI ignored postures.** `chooseWarTarget` never read the target's guard: a fully garrisoned border cost an aggressor nothing in its decision, so nothing deterred, nothing was probed, nothing mirrored.
5. **The globe showed little.** Small badges (and only the player's and exact-intel nations'), tension badges only on the Borders map, no routes, no straits, no fronts. Nothing was clickable.
6. **No command view.** The Deployment tab is a slider editor; there was no per-front status, no ledger of what forces achieved, no presets.

## Built (all in `PRESENCE`, `src/data/presence.ts`; rules in `src/engine/presence.ts`)

- **Alert levels** (relaxed/normal/high): readiness 0-100 moving 12 points a month toward 55/75/95 (+12 while drilling, -25 with no oil). Readiness scales the garrison/patrol bonus, interception and surprise resistance (factor 0.8-1.2; exactly 1 for a force that never set an alert). High costs +25% of the posted units' upkeep and +40% oil; relaxed refunds 20% / 30% (never above the upkeep itself).
- **Trade protected** by sea patrols: 3% of sea income per sqrt(division), 8% cap, never above 60% of the posted fleet's upkeep (a patrol cannot pay for itself).
- **Straits and canals** (the map's strategic sea lanes, named): held by the owner of an end whose patrol is 1.5x the other's; a held strait adds to the sea trade inside the same cap; contested when both patrol.
- **Blockade** at war (and sanctions enforced by patrols at half weight): a fleet outguns the enemy by up to 4 divisions, taking at most 30% of the enemy's sea income (about 2% of gross).
- **Watching**: submarine screens, air patrols and coastal patrols give intelligence on neighbors and enemies for two months (max 3 a month), with news lines; sorties are counted.
- **Incidents**: tense (>=30) neighbors with patrols can collide (both lose 0.05 warship) or shoot down a recon aircraft; a reason for war, a drop in opinion, border heat, news. Hot borders cool by talks unless a side is on high alert.
- **Shows of force** (naval/air/ground, to a neighbor, 6-month cooldown per target) and **exercises** (9-month cooldown): cost money and oil, raise border heat, sour the neighbor, train posted units (soft caps 3 and 3.5), keep readiness up 2-3 months.
- **AI**: Medium/Hard read a posted border or coast (appetite -18%/-30% at full cover; an unguarded border invites an aggressive nation to probe, +8%); a rival's garrison across the border raises a nation's own garrison (arms race); Medium/Hard raise alert at war or under threat, Hard relaxes it when nothing worries it.
- **Ledger** per nation (`GameState.presence`): deterred, trade, blockade, intel, detected, sorties, incidents, shows, spent.
- **Globe** (`src/ui/globe/presenceLayer.ts`): patrol wakes along sea lanes, submarine tracks, air circuits with a radar ring, straits with holder badges, battle lines, the player's supply lines; rivals shown by intel tier (exact: with intelligence; rounded: neighbors and enemies, dashed with a tilde; unknown: not drawn); 3 zoom levels, caps (70 badges, 70 lines, 4 rings), reduced motion holds lines still, the colour-blind palette is used for war colours, every badge has its own icon and text. Clicking a badge (or a station badge) opens a card: what it does, strength, upkeep, readiness, orders (recall, show force), relocate/upgrade/theatres links.
- **Theatres desk** (Military, *Theatres*): posture header (alert, readiness, upkeep, supply), alert buttons, Defensive/Balanced/Forward presets with the advisor's recommendation, a cropped map of theatres (circle/diamond/triangle by threat), a card per neighbor (tension and change, your and their forces by intel tier, cover, show of force), the ledger, straits. Advisor items for thin tense borders and dry supply; news lines for notable events.

## Checked

- Tests: `src/engine/__tests__/presence.test.ts` (36): every rule above, soft caps and the no-profit bounds, malformed orders (refused, never throw, never change state), determinism and save round trip, an old save with no presence, a coast-less map, parity (a posture-free world is identical with presence on or off).
- Goldens (`turnGolden.test.ts`) re-pinned deliberately: bots post at once, so presence moves all three. With `PRESENCE.on = false` the old hashes (7d9d1f55d2a94, 5e24dace6d64b, 1c2e3ffb6159fd) return exactly (a new test), and the old-combat proof still holds with it off.
- AI sims (3 seeds each, 60 months, before = earlier run, after = with presence): median war length 5 / 5 / 4 months before and 5 / 5 / 5 after; wars over 24 months: 0 in every run; stalled-per-game 0.7/2.3/2.3 before, 2/3/3 after (the strategy harness counts idle-order wars; no war stalled past 18 months). Top nation holds 5.7/6.7/8.7 before, 6/8.3/9.7 after (within seed noise; see the 120-month run below). In a 36-month Medium game the ledgers summed to 366 money of trade protected, 109 of trade denied, 855 intelligence gains, 311 detections, 3032 sorties, 45 deterred, 0 incidents (the AI never raises tension on purpose), 136 nations with a posture, 52 on a non-normal alert.

## Not done / unverified

- No AI shows of force or exercises (the AI only reads postures and sets alerts).
- No forward bases or ports extending supply range, no consent system for presence in allied or puppet countries beyond the existing puppet garrisons, no migration/smuggling/refugee effects, no separate piracy or fishing/oil-route model (trade protection stands for them), embargo enforcement is the sanction blockade only.
- Patrol routes are great-circle lines along the map's sea lanes between country centres, not coastal geometry; badges for exact fleets are the existing station badges at the port.
- Phone (390x844) was screenshotted but the card click was not verified there; the 1440x900 globe, card and desk were read by eye. A live (real-time) game was not screenshotted; live mode shares the monthly rules and only uses the layer's day-keyed signature.
- Software-GL only; frame rate on real hardware untested.
