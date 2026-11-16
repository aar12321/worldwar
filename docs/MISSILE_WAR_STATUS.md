# Missile war: status

The ask: missiles were "invest, then wait for the weapon to have its effect". Every missile should hurt the people and the Defense Line (kinds differ in
degree), and there should be a real missile war around them: launch sites you can hit, salvos and shields that run dry, radar, doctrine and false
alarms, a ladder of escalation and ways to climb down, aircraft that matter, an AI that plays it, and a screen and globe that show it.

## Done

### 1. Damage model (`src/data/missiles.ts`, `src/engine/missileWar.ts`)
- Every kind (cruise, tactical, hypersonic, ballistic and the new decoy) now kills a share of the struck country's **people** and cuts its **Defense Line**.
  The table has comments on each kind's job. Extra fields: `urban` (cities make it worse), `stability` and `crime` (stability the dead cost, war-crime
  reputation per 1% killed), `site`/`siteMax` (counterforce), `fuel`, `air` (fuel stores and airfields), `drain` (interceptor rounds spent per missile),
  `tension`, `slots` (decoys take a third of a program slot).
- What a strike kills comes off the country's people (so off the economy), costs the struck nation stability and war weariness, earns the attacker a
  war-crime reputation (scaled by the kind, by how urban the target was and by the world's tension) and an opinion penalty, and counts toward the war
  score (`addMissileScore`: capped at 6 a salvo). Nuclear strikes keep their own rules and only add tension.
- `harmOf` is one pure function used by the real strike, by the forecast and by raids.

### 2. The active missile war
- **Interceptor store** (`interceptorCap`, `salvoDefense`): a shield holds 8 rounds a level, a battery 4; each arriving missile draws `drain` rounds; the
  shield's strength is scaled by the share of the salvo it has rounds for; half the store returns each month; rounds can be bought. Decoys exist to burn them.
- **Radar** (3 levels; the *radar network* and *integrated air shield* aircraft nodes count as airborne early warning), **air-defence batteries** per
  country, **mobile launchers**, **recon** flights.
- **Counterforce** (`aim: 'site'`): 35% of the harm to people and line, but destroys a share of the enemy's stored missiles (never warheads) and shuts the
  launch site (`down`); a shut site cannot launch (`launchSite` skips it); mobile launchers hide a share unless recon found them.
- **Doctrine** (`missileDoctrine.ts`): Hold, Retaliate (once, never an answer, at the launch site that hit you), Launch on warning (live, needs radar, fires
  while the salvo is in the air) and the monthly **false alarm** (only at a nation already at war, own random stream, grows with tension, shrinks with radar).
- **Escalation ladder** (`GameState.missileTension`, five rungs) fed by every strike by kind, by nukes, by false alarms; fades each month; feeds `worldTension`;
  harsher war-crime reputation from the third rung; AIs stop opening salvos at the top rung.
- **Ceasefire** (`missileTruce` order, `GameState.truces`): AI accepts by a deterministic rule (tension by difficulty, or losing the exchange); blocks
  missiles, raids and nukes between the pair for six months; lifting costs reputation.
- **Per-salvo reports** (`GameState.salvos`, 40 kept) and a per-nation **ledger** (`Nation.missileWar.ledger`): fired, got through, shot down, dead dealt and
  lost, line dealt and taken, sites hit, store destroyed, rounds spent, aircraft lost.
- **AI** (`src/ai/missileWar.ts`, one call in `bot.ts`, its own random stream): Easy nothing; Normal doctrine, radar, rounds, occasional raids, ceasefires;
  Hard counterforce with decoys first, raids on launchers, recon, batteries, mobile launchers, launch on warning with good radar, ceasefires. No new salvos
  at the brink. Nothing in it builds or fires a warhead.

### 3. Aircraft
- **Fighters** (at home, on air patrol, scrambled) shoot missiles down; in a live game `scramble` is an order against one flight (wing counts 1.5 times, +10% stop).
- **Bomber raids** (`raid` order, `raidPlan`, `raidForecast`): escorts, losses to fighters and batteries, stealth and jamming from the Develop tree, range from
  `airReach`, aimed at the country or the launch sites; month-end in a turn game, immediate in a live game; once a month.
- **Recon** shows launchers. The Develop tree's *radar* and *iads* nodes add early warning; *stealth*, *EW* nodes lower raid losses.
- The forecast is extended: `strikeForecast` (chance each missile gets through, expected dead, line, store destroyed, rounds short) and `raidForecast`, shown in
  the War Room's Missiles section and the raid card.

### 4. Screen and globe
- **Missile War desk** (Military, Missile War; `src/ui/MissileWar.tsx`): tension ladder, **Next steps** (each with its button: scramble, restock rounds, build
  radar, set doctrine, offer ceasefire, open the War Room, build, deploy), salvos in the air as timelines (launch, in flight, intercept, impact, days left) with
  a Scramble button, defences (rounds bar, radar, batteries, mobile launchers, doctrine), arsenal and launch sites (open or shut, recon), ceasefire, the kill
  ledger and exchange ratio with readable per-salvo lines, and a strike planner (the War Room's missile section plus the raid card).
- The **missile program** card now opens on the same next steps; the **War Room** missile rows have an aim toggle and a forecast.
- **Globe** (`src/ui/globe/useMissileFx.ts`, pure parts in `src/ui/missileFx.ts`): a trail per kind (colour, thickness, height, length), launch flash, interception
  burst with debris (shield and air look different), impact ring scaled by kind and by what got through, screen shake, craters (scorch, ember, smoke) fading over
  days derived from the reports, radar sweep over the capital, aircraft sprites for raids and scrambles, and an incoming-salvo screen edge. Caps on everything
  (`FX_CAPS`). Reduced motion: one ring, no delay, no shake, no sprites, steady edge. Colour-blind palette: own trail colours, and the kinds also differ in height and
  thickness.

## Numbers

### Damage per kind, before and after (per missile; "dead" for a 20 million country with no cities)

| Kind | Cost (money+steel+oil) | Line before | Line now | People before | People now | Dead (M) now | Interceptor rounds drawn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cruise | 7 | 0.25 | 0.25 | 0 | 0.08% | 0.016 | 1 |
| Tactical | 11 | 0 | 0.12 | 0 | 0.05% | 0.010 | 1 |
| Hypersonic | 62 (trained) | 0.6 | 0.6 | 0 | 0.15% | 0.030 | 1 |
| Ballistic | 38 | 1.0 | 1.0 | 0.4% | 0.4% | 0.080 | 1.5 |
| Decoy | 1.5 | n/a | 0.02 | n/a | 0.01% | 0.002 | 1 |

Per money (line, then thousands of people, per money): cruise 0.036 and 2.3, ballistic 0.026 and 2.1, decoy 0.013 and 1.3, tactical 0.011 and 0.9, hypersonic 0.010 and 0.5.
No kind wins every measure (`damage per money` test, 7 measures): cruise line per money, ballistic dead and shielded line per missile, tactical army and
counterforce, decoy interceptor drain per money, hypersonic speed (km a day). Hypersonic is the army's own unit and is paid for in the training queue.

### Sims (docs numbers are reproduced by `src/engine/__tests__/missileWarSim.test.ts`)
Real map, bots in every seat, deterministic seeds. "Salvos" counts reports (missile salvos and raids); "counterforce" is strikes the rival ordered at launch
sites (a doctrine's answer is under "auto"). Dead is millions of civilians killed by missiles and raids in the whole run.

| Run | Months | Salvos | Missiles fired | Counterforce | Raids | Auto (doctrine) | Ceasefires | Nukes | False alarms | Peak tension | Dead (M) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Easy, organic (seed 3) | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Normal, organic (seed 7) | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Hard, organic (seed 5) | 90 | 6 | 3 | 0 | 5 | 0 | 0 | 0 | 0 | 7 | 8.6 |
| Hard, organic (seed 11) | 90 | 5 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 11 | 1.2 |
| Hard, organic (seed 23) | 90 | 4 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 17 | 4.1 |
| Easy, stressed world war (seed 3) | 36 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Normal, stressed (seed 7) | 36 | 30 | 119 | 0 | 1 | 7 | 3 | 0 | 0 | 29 | 108.1 |
| Hard, stressed (seed 5) | 36 | 52 | 91 | 2 | 28 | 7 | 4 | 0 | 1 | 44 | 68.7 |
| Hard, stressed (seed 11) | 36 | 49 | 51 | 3 | 38 | 2 | 0 | 0 | 0 | 36 | 23.9 |

"Stressed" gives the eight most populous nations a level-3 missile program, 12 cruise, 12 tactical, 6 ballistic and 12 decoys each, 8 hypersonic, a level-2 shield and
three bomber and fighter divisions, split into two camps at war. Reading it: **no run reached a nuclear launch** (the bomb keeps its own rules), the world's tension stays under 45 (the top rung opens at 80), false alarms are rare
(one in 72 stressed Hard months, none organically), Easy never touches the war, Normal defends, keeps a doctrine and, with the older strike logic it keeps, fires the most
missiles and kills the most people (119 missiles, 108 million dead in the stressed world), and Hard fires fewer missiles and spends more on bomber raids and
counterforce at the launchers (24 to 69 million dead for 51 to 91 missiles). Both offer ceasefires as the tension climbs (3 for Normal, 4 in the Hard seed-5 war). In the
organic worlds rivals rarely get to the missile war at all: a rival has to be at war with a power in reach and have built missiles, so what the AI does there is mostly a few bomber raids.
Tension in the stressed wars is held down by the fade and by ceasefires; a Hard AI never opens new salvos at the brink.

## Tests
- `missileWar.test.ts` (53): damage per kind, caps, urban, stability and reputation, economy and war score, the combat matrix, interceptors (rounds, decoys,
  regen, buying, batteries, radar, AWACS, hunters, scramble, parts add up, forecast equals result), counterforce, raids, doctrines, false alarms, ladder, tension
  decay, ceasefire, turn/live parity, fuzz of malformed orders, the old rules with the war off.
- `missileWarUi.test.ts` (17): looks, fx plans and caps, reduced motion, craters fading, radar ring, timeline stages, next steps (each button is a legal order), salvo text.
- `missileWarSim.test.ts`: the AI by difficulty.
- **Mutation checks:** 40 rule mutations were applied one at a time (rounds ignored, rounds never spent, batteries or radar stop nothing, counterforce at full harm,
  mobile hide, cities, stability, weariness, ladder crime, counterforce tension, escorts, flak, stealth, raid cooldown, raid site rule, ceasefire, shut sites, answers
  that answer, launch on warning without radar, false-alarm radar and tension, quiet fade, regen, decoy drain, war score, scramble, recon, ceasefire answer and
  cooling, nuclear tension, shut site, store kill, airfields, fuel): every one was caught by a test (three survived the first pass: raid aimed at a country with no factory, an answer that answers an answer in a live game, and the scramble wing multiplier; tests were added and each now fails the mutation). Five AI rules (doctrine orders, counterforce, raids, ceasefire offers, Easy staying out) were mutated the same way against the sims: all caught except the redundant Easy guard inside the planner, which `bot.ts` already enforces.

## Goldens
`turnGolden.test.ts`: the Hard-bot world and the small war are re-pinned (the Normal-bot world did not move). Proof: `withOldMissiles` (`MW.enabled = false`, legacy
numbers for light missiles, no interceptor store, no reports, no tension, no AI) returns every previous hash exactly, in the new test
"the missile war is the only thing that moved the Hard-bot world and the small war", and the oldest combat-tuning hashes still return with both switches.

## Not done, or not verified
- Air-defence batteries are bought and posted by an order in the Missile War tab; they are not part of the Deployment desk's posture sliders.
- Raids resolve at once (turn: at the month end; live: immediately). There is no flight time, no interception of a raid in the air by a scramble, and no
  separate return leg; the sprites are decoration over the report.
- AI rivals answer a ceasefire offer but do not offer one to a human player; an AI-to-AI ceasefire is offered by Hard and Normal rivals when the tension climbs.
- Salvo timing is the flight time of the kind plus the order of firing; there is no salvo stagger or timed release.
- Mobile launchers are a level on the nation, not individual vehicles. Silos are launch sites = countries with a factory; there is no separate silo building.
- The globe was checked with software GL (swiftshader) at 1440x900 and 390x844. Frame cost with 120 flights in the air matched the no-flight baseline under
  software rendering (about 550 ms a frame either way, GL-bound), so the extra cost of the layer is below what that setup can resolve. **Not measured on a real GPU.**
- Sounds: none by request (visual cues only).
