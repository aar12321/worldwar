import { motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DIFFICULTY } from '../data/difficulty'
import type { Difficulty } from '../engine/types'
import { getWorld } from '../map/world'
import { MAX_PLAYERS, type RoomSettings } from '../net/protocol'
import { supabaseConfigured } from '../net/transport'
import { rememberedName, useGame } from '../store'
import { globeBridge } from './globeBridge'
import { Modal } from './Modal'
import { clock, useCountdown } from './clock'
import { nationTier, rankNations } from './nationList'

const VICTORY = [
  { share: 0.25, label: 'Short' },
  { share: 0.4, label: 'Full' },
  { share: 0.6, label: 'Long' },
]

const TIMERS: { value: RoomSettings['timer']; label: string }[] = [
  { value: 0, label: 'No timer' },
  { value: 60, label: '1 min' },
  { value: 90, label: '90 sec' },
  { value: 120, label: '2 min' },
  { value: 180, label: '3 min' },
]

/** What kind of connection this is, in words a player can act on. */
export function ConnectionNote({ kind }: { kind: 'supabase' | 'browser' | 'memory' }) {
  if (kind === 'supabase') return <p className="text-[13px] text-[#6eeb8a]">Connected. Friends anywhere can join with the code.</p>
  return (
    <p className="text-[13px] text-[#ffd60a] leading-snug">
      Practice mode: only other tabs of this browser can join. To play across computers, this site needs a Supabase project (see the README).
    </p>
  )
}

/** The first step: a name, then make a room or join one. */
export function OnlineEntry({ onClose }: { onClose: () => void }) {
  const create = useGame((s) => s.createOnline)
  const join = useGame((s) => s.joinOnline)
  const lastRoom = useGame((s) => s.lastRoom)
  const [name, setName] = useState(rememberedName)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const configured = supabaseConfigured()
  const ready = name.trim().length > 0

  const run = async (go: () => Promise<void>) => {
    setBusy(true)
    await go()
    setBusy(false)
    onClose()
  }

  return (
    <Modal title="Play with friends" kicker="Two to four players. Everyone plans the same month, then presses Ready." onClose={onClose} footer={<button className="btn px-5 py-2.5 text-[15px]" onClick={onClose}>Back</button>}>
      <div className="space-y-5">
        <label className="block">
          <span className="label">Your name</span>
          <input data-autofocus value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="What your friends will see" className="field mt-1.5 w-full px-3 py-2.5 text-[15px]" />
        </label>

        <section className="inset-card p-4 space-y-3">
          <div>
            <div className="text-[16px] font-semibold tracking-tight">Make a room</div>
            <p className="text-[14px] text-white/70 mt-0.5">You choose the rules and share a five-letter code.</p>
          </div>
          <button
            className="btn btn-primary w-full py-2.5 text-[15px]"
            disabled={!ready || busy}
            onClick={() => void run(() => create(name, { difficulty: 'normal', victoryShare: 0.4, timer: 0, seed: Math.floor(Math.random() * 1e6) }))}
          >
            Create a room
          </button>
        </section>

        <section className="inset-card p-4 space-y-3">
          <div>
            <div className="text-[16px] font-semibold tracking-tight">Join a room</div>
            <p className="text-[14px] text-white/70 mt-0.5">Type the code your friend sees in their lobby.</p>
          </div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={7}
              aria-label="Room code"
              placeholder="K7Q2M"
              className="field flex-1 min-w-0 px-3 py-2.5 text-[18px] font-semibold tracking-[0.25em] text-center uppercase"
            />
            <button className="btn btn-primary px-5 py-2.5 text-[15px]" disabled={!ready || busy || code.trim().length < 5} onClick={() => void run(() => join(name, code))}>
              Join
            </button>
          </div>
          {lastRoom && (
            <button className="btn btn-quiet" disabled={!ready || busy} onClick={() => void run(() => join(name, lastRoom, true))}>
              Rejoin {lastRoom}
            </button>
          )}
        </section>

        {configured ? <p className="text-[13px] text-white/65">Rooms are relayed through the game server, so friends can be anywhere.</p> : <ConnectionNote kind="browser" />}
      </div>
    </Modal>
  )
}

function SettingRow<T extends string | number>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled: boolean }) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} aria-pressed={value === o.value} disabled={disabled} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The room before the game: who is here, who plays what, and the rules. */
export function Lobby() {
  const online = useGame((s) => s.online)
  const pickNation = useGame((s) => s.pickOnlineNation)
  const update = useGame((s) => s.updateOnlineSettings)
  const start = useGame((s) => s.startOnline)
  const leave = useGame((s) => s.leaveOnline)
  const toast = useGame((s) => s.toast)
  const { map } = getWorld()
  const [query, setQuery] = useState('')
  const [starting, setStarting] = useState(false)
  const nations = useMemo(() => rankNations(map), [map])
  const lobby = online?.lobby ?? null
  const mine = lobby?.players.find((p) => p.clientId === online?.clientId)
  const taken = useMemo(() => new Map((lobby?.players ?? []).filter((p) => p.nationId).map((p) => [p.nationId as string, p])), [lobby])

  useEffect(() => {
    const region = mine?.nationId ? map.regions[mine.nationId] : null
    if (region) globeBridge.api?.pointOfView({ lat: region.lat, lng: region.lng, altitude: 1.8 }, 700)
  }, [mine?.nationId, map])

  if (!online) return null
  const copy = () => {
    void navigator.clipboard?.writeText(online.code).then(
      () => toast('Room code copied', 'success', 2500),
      () => toast(`The code is ${online.code}`, 'info', 5000),
    )
  }

  if (!lobby) {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
        <div className="glass pointer-events-auto rounded-[22px] p-6 text-center space-y-3 w-[min(420px,90vw)]">
          <p className="text-[16px] font-semibold">Joining room {online.code}…</p>
          <button className="btn" onClick={leave}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const settings = lobby.settings
  const isHost = online.host
  const everyonePicked = lobby.players.every((p) => p.nationId)
  const canStart = isHost && everyonePicked && !starting && lobby.phase === 'lobby'
  const filtered = nations.filter(({ r }) => r.name.toLowerCase().includes(query.toLowerCase()))
  const change = (patch: Partial<RoomSettings>) => update({ ...settings, ...patch })

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="lobby-title absolute top-6 left-1/2 -translate-x-1/2 text-center w-[min(640px,90vw)]">
        <p className="text-[13px] font-medium text-white/60">Room</p>
        <button className="lobby-code mt-1 text-[44px] font-semibold tracking-[0.18em] text-white pointer-events-auto hover:text-[#64a8ff]" onClick={copy} title="Copy the code" aria-label={`Room code ${online.code.split('').join(' ')}. Click to copy.`}>
          {online.code}
        </button>
        <p className="lobby-sub text-[14px] text-white/70">Share this code with up to {MAX_PLAYERS - 1} friends.</p>
      </motion.div>

      <motion.div initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="lobby-list glass pointer-events-auto absolute left-6 top-40 bottom-6 w-[380px] rounded-[22px] flex flex-col overflow-hidden">
        <div className="p-5 border-b border-white/10 space-y-3">
          <div className="text-[17px] font-semibold tracking-tight">Players ({lobby.players.length} of {MAX_PLAYERS})</div>
          <ul className="space-y-1.5" aria-label="Players in this room">
            {lobby.players.map((p) => {
              const here = p.clientId === online.clientId || online.peers.includes(p.clientId)
              return (
                <li key={p.clientId} className="inset-card px-3 py-2 flex items-center gap-2.5">
                  <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: here ? '#30d158' : '#8e8e93' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold truncate">
                      {p.name}
                      {p.clientId === online.clientId && <span className="text-white/60 font-normal"> (you)</span>}
                      {p.clientId === lobby.host && <span className="ml-1.5 text-[12px] text-[#64a8ff] font-semibold">Host</span>}
                    </span>
                    <span className="block text-[13px] text-white/70 truncate">{p.nationId ? map.regions[p.nationId].name : 'Choosing a nation…'}</span>
                  </span>
                  <span className="sr-only">{here ? 'Here' : 'Away'}</span>
                </li>
              )
            })}
          </ul>
          <ConnectionNote kind={online.kind} />
        </div>
        <div className="px-5 pt-4 pb-2">
          <div className="text-[15px] font-semibold">Your nation</div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, or click the globe" className="field mt-2 w-full px-3 py-2 text-[14px]" aria-label="Search nations" />
        </div>
        <div className="lobby-nations flex-1 overflow-y-auto scroll-thin p-2">
          {filtered.map(({ r, score }) => {
            const owner = taken.get(r.id)
            const mineNow = owner?.clientId === online.clientId
            const blocked = !!owner && !mineNow
            return (
              <button
                key={r.id}
                disabled={blocked}
                onClick={() => pickNation(mineNow ? null : r.id)}
                className={`w-full text-left rounded-xl px-3 py-2 flex items-center justify-between transition-colors ${mineNow ? 'bg-[#0a84ff]/25' : 'hover:bg-white/6'} ${blocked ? 'opacity-45 cursor-not-allowed' : ''}`}
                aria-pressed={mineNow}
              >
                <span className="font-semibold">{r.name}</span>
                <span className="text-xs text-slate-400">{owner ? (mineNow ? 'Yours' : owner.name) : nationTier(score)}</span>
              </button>
            )
          })}
        </div>
      </motion.div>

      <motion.div initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="lobby-card glass pointer-events-auto absolute right-6 bottom-6 w-[400px] rounded-[22px] p-5 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[17px] font-semibold tracking-tight">Rules</div>
          <div className="text-[12px] text-white/65">{isHost ? 'You set these' : 'The host sets these'}</div>
        </div>
        <SettingRow<Difficulty>
          label="Rival nations"
          value={settings.difficulty}
          disabled={!isHost}
          options={(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => ({ value: d, label: DIFFICULTY[d].name }))}
          onChange={(difficulty) => change({ difficulty })}
        />
        <SettingRow<number> label="How you win" value={settings.victoryShare} disabled={!isHost} options={VICTORY.map((v) => ({ value: v.share, label: v.label }))} onChange={(victoryShare) => change({ victoryShare })} />
        <SettingRow<number> label="Time to plan each month" value={settings.timer} disabled={!isHost} options={TIMERS} onChange={(timer) => change({ timer: timer as RoomSettings['timer'] })} />
        <p className="text-[13px] text-white/65 leading-snug">Everyone plans at once. The month moves on when every player is Ready, or when the timer ends. Nations nobody picks are run by the AI.</p>
        <div className="flex gap-2">
          <button className="btn flex-1 py-3" onClick={leave}>
            Leave
          </button>
          {isHost ? (
            <button
              className="btn btn-primary flex-[2] py-3 text-[15px]"
              disabled={!canStart}
              onClick={async () => {
                setStarting(true)
                await start()
                setStarting(false)
              }}
            >
              {everyonePicked ? 'Start game' : 'Waiting for nations…'}
            </button>
          ) : (
            <div className="flex-[2] flex items-center justify-center text-[14px] text-white/70">{lobby.phase === 'playing' ? 'Starting…' : 'Waiting for the host to start'}</div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

/** Who has pressed Ready, as one dot per player. */
export function ReadyDots() {
  const online = useGame((s) => s.online)
  const game = useGame((s) => s.game)
  if (!online?.lobby || !game) return null
  const players = online.lobby.players.filter((p) => p.nationId)
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`${online.ready.length} of ${players.length} players ready`}>
      {players.map((p) => {
        const done = online.ready.includes(p.nationId as string)
        const color = game.nations[p.nationId as string]?.color ?? '#fff'
        return <span key={p.clientId} className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: done ? color : 'transparent', border: `1.5px solid ${color}` }} />
      })}
    </span>
  )
}

/** The line under the Ready button: how many are done and how long is left. */
export function OnlineStatus() {
  const online = useGame((s) => s.online)
  const seconds = useCountdown(online?.deadline ?? null)
  if (!online?.lobby) return null
  const players = online.lobby.players.filter((p) => p.nationId)
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <ReadyDots />
      <span>
        {online.ready.length} of {players.length} ready
        {seconds !== null && <span className={seconds <= 10 ? 'text-[#ff8a84] font-semibold' : ''}> · {clock(seconds)}</span>}
      </span>
    </span>
  )
}

/** The players, a way to say something to them, and a way out. */
export function OnlinePeople() {
  const online = useGame((s) => s.online)
  const game = useGame((s) => s.game)
  const send = useGame((s) => s.sendChat)
  const markRead = useGame((s) => s.markChatRead)
  const leave = useGame((s) => s.leaveOnline)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const log = useRef<HTMLUListElement>(null)
  const chatLength = online?.chat.length ?? 0

  useEffect(() => {
    if (open) {
      markRead()
      log.current?.scrollTo({ top: log.current.scrollHeight })
    }
  }, [open, chatLength, markRead])

  if (!online?.lobby || !game) return null
  const unread = online.unread

  return (
    <>
      <button className="btn btn-quiet relative w-full" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Players and chat
        {unread > 0 && !open && (
          <span className="ml-1.5 inline-flex min-w-5 h-5 px-1 items-center justify-center rounded-full bg-[#ff453a] text-white text-[12px] font-bold" aria-label={`${unread} new messages`}>
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="online-pop surface" role="dialog" aria-label="Players and chat">
          <div className="flex items-start justify-between gap-3 px-4 pt-3">
            <div>
              <div className="label">Room</div>
              <div className="text-[20px] font-semibold tracking-[0.16em]">{online.code}</div>
            </div>
            <button className="icon-close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <ul className="px-4 py-2 space-y-1" aria-label="Players">
            {online.lobby.players
              .filter((p) => p.nationId)
              .map((p) => {
                const nation = game.nations[p.nationId as string]
                const done = online.ready.includes(p.nationId as string)
                const here = p.clientId === online.clientId || online.peers.includes(p.clientId)
                const out = game.eliminated.includes(p.nationId as string)
                return (
                  <li key={p.clientId} className="flex items-center gap-2 text-[14px]">
                    <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: nation?.color ?? '#fff' }} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-white/65"> · {nation?.name}</span>
                    </span>
                    <span className="text-[12px] shrink-0 text-white/70">{out ? 'Out' : !here ? 'Away (AI plays)' : done ? 'Ready' : 'Planning'}</span>
                  </li>
                )
              })}
          </ul>
          <ul ref={log} className="mx-4 my-2 h-32 overflow-y-auto scroll-thin space-y-1.5 text-[14px]" aria-label="Chat" aria-live="polite">
            {online.chat.length === 0 && <li className="text-white/55">Say hello. Messages only reach this room.</li>}
            {online.chat.map((m, i) => (
              <li key={`${m.at}-${i}`}>
                <span className={`font-semibold ${m.from === online.clientId ? 'text-[#64a8ff]' : ''}`}>{m.name}</span> <span className="text-white/85">{m.text}</span>
              </li>
            ))}
          </ul>
          <form
            className="px-4 pb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send(text)
              setText('')
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={240} placeholder="Message" aria-label="Message" className="field flex-1 min-w-0 px-3 py-2 text-[14px]" />
            <button className="btn btn-primary px-4" type="submit" disabled={!text.trim()}>
              Send
            </button>
          </form>
          <div className="px-4 pb-3">
            <button
              className="btn btn-quiet"
              onClick={() => {
                if (window.confirm('Leave this game? Your nation is played by the AI until you come back with the same room code.')) leave()
              }}
            >
              Leave the game
            </button>
          </div>
        </div>
      )}
    </>
  )
}
