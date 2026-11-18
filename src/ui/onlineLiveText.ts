import type { ClientId, ClockRequest, ClockView, Lobby } from '../net/protocol'
import type { LiveStatus } from '../net/session'
import type { OnlineView } from '../store'

/** What a clock request is called, for the button and the vote line. */
const verb = (req: ClockRequest) => (req.kind === 'pause' ? 'pause' : req.kind === 'resume' ? 'start the clock' : `run at ${req.speed}×`)

/** The words about who holds the clock. */
export function clockLine(clock: ClockView | null, online: Pick<OnlineView, 'host' | 'lobby'>, monthLeft: number): { text: string; tone: 'ok' | 'warn' | 'info' } {
  if (!clock) return { text: 'Connecting…', tone: 'info' }
  if (clock.vote) {
    const who = clock.vote.by.join(' and ')
    return { text: `${who} ${clock.vote.by.length === 1 ? 'wants' : 'want'} to ${verb(clock.vote.req)} (${clock.vote.by.length} of ${clock.vote.need} needed)`, tone: 'info' }
  }
  if (clock.running) return { text: `${clock.speed}× · ${monthLeft} day${monthLeft === 1 ? '' : 's'} left in the month`, tone: 'ok' }
  if (clock.why === 'over') return { text: 'The game is over', tone: 'info' }
  if (clock.why === 'asleep') return { text: 'Paused: the host’s computer was asleep', tone: 'warn' }
  if (clock.why === 'start' || !clock.by) return { text: online.host ? 'Press Play to start the clock' : 'Waiting for the host to start the clock', tone: 'info' }
  const host = online.lobby?.players.find((p) => p.clientId === online.lobby?.host)?.name
  return { text: clock.by === host ? `Host paused (${clock.by})` : `Paused by ${clock.by}`, tone: 'warn' }
}

/** How the line to the shared game is doing, in a few words and a colour. */
export function syncLine(live: LiveStatus | null, connection: OnlineView['connection'], host: boolean): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  if (connection !== 'connected') return { text: 'Reconnecting…', tone: 'bad' }
  if (!live) return { text: 'Connecting…', tone: 'warn' }
  if (live.hostAway) return { text: 'Cannot hear the host. If your connection is fine, someone takes over soon.', tone: 'bad' }
  if (!live.inSync) return { text: 'Catching up with the host…', tone: 'warn' }
  if (live.hostHidden) return { text: 'The host’s tab is in the background: the clock may move in jumps.', tone: 'warn' }
  const ping = live.rttMs === null ? '' : host ? ` · slowest friend ${live.rttMs} ms` : ` · ping ${live.rttMs} ms`
  return { text: `In sync${ping}`, tone: live.rttMs !== null && live.rttMs > 400 ? 'warn' : 'ok' }
}


/**
 * The note for a player whose screen has just taken over a game under way because the host left: the room runs on their
 * screen now and the clock is theirs. Null when nothing changed hands (the room's creator, a lobby, a host already).
 */
export function takeoverNote(before: Lobby | null | undefined, after: Lobby, me: ClientId): string | null {
  if (!before || before.host === me || after.host !== me || after.phase !== 'playing') return null
  const gone = before.players.find((p) => p.clientId === before.host)?.name ?? 'The host'
  return `${gone} left, so the game runs on your screen now. You are the host: the clock is yours.`
}
