import { inviteOutlook } from '../ai/factions'
import { CHARTER_TEXT, FACTION } from '../data/factions'
import { BLOC } from '../data/blocs'
import { levelOf } from '../engine/bloc'
import { factionName, factionOf } from '../engine/factions'
import { RELATION_TEXT, partnerRelations } from '../engine/partners'
import { OUTLOOK_TEXT } from './pickerItems'
import { atWar } from '../engine/helpers'
import type { Faction, GameState, NationId } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { OrderButton } from './panel'
import { useHumanName, usePlayerView } from './hooks'

const charterLine = (f: Faction) => (BLOC.on ? `Bloc level ${levelOf(f.bloc?.xp ?? 0)} · joint operations, calls to arms, perks` : `${CHARTER_TEXT.vote[f.charter.vote]} · ${CHARTER_TEXT.spoils[f.charter.spoils]} · ${CHARTER_TEXT.exit[f.charter.exit]}`)
/** What the desk calls a faction: a bloc, unless the bloc layer is switched off. */
const W = BLOC.on ? 'bloc' : 'faction'
const WD = BLOC.on ? 'Bloc' : 'Faction'

/**
 * Invitations, requests and how they went, for the Diplomacy desk's offers and the Faction desk alike:
 * who invited you (answer here), who is waiting on you, who you are waiting on.
 */
export function FactionNotices({ game, me }: { game: GameState; me: NationId }) {
  const mine = factionOf(game, me)
  const factions = game.factions ?? []
  const invited = mine ? [] : factions.filter((g) => g.invites.some((i) => i.nation === me && i.expires >= game.turn))
  const asked = mine ? [] : factions.filter((g) => g.requests?.some((r) => r.nation === me && r.expires >= game.turn))
  const askers = mine ? (mine.requests ?? []).filter((r) => r.expires >= game.turn && game.nations[r.nation]?.alive && !factionOf(game, r.nation)) : []
  const sent = mine ? mine.invites.filter((i) => i.expires >= game.turn) : []
  if (invited.length + asked.length + askers.length + sent.length === 0) return null
  return (
    <section className="space-y-2" aria-label="Faction invitations">
      <div className="label text-[#ffd60a]">{WD} invitations and requests</div>
      {invited.map((g) => {
        const inv = g.invites.find((i) => i.nation === me)!
        return (
          <div key={g.id} className="rounded-lg border border-[#ffd60a]/50 bg-[#ffd60a]/6 p-3 space-y-2" data-testid="faction-invite-in">
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{game.nations[inv.by]?.name ?? 'A nation'} invites you to {g.name}</span>
              <span className="text-[12px] text-white/65 whitespace-nowrap">{inv.expires - game.turn + 1} months to answer</span>
            </div>
            <p className="text-[13px] text-white/75">
              {g.members.length} member{g.members.length === 1 ? '' : 's'}: {g.members.map((m) => game.nations[m]?.name).join(', ')}. {charterLine(g)}.
            </p>
            <OrderButton order={{ type: 'factionJoin', nationId: me, factionId: g.id }} label={`Join ${g.name}`} effect="You join when the month ends" tone="btn-primary" />
          </div>
        )
      })}
      {asked.map((g) => (
        <div key={g.id} className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-[13px]">
          You asked to join <span className="font-semibold">{g.name}</span>. A member who is a player has to say yes.
        </div>
      ))}
      {askers.map((r) => (
        <div key={r.nation} className="rounded-lg border border-[#ffd60a]/50 bg-[#ffd60a]/6 p-3 flex items-center justify-between gap-2" data-testid="faction-request-in">
          <span className="text-[14px] font-semibold">{game.nations[r.nation]?.name} asks to join {mine!.name}</span>
          <OrderButton order={{ type: 'factionInvite', nationId: me, target: r.nation }} label="Let them in" effect="They join when the month ends" tone="btn-primary" />
        </div>
      ))}
      {sent.length > 0 && (
        <div className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-[13px]">
          Waiting for an answer: {sent.map((i) => `${game.nations[i.nation]?.name} (${i.expires - game.turn + 1} months)`).join(', ')}
        </div>
      )}
    </section>
  )
}

/**
 * The same invitations and requests as `FactionNotices`, in one line for the Diplomacy desk: they are answered on the Bloc desk, so
 * the buttons live there once.
 */
export function FactionNoticeLine({ game, me }: { game: GameState; me: NationId }) {
  const openFaction = useGame((s) => s.openFaction)
  const mine = factionOf(game, me)
  const factions = game.factions ?? []
  const invited = mine ? [] : factions.filter((g) => g.invites.some((i) => i.nation === me && i.expires >= game.turn))
  const askers = mine ? (mine.requests ?? []).filter((r) => r.expires >= game.turn && game.nations[r.nation]?.alive && !factionOf(game, r.nation)) : []
  const parts = [
    ...invited.map((g) => `${g.name} invites you to join`),
    ...askers.map((r) => `${game.nations[r.nation]?.name} asks to join ${mine!.name}`),
  ]
  if (!parts.length) return null
  return (
    <div className="rounded-lg border border-[#ffd60a]/50 bg-[#ffd60a]/6 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[13px]" data-testid="faction-notice-line">
      <span className="min-w-0">{parts.join(' · ')}</span>
      <button className="btn btn-primary px-3 py-1.5 text-[13px]" onClick={() => openFaction()}>
        Answer on the {WD} desk
      </button>
    </div>
  )
}

/**
 * The faction row of a country's card in the Diplomacy desk: where they stand, and the one next step that fits you:
 * invite them (you have a faction), ask to join theirs, or found one together. Every button carries its cost and effect.
 */
export function FactionRow({ id }: { id: NationId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const openFaction = useGame((s) => s.openFaction)
  const human = useHumanName(id)
  const { map } = getWorld()
  const me = player.id
  const n = game.nations[id]
  const mine = factionOf(game, me)
  const theirs = factionOf(game, id)
  const relations = partnerRelations(game, me).get(id) ?? []
  const same = !!mine && mine.id === theirs?.id
  const link = (
    <button className="btn btn-quiet px-3 py-1.5 text-[13px] text-[#64d2ff] underline" onClick={() => openFaction(id)}>
      Open {WD} desk
    </button>
  )
  // Founding has no target of its own, so the reasons a partner is not a fit are checked here.
  const foundBlock = !mine && !theirs ? (n.overlord ? `${n.name} is a puppet` : player.overlord ? `A puppet cannot found a ${W}` : atWar(game, me, id) ? `You are at war with ${n.name}` : null) : null
  const odds = mine && !theirs && !human ? inviteOutlook(game, map, id, mine) : null
  const foundOrder = { type: 'factionFound' as const, nationId: me, name: factionName(game, me) }
  return (
    <div className="rounded-lg bg-black/25 p-2.5 space-y-2" aria-label={`${WD}: ${n.name}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="label">{WD}</div>
          {theirs ? (
            <>
              <div className="text-[14px] font-semibold truncate">
                {theirs.name} {same && <span className="chip chip-green ml-1">Your {W}</span>}
              </div>
              <div className="text-[12px] text-white/70">
                {theirs.members.length} member{theirs.members.length === 1 ? '' : 's'}: {theirs.members.map((m) => game.nations[m]?.name).join(', ')}
              </div>
              <div className="text-[12px] text-white/60">{charterLine(theirs)}</div>
            </>
          ) : (
            <div className="text-[14px] text-white/75">None</div>
          )}
        </div>
        {relations.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-end">
            {relations.slice(0, 3).map((r) => (
              <span key={r} className={`chip ${RELATION_TEXT[r].tone === 'good' ? 'chip-green' : ''}`} title={RELATION_TEXT[r].long}>
                {RELATION_TEXT[r].chip}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 items-start">
        {mine && !theirs && (
          <OrderButton
            order={{ type: 'factionInvite', nationId: me, target: id }}
            label={`Invite to my ${W}`}
            cost="free"
            effect={human ? `${human} sees it when the next month begins` : `They answer when the month ends${odds ? ` (${OUTLOOK_TEXT[odds].text.toLowerCase()})` : ''}`}
            tone="btn-primary"
          />
        )}
        {!mine && theirs && (
          <OrderButton
            order={{ type: 'factionRequest', nationId: me, factionId: theirs.id }}
            label={`Ask to join their ${W}`}
            cost={`${FACTION.requestInfluence} influence`}
            effect={theirs.members.some((m) => game.humans.includes(m) || game.nations[m]?.isPlayer) ? 'A member who is a player decides' : 'Its members answer when the month ends'}
          />
        )}
        {!mine && !theirs && !foundBlock && (
          <OrderButton
            order={foundOrder}
            label={`Found a ${W} with them`}
            cost={`${FACTION.foundInfluence} influence`}
            effect={`You found it when the month ends, then invite them from the ${WD} desk`}
            onDone={() => useGame.setState({ factionFocus: id })}
          />
        )}
        {link}
      </div>
      {foundBlock && <p className="text-[12px] text-[#ffb4ae]">Cannot found a {W} with them: {foundBlock}.</p>}
      {mine && theirs && !same && <p className="text-[12px] text-white/65">You are in different {W}s. Leave yours on the {WD} desk to join theirs.</p>}
      {mine && !theirs && relations.length === 0 && !human && odds === 'unlikely' && <p className="text-[12px] text-white/60">They do not know you well enough to say yes to this yet.</p>}
    </div>
  )
}
