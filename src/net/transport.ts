import type { ClientId, NetMessage } from './protocol'

/** A way to send a message to everyone else in the room, and to hear theirs. */
export interface Transport {
  send(msg: NetMessage): void
  onMessage(handler: (msg: NetMessage) => void): void
  close(): void
  /** What the connection is, for the lobby to say. */
  readonly kind: 'supabase' | 'browser' | 'memory'
}

/** Passes messages between pages of the same browser. It needs no server, so it is how the game is tried out alone. */
export function localTransport(code: string, clientId: ClientId): Transport {
  const channel = new BroadcastChannel(`worlds-of-others-${code}`)
  const handlers: ((msg: NetMessage) => void)[] = []
  channel.onmessage = (e: MessageEvent<NetMessage>) => {
    if (e.data?.from === clientId) return
    for (const h of handlers) h(e.data)
  }
  return {
    kind: 'browser',
    send: (msg) => channel.postMessage(msg),
    onMessage: (h) => handlers.push(h),
    close: () => channel.close(),
  }
}

export const supabaseConfigured = () => !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

/** Supabase Realtime broadcast: a channel per room. No tables are needed, and the anon key is all it takes. */
export async function supabaseTransport(code: string, clientId: ClientId): Promise<Transport> {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 30 } },
  })
  const channel = client.channel(`worlds-of-others:${code}`, { config: { broadcast: { self: false, ack: false } } })
  const handlers: ((msg: NetMessage) => void)[] = []
  channel.on('broadcast', { event: 'm' }, ({ payload }) => {
    const msg = payload as NetMessage
    if (msg?.from === clientId) return
    for (const h of handlers) h(msg)
  })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Could not reach the game server')), 10_000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout)
        reject(new Error('Could not reach the game server'))
      }
    })
  })
  return {
    kind: 'supabase',
    send: (msg) => void channel.send({ type: 'broadcast', event: 'm', payload: msg }),
    onMessage: (h) => handlers.push(h),
    close: () => void client.removeChannel(channel),
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
  private members = new Map<ClientId, (msg: NetMessage) => void>()
  /** Messages held back to test slow or dropped connections. */
  dropFrom = new Set<ClientId>()
  log: NetMessage[] = []

  join(clientId: ClientId): Transport {
    const handlers: ((msg: NetMessage) => void)[] = []
    this.members.set(clientId, (msg) => handlers.forEach((h) => h(msg)))
    return {
      kind: 'memory',
      send: (msg) => {
        if (this.dropFrom.has(clientId)) return
        this.log.push(msg)
        for (const [id, deliver] of this.members) if (id !== clientId) queueMicrotask(() => deliver(structuredClone(msg)))
      },
      onMessage: (h) => handlers.push(h),
      close: () => void this.members.delete(clientId),
    }
  }
}
