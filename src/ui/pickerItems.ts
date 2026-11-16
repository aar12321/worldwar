import { opinionLabel } from '../ai/opinion'
import { RELATION_TEXT, type InviteCandidate } from '../engine/partners'
import { factionOf } from '../engine/factions'
import type { GameState, NationId } from '../engine/types'
import { getWorld } from '../map/world'
import { rankNations } from './nationList'

/** A list of countries you can search, with the readable names the dropdowns lacked. Rows that cannot be chosen say why. */
export interface PickerItem {
  id: NationId
  name: string
  /** Right-hand text: size, strength, the odds, what they think of you. */
  note?: string
  /** A small coloured chip. */
  chip?: PickerChip
  /** More chips, under the name: how you stand with them. */
  chips?: PickerChip[]
  /** Why it cannot be chosen, or null. */
  why?: string | null
  color?: string
  /** A heading the row sits under. Rows with the same heading should follow each other. */
  group?: string
}

export interface PickerChip {
  text: string
  tone: 'good' | 'warn' | 'bad' | 'none'
}

/** Whether a row answers a search: by name, or by a word on its chips ("ally", "pact") or its heading. */
export const pickerMatches = (i: PickerItem, q: string) => !q || [i.name, i.group ?? '', i.chip?.text ?? '', ...(i.chips ?? []).map((c) => c.text)].some((t) => t.toLowerCase().includes(q))

/** How a rival is likely to answer an invitation, in words. */
export const OUTLOOK_TEXT = {
  likely: { text: 'Likely to accept', tone: 'good' as const },
  unsure: { text: 'May accept', tone: 'warn' as const },
  unlikely: { text: 'Unlikely to accept', tone: 'bad' as const },
}

/** The word for a nation's faction on a list: "In Iron Pact". Null when it has none. */
export function factionChip(game: GameState, id: NationId, me: NationId): { text: string; tone: 'good' | 'warn' | 'bad' | 'none' } | null {
  const f = factionOf(game, id)
  if (!f) return null
  return { text: factionOf(game, me)?.id === f.id ? `In your faction` : `In ${f.name}`, tone: factionOf(game, me)?.id === f.id ? 'good' : 'none' }
}

/** The list rows for some nations, strongest start first (the order of the new-game list). */
export function nationItems(game: GameState, ids: NationId[], extra: (id: NationId) => Partial<PickerItem>, opts: { keepOrder?: boolean } = {}): PickerItem[] {
  const rank = new Map(rankNations(getWorld().map).map((x, i) => [x.r.id, i] as const))
  const alive = ids.filter((id) => game.nations[id]?.alive)
  return (opts.keepOrder ? alive : alive.sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999) || (a < b ? -1 : 1)))
    .map((id) => ({ id, name: game.nations[id].name, color: game.nations[id].color, ...extra(id) }))
}

/** The invitation list: partners first (the people you made a pact, alliance, guarantee or trade deal with on the Diplomacy desk), then everyone else by what they think of you. Nobody is left out: a nation that cannot be invited says why. */
export function inviteItems(game: GameState, rows: InviteCandidate[]): PickerItem[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const))
  return nationItems(
    game,
    rows.map((r) => r.id),
    (id) => {
      const r = byId.get(id)!
      const chips: PickerChip[] = r.relations.map((x) => ({ text: RELATION_TEXT[x].chip, tone: RELATION_TEXT[x].tone }))
      if (r.inFaction) chips.push({ text: `In ${r.inFaction.name}`, tone: 'none' })
      if (game.nations[id].overlord) chips.push({ text: 'Puppet', tone: 'none' })
      if (game.humans.includes(id) || game.nations[id].isPlayer) chips.push({ text: 'Player', tone: 'none' })
      else if (r.outlook) chips.push({ text: OUTLOOK_TEXT[r.outlook].text, tone: OUTLOOK_TEXT[r.outlook].tone })
      return { why: r.problem, group: r.relations.length > 0 ? 'Your partners' : 'Everyone else', chips, note: `${opinionLabel(r.opinion)} (${r.opinion > 0 ? '+' : ''}${r.opinion})` }
    },
    { keepOrder: true },
  )
}

