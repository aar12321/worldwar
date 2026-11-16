# Audit: what was found, what was fixed

The first version of this file was a new-player audit of an early real-time build (territories, a clock that ran from the moment you pressed Start, hard pauses and cutscenes). That game no longer exists: it became turn based with one military per nation, and later gained an optional live clock. Nearly every item in that audit described code that has since been replaced, so the list is retired rather than kept as a table of stale findings. It is in git history (`git log -- docs/audit/AUDIT.md`). The screenshots under `img/` are kept because `docs/UX.md` links to some of them.

This page is the short current record. The detail for each area is in the status documents:

| Area | Document |
| --- | --- |
| Economy, people, projects, missiles, aircraft | `BALANCE.md`, `BALANCE_STATUS.md` |
| Factions | `FACTIONS_STATUS.md` |
| Superpower dynamics and nuclear weapons | `SUPERPOWER_STATUS.md` |
| The space program | `SPACE_STATUS.md` |
| Active military and borders | `BORDERS_STATUS.md` |
| The AI's strategic layer and scenarios | `STRATEGY.md`, `STRATEGY_STATUS.md` |
| Interface | `UX.md`, `UX_STATUS.md` |
| The last pass over all of it | `FINAL_STATUS.md` |

## Fixed in the last pass

- **Factions**: rivals offer fuel and ration contracts to the pool and vote on contracts by the market price; Medium and Hard rivals back standing supplies with collateral. A weighted vote can no longer be bought by paying in after it was called. A nation at war on its own cannot pool its soldiers (they never defend home).
- **Nuclear strikes**: the world's answer ignores the attacker's own war limit (it cannot then start another war) while the declarers keep theirs. Rule stated in code and tested.
- **Space**: every mine type now pays back in between about eight and fourteen years (helium-3 and water mines, and the Mars and Europa mines, did not); claims nobody settles lapse after five years; discoveries stack to a ceiling; a home firm's return was cut so outsourcing is never a bargain.
- **Deployment**: checked, no abuse found (a posture moves once a calendar month, posted forces cost the same and cannot attack); tests added.
- **Clean-up**: unused simulation fields and the stale status documents; this page.

## How the checks are run

- `npx tsc -b` and `npm run lint` clean; `npx vitest run` for the whole suite. The machine used for the sweeps is slow, so a few simulation tests have limits of 20 to 120 seconds that a loaded machine can miss: re-run those with `--testTimeout=900000`.
- Rules that were added in the last pass were mutation-checked: the rule was broken on purpose, the test had to fail, and the code was restored.
- Whole-world measurements (`strategySim.test.ts`, run only when asked for, see `STRATEGY.md`) play 175 nations with the AI in every seat, events off.

## Known gaps

- Interface checks are by eye (desktop 1440x900 and phone 390x844), not automated component tests.
- A joint offensive of a faction is fought on the 1st of the month inside the month turn; it is not drawn as an army marching on the globe in live mode.
- On a phone the globe's HTML badges and name pins show through an open drawer.
