import { describe, it } from 'vitest'
import { generateAllBotOrders } from '../../ai/bot'
import { createInitialState } from '../../data/startingNations'
import { getWorld } from '../../map/world'
import { empireCount } from '../empire'
import { bindPuppet } from '../puppets'
import { resolveTurn } from '../resolveTurn'
import { bindTerritory } from '../territories'
import { transferRegion } from '../warfare'
import { grossIncome, populationShare } from '../victory'
import type { Difficulty, GameState } from '../types'

/** Opt-in: VITE_TERRCMP=1 VITE_TERRBOT_OUT=file. A master (Hard, all bots) is handed the same neighbour as a conquest, a puppet or a territory; 60 months later, who is richer? */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env
const suite = env.VITE_TERRCMP ? describe : describe.skip
suite('territory against puppet against conquest', () => {
  for (const [seed, master, other] of [[1, 'poland', 'czechia'], [2, 'france', 'spain'], [3, 'egypt', 'libya']] as const)
    it(`seed ${seed}`, async () => {
      const { map } = getWorld()
      const out: Record<string, unknown> = { seed, master, other }
      for (const kind of ['none', 'conquest', 'puppet', 'territory'] as const) {
        const s: GameState = createInitialState(map, { goal: 'classic', victoryShare: 2, playerRegionId: master, seed, difficulty: 'hard' as Difficulty })
        s.nextEventTurn = 99999
        s.humans = []
        s.nations[master].isPlayer = false
        s.nations[master].tier = 3
        if (!s.nations[other]) continue
        if (kind === 'conquest') transferRegion(s, map, other, master, false)
        if (kind === 'puppet') bindPuppet(s, other, master)
        if (kind === 'territory') bindTerritory(s, other, master)
        let t = s
        for (let m = 0; m < 60; m++) t = resolveTurn(t, map, generateAllBotOrders(t, map))
        const m = t.nations[master]
        out[kind] = { gross: Math.round(grossIncome(t, map, master) * 10) / 10, capital: Math.round(m.resources.capital), pop: Math.round(populationShare(t, master) * 1000) / 10, count: empireCount(t, master), taken: Math.round(t.territories?.[other]?.taken ?? 0), otherAlive: t.nations[other]?.alive ?? false, otherGross: Math.round(grossIncome(t, map, other) * 10) / 10 }
      }
      const line = 'TERRCMP ' + JSON.stringify(out)
      console.log(line)
      if (env.VITE_TERRBOT_OUT) (await import(/* @vite-ignore */ 'node:' + 'fs')).appendFileSync(env.VITE_TERRBOT_OUT, line + '\n')
    }, 3_600_000)
})
