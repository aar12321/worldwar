import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientId, NetMessage } from './protocol'

/** Whether messages are getting through. `reconnecting` means the line dropped and the library is bringing it back. */
export type TransportStatus = 'connected' | 'reconnecting' | 'closed'

/** A way to send a message to everyone else in the room, and to hear theirs. */
export interface Transport {
  send(msg: NetMessage): void
  onMessage(handler: (msg: NetMessage) => void): void
  /** Told each time the line drops or comes back. */
  onStatus(handler: (status: TransportStatus) => void): void
  readonly status: TransportStatus
  close(): void
  /** What the connection is, for the lobby to say. */
  readonly kind: 'supabase' | 'browser' | 'memory'
}

/** Holds a status and tells whoever listens when it changes. */
function statusKeeper(initial: TransportStatus) {
  let status = initial
  const handlers: ((s: TransportStatus) => void)[] = []
  return {
    get: () => status,
    set(next: TransportStatus) {
      if (next === status || status === 'closed') return
      status = next
      for (const h of handlers) h(next)
    },
    on: (h: (s: TransportStatus) => void) => void handlers.push(h),
  }
}

/** Passes messages between pages of the same browser. It needs no server, so it is how the game is tried out alone. */
export function localTransport(code: string, clientId: ClientId): Transport {
  const channel = new BroadcastChannel(`worlds-of-others-${code}`)
  const handlers: ((msg: NetMessage) => void)[] = []
  const keeper = statusKeeper('connected')
  channel.onmessage = (e: MessageEvent<NetMessage>) => {
    if (e.data?.from === clientId) return
    for (const h of handlers) h(e.data)
  }
  return {
    kind: 'browser',
    get status() {
      return keeper.get()
    },
    onStatus: keeper.on,
    send: (msg) => channel.postMessage(msg),
    onMessage: (h) => handlers.push(h),
    close: () => {
      keeper.set('closed')
      channel.close()
    },
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = () => !!(supabaseUrl && supabaseKey)

/** One client for the whole page: each room is only a channel on it, so a second room does not open a second socket. */
let sharedClient: Promise<SupabaseClient> | null = null
function supabaseClient(): Promise<SupabaseClient> {
  sharedClient ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(supabaseUrl as string, supabaseKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 30 } },
    }),
  )
  return sharedClient
}

/**
 * Supabase Realtime broadcast: a channel per room. No tables are needed, and the anon key is all it takes.
 * The library rejoins a dropped channel by itself, so this only reports when that happens and when it is over.
 */
export async function supabaseTransport(code: string, clientId: ClientId): Promise<Transport> {
  const client = await supabaseClient()
  const channel = client.channel(`worlds-of-others:${code}`, { config: { broadcast: { self: false, ack: false } } })
  const handlers: ((msg: NetMessage) => void)[] = []
  const keeper = statusKeeper('reconnecting')
  let closing = false
  channel.on('broadcast', { event: 'm' }, ({ payload }) => {
    const msg = payload as NetMessage
    if (msg?.from === clientId) return
    for (const h of handlers) h(msg)
  })
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      // A room that never opened must not stay subscribed.
      void client.removeChannel(channel)
      reject(new Error('Could not reach the game server'))
    }
    const timeout = setTimeout(fail, 10_000)
    channel.subscribe((status) => {
      if (closing) return
      if (status === 'SUBSCRIBED') {
        keeper.set('connected')
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve()
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (!settled) fail()
        else keeper.set('reconnecting')
      }
    })
  })
  return {
    kind: 'supabase',
    get status() {
      return keeper.get()
    },
    onStatus: keeper.on,
    // While the line is down a send would quietly turn into one web request per message, so it is dropped: the game
    // already sends plans again and asks for the game back once the line returns.
    send: (msg) => {
      if (keeper.get() === 'connected') void channel.send({ type: 'broadcast', event: 'm', payload: msg })
    },
    onMessage: (h) => handlers.push(h),
    close: () => {
      closing = true
      keeper.set('closed')
      void client.removeChannel(channel)
    },
  }
}

/** The best connection available: Supabase when it is set up, otherwise this browser only. */
export async function openTransport(code: string, clientId: ClientId, allowLocal = true): Promise<Transport> {
  if (supabaseConfigured()) return supabaseTransport(code, clientId)
  if (!allowLocal) throw new Error('Online play is not set up')
  return localTransport(code, clientId)
}

/** An in-memory room for tests: every transport made from one hub hears the others. */
export class MemoryHub {
  private members = new Map<ClientId, { deliver: (msg: NetMessage) => void; keeper: ReturnType<typeof statusKeeper> }>()
  /** Messages held back to test slow or dropped connections. */
  dropFrom = new Set<ClientId>()
  /** Members that hear nothing, to test a screen that never learns it was replaced. */
  deaf = new Set<ClientId>()
  log: NetMessage[] = []

  /** Cuts a member's line (nothing gets in or out) or restores it, as a dropped connection would. */
  setOnline(clientId: ClientId, online: boolean) {
    this.members.get(clientId)?.keeper.set(online ? 'connected' : 'reconnecting')
  }

  join(clientId: ClientId): Transport {
    const handlers: ((msg: NetMessage) => void)[] = []
    const keeper = statusKeeper('connected')
    this.members.set(clientId, { deliver: (msg) => handlers.forEach((h) => h(msg)), keeper })
    return {
      kind: 'memory',
      get status() {
        return keeper.get()
      },
      onStatus: keeper.on,
      send: (msg) => {
        if (this.dropFrom.has(clientId) || keeper.get() !== 'connected') return
        this.log.push(msg)
        for (const [id, m] of this.members) if (id !== clientId) queueMicrotask(() => m.keeper.get() === 'connected' && !this.deaf.has(id) && m.deliver(structuredClone(msg)))
      },
      onMessage: (h) => handlers.push(h),
      close: () => {
        keeper.set('closed')
        this.members.delete(clientId)
      },
    }
  }
}
