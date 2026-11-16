import { garrisonDivisions, patrolCover, reserveDivisions } from './deployment'
import { atWar, forceUnits, isAllied, totalUnits } from './helpers'
import { militaryPower } from './militaryStats'
import type { GameState, NationId } from './types'

/** True when `viewer` can see `target`'s real forces: their own, a friend's, an enemy at the front, or one spied on or watched from orbit. */
export function hasIntel(game: GameState, viewer: NationId, target: NationId): boolean {
  if (viewer === target) return true
  const v = game.nations[viewer]
  const t = game.nations[target]
  if (!t) return false
  if (t.overlord === viewer || v?.overlord === target || t.territoryOf === viewer || v?.territoryOf === target) return true
  if (isAllied(game, viewer, target) || atWar(game, viewer, target)) return true
  return (game.intel?.[`${viewer}|${target}`] ?? -1) >= game.turn
}

export interface PowerView {
  /** The number to show: the real one with intel, otherwise a rough guess. */
  value: number
  exact: boolean
}

/** A number in [0, 1) that is the same for the same text, so a guess does not jump about between screens. */
function steady(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/**
 * Another nation's military strength as the viewer knows it. Without intelligence it is a rounded guess that can be off by a fifth
 * and holds the same error for a year, so it moves with the real thing but never gives it away. Nothing here uses the random streams.
 */
export function powerView(game: GameState, viewer: NationId, target: NationId, actual: number = militaryPower(game, target)): PowerView {
  if (hasIntel(game, viewer, target)) return { value: actual, exact: true }
  const guess = actual * (0.8 + 0.4 * steady(`${viewer}|${target}|${Math.floor(game.turn / 12)}`))
  const step = guess < 40 ? 5 : guess < 200 ? 10 : 50
  return { value: Math.max(0, Math.round(guess / step) * step), exact: false }
}

/** "120" with intel, "~120" without. */
export const showPower = (v: PowerView): string => (v.exact ? v.value.toFixed(0) : `~${v.value.toFixed(0)}`)

/** What a nation has on station, as the viewer knows it. Divisions: exact with intelligence, otherwise rounded guesses that hold for a year. */
export interface DeploymentView {
  exact: boolean
  /** The nation has set a posture at all. */
  posted: boolean
  coastal: number
  subs: number
  air: number
  /** Ground troops on all borders. */
  ground: number
  reserve: number
  /** Divisions of garrison on the border with each neighbor. Without intelligence only the border facing the viewer is shown. */
  border: Record<string, number>
}

/** A number of divisions as a guess: off by up to a third, rounded to a half division when small and a whole one when not. */
export function guessDivisions(game: GameState, viewer: NationId, target: NationId, what: string, actual: number): number {
  if (actual < 0.25) return 0
  const g = actual * (0.7 + 0.6 * steady(`${viewer}|${target}|${what}|${Math.floor(game.turn / 12)}`))
  return g < 3 ? Math.max(0.5, Math.round(g * 2) / 2) : Math.round(g)
}

export function deploymentView(game: GameState, viewer: NationId, target: NationId): DeploymentView {
  const t = game.nations[target]
  const empty: DeploymentView = { exact: true, posted: false, coastal: 0, subs: 0, air: 0, ground: 0, reserve: t ? totalUnits(forceUnits(game, target)) : 0, border: {} }
  const d = t?.military.deployment
  if (!t || !d) return { ...empty, exact: hasIntel(game, viewer, target) }
  const cover = patrolCover(game, target)
  const exact = hasIntel(game, viewer, target)
  const ground = Object.keys(d.border).reduce((sum, x) => sum + garrisonDivisions(game, target, x), 0)
  const reserve = reserveDivisions(game, target)
  if (exact) {
    const border: Record<string, number> = {}
    for (const x of Object.keys(d.border).sort()) border[x] = garrisonDivisions(game, target, x)
    return { exact, posted: true, coastal: cover.coastal, subs: cover.subs, air: cover.air, ground, reserve, border }
  }
  const facing = garrisonDivisions(game, target, viewer)
  return {
    exact,
    posted: true,
    coastal: guessDivisions(game, viewer, target, 'coastal', cover.coastal),
    subs: guessDivisions(game, viewer, target, 'subs', cover.subs),
    air: guessDivisions(game, viewer, target, 'air', cover.air),
    ground: guessDivisions(game, viewer, target, 'ground', ground),
    reserve: guessDivisions(game, viewer, target, 'reserve', reserve),
    border: facing > 0 ? { [viewer]: guessDivisions(game, viewer, target, 'facing', facing) } : {},
  }
}

/** "3.5" with intelligence, "~3.5" without. */
export const showDivisions = (v: number, exact: boolean): string => `${exact ? '' : '~'}${Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v.toFixed(1)}`
