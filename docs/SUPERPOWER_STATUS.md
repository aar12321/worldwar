# Superpower dynamics: status

Audit written after the first merge with `claude/laughing-planck-9gjcru` (missile UI, aircraft development, missile-program research fix).
Branch: `worktree-agent-a85f3cade64c6897e`. Commits: `0f9e5b7` (the feature), `028aa07` (the merge). Nothing pushed.

## DONE AND TESTED (src/engine/__tests__/superpower.test.ts, superpowerSim.test.ts)

1. **Threat measure** (`src/engine/coalition.ts`, `src/data/coalition.ts`): score from tier, share of countries, people and output, and infamy; pressure = tier ramp x score. Tested: grows Regional < Great < Superpower < Hegemon, grows with share and reputation, a lone nation is never a concern, Easy is always 0.
2. **Difficulty behaviour**: Easy never forms plans or coalitions (6 real months of Easy bots). Medium: readier to ally (alliance verdict rate rises) and looks for partners (more alliance proposals to nations that fear the leader), no plans. Hard: joint plan with 2 to 4 members by tier, shared weakest-border targets, two months of notice, justification and a treaty, then every member declares and attacks in the same month; live: every attack leaves on the plan's day and a JOINT STRIKE news line says so; Hard also presses an ally's war on the leader.
3. **Nuclear weapon**: tier gate (Superpower) and technology gate, program (money + steel + research, 4 months, one at a time, 4 in store, upkeep), targeting rule (a country of a nation you are at war with; not a puppet), effects (buildings to 0, 65% of people, line to the floor, factories stopped 24 months, output to 10% healing over 48 months, rebels, army 97%/60%), partial shield (a level 3 shield stops 25%).
4. **Consequences**: infamy +60, opinion -50 from every AI (victim -60), world tension spike that fades, sanctions from every non-ally, the two strongest blocs (singletons fill in) declare war within their own war limits; the victim and its friends are skipped, another human is never dragged in, Easy sends one faction.
5. **Confirmation text** (`confirmFor('nuke')`): names the victim, the blocs that will declare war, sanctions, reputation, shield, timing.
6. **Live flight**: warhead flies 5 days, lands on its day, is called off if the war ends, is lost with its nation; alert in the log, an advisor warning and a top-bar chip.
7. **NuclearCard** (`src/ui/NuclearCard.tsx`) mounted once in `WarRoom.tsx`.
8. **AI behaviour**: Hard only, Superpower only, builds when rich and at war, fires only when desperate or provoked, 36 months between its own launches, 18 months of world quiet after any bomb.
9. Saves: plans and flights are cleaned on load; untouched games carry none of the new fields (`turnGolden` hashes unchanged).

## DONE BUT UNTESTED

- World reaction panel and nuclear card rendering (checked by eye in screenshots only; no component tests).
- Globe arc for a warhead (merged with the missile arcs in `useArmyLayer.ts`); impact rings in `livePresent.ts`.
- Help.tsx / README text.
- Hunters and stealth against a warhead (`nukeAir`, added after the second merge).

## PARTLY DONE

- Mutation checks: scripted (`/tmp` helper) but not yet run on the final code.
- Multi-seed 60+ month Hard simulation: one seed per scenario exists in `superpowerSim.test.ts`; more seeds and statistics still to run.
- Edge cases still to be covered by tests: no second bloc, a warhead at your own ally, a human target in an online game, a nation killed by the strike while its flight is in the air.

## NOT STARTED

- (none)

## Checks

Recorded at the bottom after each run.
