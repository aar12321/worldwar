import { useEffect, useMemo, useRef, useState } from 'react'
import { opinionLabel, opinionOf } from '../ai/opinion'
import { CHARTER_TEXT, FACTION, POOL_NAMES } from '../data/factions'
import { PROPOSAL_COSTS, UNIT_SPECS } from '../data/unitTypes'
import { FactionNotices } from './FactionLinks'
import { inviteCandidates } from '../engine/partners'
import { inviteItems, nationItems, pickerMatches, type PickerItem } from './pickerItems'
import { claimValue, describeContract, factionOf, lockLeft, poolPower, poolUnits, poolValue, sharesOf, tallyOf, warInfluence, warTargetProblem, withdrawable, withdrawableUnits } from '../engine/factions'
import { atWar, clamp, regionsOf, turnDate } from '../engine/helpers'
import { militaryPower } from '../engine/militaryStats'
import { powerView, showPower } from '../engine/intel'
import type { Deal, Faction, FactionCharter, FactionGift, FactionProposal, GameState, NationId, Order, PoolResource, ResourceBundle, TradeResource, UnitType } from '../engine/types'
import { POOL_RESOURCES, TRADE_RESOURCES, UNIT_TYPES } from '../engine/types'
import { TRADE_LIMITS } from '../data/unitTypes'
import { describeBundle } from '../engine/trade'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { Bar, StatTile, Tiles } from './kit'
import { UnitIcon } from './icons'
import { OrderButton, PanelShell, Tabs } from './panel'
import { usePlayerView } from './hooks'

type FactionTab = 'council' | 'pool' | 'contracts' | 'log'

const pct = (v: number) => `${Math.round(v * 100)}%`
const num = (v: number, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-US', { maximumFractionDigits: d })
const MEMBER_COLORS = ['#0a84ff', '#30d158', '#ffd60a', '#ff9f0a', '#bf5af2', '#64d2ff', '#ff6482', '#ac8e68']

/** The players' names, to tell people from rivals in the member list. */
function usePlayerNames(): Record<NationId, string> {
  const players = useGame((s) => s.online?.lobby?.players)
  return useMemo(() => {
    const out: Record<NationId, string> = {}
    for (const p of players ?? []) if (p.nationId) out[p.nationId] = p.name
    return out
  }, [players])
}

function Dot({ color }: { color: string }) {
  return <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
}

const CHIP_CLASS = { good: 'chip-green', warn: '', bad: 'chip-red', none: '' }

export function NationPicker({ items, value, onChange, placeholder = 'Search countries', label, max = 260, reveal = null }: { items: PickerItem[]; value: NationId | null; onChange: (id: NationId | null) => void; placeholder?: string; label: string; max?: number; reveal?: NationId | null }) {
  const [query, setQuery] = useState('')
  const [blocked, setBlocked] = useState<PickerItem | null>(null)
  const q = query.trim().toLowerCase()
  const shown = items.filter((i) => pickerMatches(i, q))
  const picked = useRef<HTMLButtonElement>(null)
  // A choice made elsewhere (coming from the Diplomacy desk) is scrolled into view.
  useEffect(() => {
    picked.current?.scrollIntoView({ block: 'nearest' })
    const it = reveal ? items.find((x) => x.id === reveal) : null
    if (it?.why) setBlocked(it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reveal])
  return (
    <div className="space-y-2">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={`Search: ${label}`} className="field w-full px-3 py-2 text-[15px]" />
      <div role="listbox" aria-label={label} className="rounded-xl bg-black/35 border border-white/10 overflow-y-auto scroll-thin p-1" style={{ maxHeight: max }}>
        {shown.length === 0 && <div className="px-3 py-3 text-[14px] text-white/65">No country matches.</div>}
        {shown.map((i, n) => (
          <div key={i.id}>
            {i.group && i.group !== shown[n - 1]?.group && <div role="presentation" className="label px-3 pt-2 pb-1">{i.group}</div>}
            <button
              ref={value === i.id || reveal === i.id ? picked : undefined}
              role="option"
              aria-selected={value === i.id}
              aria-disabled={!!i.why}
              onClick={() => {
                // A row that cannot be chosen never becomes the choice; it says why instead.
                if (i.why) return setBlocked(blocked?.id === i.id ? null : i)
                setBlocked(null)
                onChange(value === i.id ? null : i.id)
              }}
              className={`w-full text-left rounded-lg px-3 py-2 flex items-center gap-2.5 transition-colors ${value === i.id ? 'bg-[#0a84ff]/30 ring-1 ring-[#0a84ff]/70' : 'hover:bg-white/8'} ${i.why ? 'opacity-70' : ''}`}
              title={i.why ?? undefined}
            >
              {i.color && <Dot color={i.color} />}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-white truncate">{i.name}</span>
                {(i.chip || (i.chips?.length ?? 0) > 0) && (
                  <span className="flex flex-wrap gap-1 mt-0.5">
                    {[...(i.chip ? [i.chip] : []), ...(i.chips ?? [])].map((c) => (
                      <span key={c.text} className={`chip ${CHIP_CLASS[c.tone]}`}>{c.text}</span>
                    ))}
                  </span>
                )}
                {i.why && <span className="block text-[12px] text-[#ffb4ae] leading-snug mt-0.5">{i.why}</span>}
              </span>
              {i.note && <span className="text-[12px] text-white/70 tabular-nums text-right">{i.note}</span>}
            </button>
          </div>
        ))}
      </div>
      {blocked && (
        <p className="text-[13px] text-[#ffb4ae]" role="status">
          {blocked.why}.
        </p>
      )}
    </div>
  )
}

// ---- the card and the members ----

function FactionCard({ game, f, me }: { game: GameState; f: Faction; me: NationId }) {
  const shares = sharesOf(f, game)
  const value = poolValue(f)
  const power = poolPower(game, f)
  const founder = game.nations[f.founder]
  return (
    <section className="rounded-2xl border border-[#0a84ff]/40 bg-gradient-to-br from-[#0a84ff]/16 to-white/4 p-4 space-y-3" aria-label="Your faction">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label">Your faction</div>
          <h3 className="text-[24px] font-semibold tracking-tight leading-tight truncate">{f.name}</h3>
          <p className="text-[13px] text-white/70">
            Founded {turnDate(f.founded)} by {founder?.name ?? f.founder} · {f.members.length} member{f.members.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="label">Your share</div>
          <div className="text-[26px] font-semibold tabular-nums leading-none text-[#8ec5ff]">{pct(shares[me] ?? 0)}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="chip chip-blue">{CHARTER_TEXT.vote[f.charter.vote]}</span>
        <span className="chip">{CHARTER_TEXT.spoils[f.charter.spoils]}</span>
        <span className="chip">{CHARTER_TEXT.exit[f.charter.exit]}</span>
      </div>
      <Tiles>
        <StatTile label="Pool worth" value={num(value)} sub="money at fixed values" />
        <StatTile label="Joint army" value={`${num(poolUnits(f), 1)} div.`} sub={`strength ${num(power)}`} tone={f.short ? 'warn' : undefined} />
        <StatTile label="Wars" value={f.wars.length} sub={f.wars.length ? f.wars.map((w) => game.nations[w.target]?.name).join(', ') : 'at peace'} tone={f.wars.length ? 'bad' : undefined} />
      </Tiles>
      {f.short && <p className="text-[13px] text-[#ffd60a]">The joint army went short of {[f.short.oil && 'fuel', f.short.food && 'food'].filter(Boolean).join(' and ')} last month and fights weaker. Put oil, food or money into the pool.</p>}
    </section>
  )
}

function Members({ game, f, me }: { game: GameState; f: Faction; me: NationId }) {
  const shares = sharesOf(f, game)
  const names = usePlayerNames()
  const rows = [...f.members].sort((a, b) => shares[b] - shares[a] || (a < b ? -1 : 1))
  return (
    <section className="space-y-2" aria-label="Members">
      <div className="label">Members and what they put in</div>
      {rows.map((id) => {
        const n = game.nations[id]
        const l = f.ledger[id]
        const idx = f.members.indexOf(id)
        const soldiers = l ? UNIT_TYPES.reduce((a, k) => a + l.units[k], 0) : 0
        const lock = lockLeft(game, f, id)
        const person = game.humans.includes(id) || n?.isPlayer
        return (
          <div key={id} className={`rounded-xl border p-3 ${id === me ? 'border-[#0a84ff]/50 bg-[#0a84ff]/8' : 'border-white/12 bg-white/5'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <Dot color={n?.color ?? MEMBER_COLORS[idx % MEMBER_COLORS.length]} />
                <span className="font-semibold text-[15px] truncate">{n?.name ?? id}</span>
                {id === me && <span className="chip chip-blue">You</span>}
                {id === f.founder && <span className="chip" title="The founder">Founder</span>}
                {!(id === me && !names[id]) && <span className="chip">{person ? (names[id] ? `Player: ${names[id]}` : 'Player') : 'Rival'}</span>}
              </span>
              <span className="text-[18px] font-semibold tabular-nums">{pct(shares[id] ?? 0)}</span>
            </div>
            <div className="mt-2">
              <Bar value={shares[id] ?? 0} color={MEMBER_COLORS[idx % MEMBER_COLORS.length]} label={`${n?.name} ownership share`} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-white/70">
              <span>claim worth {num(claimValue(f, id))}</span>
              <span>soldiers {num(soldiers, 1)}</span>
              {f.charter.vote === 'weighted' && <span>vote weight {pct(shares[id] ?? 0)}</span>}
              {lock > 0 && <span className="text-[#ffd60a]">locked {lock} more month{lock === 1 ? '' : 's'}</span>}
            </div>
          </div>
        )
      })}
    </section>
  )
}

// ---- votes ----

function VoteCard({ game, f, p, me, orders }: { game: GameState; f: Faction; p: FactionProposal; me: NationId; orders: Order[] }) {
  const issueOrder = useGame((s) => s.issueOrder)
  const removeOrder = useGame((s) => s.removeOrder)
  const idx = orders.findIndex((o) => o.type === 'factionVote' && o.proposalId === p.id)
  const queued = idx >= 0 && orders[idx].type === 'factionVote' ? (orders[idx] as Extract<Order, { type: 'factionVote' }>).vote : null
  const mine = queued ?? p.votes[me] ?? null
  // The count as it will stand if everything queued is sent.
  const votes = { ...p.votes }
  for (const o of orders) if (o.type === 'factionVote' && o.proposalId === p.id) votes[o.nationId] = o.vote
  const t = tallyOf(game, f, { ...p, votes })
  const w = t.total > 0 ? t.total : 1
  const left = Math.max(0, p.expires - game.turn)
  const title = p.kind === 'war' ? `War on ${game.nations[p.target!]?.name ?? 'a country'}` : 'Supply contract'
  const base = { type: 'factionVote' as const, nationId: me, proposalId: p.id }
  const toast = useGame((s) => s.toast)
  const cast = (vote: 'yes' | 'no') => {
    if (queued === vote) return removeOrder(idx)
    if (issueOrder({ ...base, vote })) toast(`Your ${vote} vote on ${title.replace(/^War/, 'war').replace(/^Supply/, 'supply')} is in. It counts when the month ends.`, 'success', 3500)
  }
  const verdict = t.outcome === 'pass' ? 'Passes when the month ends' : t.outcome === 'fail' ? 'Fails when the month ends' : `Open: it needs more than half of the ${f.charter.vote === 'weighted' ? 'weight' : 'votes'} to pass`
  return (
    <div className="rounded-2xl border border-[#ffd60a]/50 bg-[#ffd60a]/6 p-4 space-y-3" data-testid="vote-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[20px] font-semibold leading-tight">{title}</div>
          <div className="text-[13px] text-white/70">
            Put forward by {game.nations[p.by]?.name ?? p.by} · {left === 0 ? 'last month to vote' : `${left + 1} months to vote`}
          </div>
          {p.kind === 'contract' && p.terms && <div className="text-[13px] text-white/85 mt-1">{describeContract(p.terms, game.nations[p.terms.member]?.name)}.</div>}
        </div>
        <span className={`chip ${t.outcome === 'pass' ? 'chip-green' : t.outcome === 'fail' ? 'chip-red' : ''}`}>{t.outcome === 'pass' ? 'Passing' : t.outcome === 'fail' ? 'Failing' : 'Open'}</span>
      </div>
      <div>
        <div className="flex h-4 rounded-full overflow-hidden bg-white/12" role="img" aria-label={`${num(t.yes, 1)} yes, ${num(t.no, 1)} no, ${t.waiting.length} not voted`}>
          <div className="h-full bg-[#30d158]" style={{ width: `${(t.yes / w) * 100}%` }} />
          <div className="h-full bg-[#ff453a]" style={{ width: `${(t.no / w) * 100}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[13px] tabular-nums">
          <span className="text-[#6eeb8a] font-semibold">Yes {f.charter.vote === 'weighted' ? pct(t.yes / w) : num(t.yes)}</span>
          <span className="text-white/65">{t.waiting.length} waiting</span>
          <span className="text-[#ff8a84] font-semibold">No {f.charter.vote === 'weighted' ? pct(t.no / w) : num(t.no)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {f.members.map((m) => {
          const v = votes[m]
          return (
            <span key={m} className={`chip ${v === 'yes' ? 'chip-green' : v === 'no' ? 'chip-red' : ''}`} title={v ? `${game.nations[m]?.name} voted ${v}` : `${game.nations[m]?.name} has not voted`}>
              {v === 'yes' ? '✓' : v === 'no' ? '✗' : '…'} {game.nations[m]?.name}
            </span>
          )
        })}
      </div>
      <p className="text-[13px] text-white/75">{verdict}. {queued ? `Your ${queued} vote is sent when the month ends.` : mine ? `You voted ${mine}.` : 'You have not voted.'}</p>
      <div className="grid grid-cols-2 gap-2">
        <button className={`btn text-[16px] py-3 min-h-[48px] ${mine === 'yes' ? 'btn-primary' : ''}`} style={mine === 'yes' ? { background: '#248a3d' } : { background: 'rgba(48,209,88,0.18)', color: '#9ff0b5' }} aria-pressed={mine === 'yes'} onClick={() => cast('yes')}>
          Vote Yes
        </button>
        <button className={`btn text-[16px] py-3 min-h-[48px] ${mine === 'no' ? 'btn-red' : ''}`} style={mine === 'no' ? undefined : { background: 'rgba(255,69,58,0.16)', color: '#ffb4ae' }} aria-pressed={mine === 'no'} onClick={() => cast('no')}>
          Vote No
        </button>
      </div>
    </div>
  )
}

function ProposeCountry({ game, f, me, orders }: { game: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const { map } = getWorld()
  const [pick, setPick] = useState<NationId | null>(null)
  const ids = useMemo(() => Object.keys(game.nations).filter((id) => game.nations[id].alive && !f.members.includes(id)), [game.nations, f.members])
  const mine = useMemo(() => f.members.reduce((a, m) => a + militaryPower(game, m), 0) + poolPower(game, f), [game, f])
  const items = useMemo(() => nationItems(game, ids, (id) => {
    const why = warTargetProblem(game, map, f, me, id, orders)
    const view = powerView(game, me, id)
    const ratio = mine / Math.max(1, view.value)
    return {
      why,
      note: `${regionsOf(game, id).length} countr${regionsOf(game, id).length === 1 ? 'y' : 'ies'} · ${showPower(view)}`,
      chip: why ? undefined : atWar(game, me, id) ? { text: 'At war', tone: 'bad' as const } : ratio >= 1.5 ? { text: 'Likely', tone: 'good' as const } : ratio >= 0.8 ? { text: 'Even', tone: 'warn' as const } : { text: 'Risky', tone: 'bad' as const },
    }
  }), [game, ids, map, f, me, orders, mine])
  const target = pick ? game.nations[pick] : null
  const cost = pick ? warInfluence(game, me, pick) : 0
  const reason = pick ? game.casusBelli[`${me}|${pick}`] !== undefined && game.casusBelli[`${me}|${pick}`] >= game.turn : false
  const opinion = pick ? opinionOf(game, map, pick, me, { coalition: false }) : 0
  return (
    <section className="rounded-2xl border border-white/14 bg-white/5 p-4 space-y-3" aria-label="Propose a country">
      <div>
        <h3 className="text-[19px] font-semibold tracking-tight">Propose a country</h3>
        <p className="text-[13px] text-white/70">Choose who the faction should go to war with. Members vote; if it passes, every member that can joins and the pooled army attacks as one.</p>
      </div>
      <NationPicker label="Countries to propose" items={items} value={pick} onChange={setPick} placeholder="Search for a country" />
      {target ? (
        <div className="rounded-xl bg-black/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[17px] font-semibold">{target.name}</span>
            <span className={`chip ${reason ? 'chip-green' : 'chip-red'}`}>{reason ? 'You have a reason for war' : 'No reason for war'}</span>
          </div>
          <p className="text-[13px] text-white/75">
            {reason ? `A war with a reason costs you ${cost} influence.` : `Without a reason it costs ${cost} influence, shakes your stability, and the world distrusts the aggressor. A member that has a reason can declare it instead.`} They think of you as <strong>{opinionLabel(opinion)}</strong>.
          </p>
          <OrderButton order={{ type: 'factionPropose', nationId: me, proposal: { kind: 'war', target: target.id } }} label={`Put war on ${target.name} to the vote`} cost={`${cost} influence`} effect="Members vote next month; it is decided when the month ends" tone="btn-primary" className="w-full" onDone={() => setPick(null)} />
        </div>
      ) : (
        <p className="text-[13px] text-white/60">Pick a country from the list. Ones that cannot be proposed say why.</p>
      )}
    </section>
  )
}

function Wars({ game, f }: { game: GameState; f: Faction }) {
  if (f.wars.length === 0) return null
  return (
    <section className="space-y-2" aria-label="Wars">
      <div className="label text-[#ff8a84]">The faction is at war</div>
      {f.wars.map((w) => {
        const t = game.nations[w.target]
        return (
          <div key={w.id} className="rounded-xl border border-[#ff453a]/45 bg-[#ff453a]/8 p-3 text-[14px] space-y-1">
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{t?.name ?? w.target}</span>
              <span className="text-white/70">since {turnDate(w.since)}</span>
            </div>
            <div className="text-white/80">{t ? `${regionsOf(game, w.target).length} countries left` : 'fallen'} · led by {game.nations[w.lead]?.name} · {w.captured.length} taken</div>
            {Object.keys(w.given).length > 0 && <div className="text-[12.5px] text-white/65">Given out: {Object.entries(w.given).map(([m, c]) => `${game.nations[m]?.name} ${c}`).join(', ')}</div>}
          </div>
        )
      })}
    </section>
  )
}

// ---- the pool ----

type Mode = 'in' | 'out'

const stepFor = (r: PoolResource) => (r === 'money' ? 10 : 5)

function Amount({ value, onChange, max, step = 5, label }: { value: number; onChange: (v: number) => void; max: number; step?: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="number" min={0} max={Math.floor(max)} step={step} value={value || ''} placeholder="0" aria-label={label} onChange={(e) => onChange(clamp(Math.round((+e.target.value || 0) * 10) / 10, 0, Math.max(0, Math.floor(max * 10) / 10)))} className="w-[76px] bg-black/40 border border-white/15 rounded-lg px-2 py-1.5 text-right text-[14px] tabular-nums focus:border-[#0a84ff] outline-none" />
      <button type="button" className="btn btn-quiet px-2 py-1 text-[12px]" onClick={() => onChange(Math.floor(max * 10) / 10)} disabled={max < 0.1} title="All of it">
        Max
      </button>
    </div>
  )
}

function PoolTab({ game, f, me, orders }: { game: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const player = game.nations[me]
  const [mode, setMode] = useState<Mode>('in')
  const [stock, setStock] = useState<Partial<Record<PoolResource, number>>>({})
  const [units, setUnits] = useState<Partial<Record<UnitType, number>>>({})
  const gift: FactionGift = {
    stock: Object.fromEntries(Object.entries(stock).filter(([, v]) => (v ?? 0) > 0)),
    units: Object.fromEntries(Object.entries(units).filter(([, v]) => (v ?? 0) > 0)),
  }
  const have = (r: PoolResource) => (mode === 'in' ? player.resources[r === 'money' ? 'capital' : r] : withdrawable(f, me, r))
  const haveU = (k: UnitType) => (mode === 'in' ? player.military.units[k] : withdrawableUnits(f, me, k))
  const unitsShown = UNIT_TYPES.filter((k) => f.pool.units[k] > 0 || player.military.units[k] > 0.05)
  const lock = lockLeft(game, f, me)
  const any = Object.keys(gift.stock ?? {}).length + Object.keys(gift.units ?? {}).length > 0
  const reset = () => {
    setStock({})
    setUnits({})
  }
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-label="Common pool">
        <div className="label">The common pool</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {POOL_RESOURCES.map((r) => (
            <StatTile key={r} label={POOL_NAMES[r]} value={num(f.pool.stock[r])} sub={`yours ${num(f.ledger[me]?.stock[r] ?? 0)}`} />
          ))}
        </div>
        <div className="rounded-xl bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold">Pooled soldiers</span>
            <span className="text-[13px] text-white/70">{num(poolUnits(f), 1)} divisions · strength {num(poolPower(game, f))}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {UNIT_TYPES.filter((k) => f.pool.units[k] > 0.005).map((k) => (
              <span key={k} className="chip" title={`${UNIT_SPECS[k].name}: ${num(f.pool.units[k], 1)} in the pool, ${num(f.ledger[me]?.units[k] ?? 0, 1)} yours`}>
                <UnitIcon unit={k} size={15} /> {UNIT_SPECS[k].name} {num(f.pool.units[k], 1)}
              </span>
            ))}
            {poolUnits(f) < 0.005 && <span className="text-[13px] text-white/60">No soldiers in the pool yet.</span>}
          </div>
          <p className="mt-2 text-[12.5px] text-white/65">The pool pays its army's upkeep, and buys its fuel and food on the market. Pooled soldiers never defend their home country (a nation fighting a war the faction is not in cannot pool soldiers), and fight with the commander's training, weapons and technology.</p>
        </div>
      </section>
      <section className="rounded-2xl border border-white/14 bg-white/5 p-4 space-y-3" aria-label="Put in or take out">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[18px] font-semibold">{mode === 'in' ? 'Put into the pool' : 'Take out of the pool'}</h3>
          <div className="segmented" role="radiogroup" aria-label="Direction">
            {(['in', 'out'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} aria-pressed={mode === m} onClick={() => { setMode(m); reset() }}>
                {m === 'in' ? 'Put in' : 'Take out'}
              </button>
            ))}
          </div>
        </div>
        {mode === 'out' && <p className="text-[13px] text-white/70">{lock > 0 ? `What you put in is locked for ${lock} more month${lock === 1 ? '' : 's'}.` : 'You take back what you put in, in kind, less your share of any losses. Soldiers stay while the faction is at war.'}</p>}
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 items-center">
          {POOL_RESOURCES.map((r) => (
            <div key={r} className="contents">
              <div>
                <div className="text-[14.5px]">{POOL_NAMES[r]}</div>
                <div className="text-[12px] text-white/60">{mode === 'in' ? 'you have' : 'you can take'} {num(have(r), 1)}</div>
              </div>
              <Amount label={`${POOL_NAMES[r]} amount`} value={stock[r] ?? 0} max={have(r)} step={stepFor(r)} onChange={(v) => setStock({ ...stock, [r]: v })} />
            </div>
          ))}
          {unitsShown.map((k) => (
            <div key={k} className="contents">
              <div className="flex items-center gap-2">
                <UnitIcon unit={k} size={18} />
                <div>
                  <div className="text-[14.5px]">{UNIT_SPECS[k].name}</div>
                  <div className="text-[12px] text-white/60">{mode === 'in' ? 'at home' : 'you can take'} {num(haveU(k), 1)}</div>
                </div>
              </div>
              <Amount label={`${UNIT_SPECS[k].name} amount`} value={units[k] ?? 0} max={haveU(k)} step={1} onChange={(v) => setUnits({ ...units, [k]: v })} />
            </div>
          ))}
        </div>
        <OrderButton order={{ type: mode === 'in' ? 'factionContribute' : 'factionWithdraw', nationId: me, gift }} label={mode === 'in' ? 'Put into the pool' : 'Take out of the pool'} effect={any ? 'Moves when the month ends' : 'Choose an amount first'} tone="btn-primary" className="w-full" onDone={reset} />
      </section>
      <Members game={game} f={f} me={me} />
      <InviteBox game={game} f={f} me={me} orders={orders} />
      <section className="flex flex-wrap gap-2 pt-1">
        <OrderButton order={{ type: 'factionLeave', nationId: me }} label={`Leave ${f.name}`} effect={f.charter.exit === 'refund' ? 'You take back your claim, less 10%' : 'You leave everything behind'} tone="btn-red" />
      </section>
    </div>
  )
}

function InviteBox({ game, f, me, orders }: { game: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const focus = useGame((s) => s.factionFocus)
  const [pick, setPick] = useState<NationId | null>(null)
  const [reveal, setReveal] = useState<NationId | null>(null)
  const { map } = getWorld()
  const rows = useMemo(() => inviteCandidates(game, map, me, f, orders), [game, map, me, f, orders])
  const items = useMemo(() => inviteItems(game, rows), [game, rows])
  const box = useRef<HTMLElement>(null)
  // Coming from a country's card in Diplomacy: that country is picked, or its row says why it cannot be.
  const [seen, setSeen] = useState<NationId | null>(null)
  if (!focus && seen) setSeen(null)
  if (focus && focus !== seen) {
    setSeen(focus)
    setReveal(focus)
    if (!items.find((x) => x.id === focus)?.why) setPick(focus)
  }
  useEffect(() => {
    if (!focus) return
    box.current?.scrollIntoView({ block: 'start' })
    useGame.setState({ factionFocus: null })
  }, [focus])
  const partners = rows.filter((r) => r.relations.length > 0).length
  const open = rows.filter((r) => !r.problem).length
  const full = f.members.length >= FACTION.maxMembers
  return (
    <section ref={box} className="space-y-2" aria-label="Invite a nation">
      <div className="label">Invite a nation</div>
      <p className="text-[13px] text-white/70">
        {full ? `${f.name} is full (${f.members.length} of ${FACTION.maxMembers} members), so nobody can be invited. ` : ''}
        {partners > 0 ? 'Your partners from the Diplomacy desk come first. ' : 'Nations you make a pact, alliance, guarantee or trade deal with come first. '}
        {open} of {rows.length} nations can be invited now; the rest say why not.
      </p>
      {f.invites.length > 0 && <p className="text-[13px] text-white/70">Waiting for an answer: {f.invites.map((i) => game.nations[i.nation]?.name).join(', ')}</p>}
      <NationPicker label="Nations to invite" items={items} value={pick} onChange={setPick} reveal={reveal} placeholder="Search for a nation to invite" max={320} />
      {pick && <OrderButton order={{ type: 'factionInvite', nationId: me, target: pick }} label={`Invite ${game.nations[pick].name}`} cost="free" effect={game.humans.includes(pick) || game.nations[pick].isPlayer ? 'A player sees it at once next month' : 'A rival answers when the month ends'} onDone={() => setPick(null)} className="w-full" />}
    </section>
  )
}

// ---- contracts ----

const POOL_STEP: Record<PoolResource, number> = { money: 10, oil: 5, steel: 5, goods: 5, food: 5 }

function PoolContractForm({ game, f, me }: { game: GameState; f: Faction; me: NationId }) {
  const [supply, setSupply] = useState<Partial<Record<PoolResource, number>>>({ oil: 10 })
  const [pay, setPay] = useState<Partial<Record<PoolResource, number>>>({})
  const [months, setMonths] = useState(6)
  const [start, setStart] = useState(0)
  const [collateral, setCollateral] = useState(0)
  const compact = (b: Partial<Record<PoolResource, number>>) => Object.fromEntries(Object.entries(b).filter(([, v]) => (v ?? 0) > 0)) as Partial<Record<PoolResource, number>>
  const terms = { member: me, supply: compact(supply), pay: compact(pay), months, start, collateral }
  const cap = FACTION.maxContractAmount
  return (
    <div className="space-y-3 rounded-xl bg-black/30 p-3">
      <p className="text-[13px] text-white/75">You send the pool resources every month, and the pool may pay you for them. With nothing paid back they count as your contribution. The members vote on it.</p>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-1.5 items-center text-[13.5px]">
        <span className="label">Resource</span>
        <span className="label text-right">You send</span>
        <span className="label text-right">Pool pays</span>
        {POOL_RESOURCES.map((r) => (
          <div key={r} className="contents">
            <span>{POOL_NAMES[r]}</span>
            <input type="number" min={0} max={cap} step={POOL_STEP[r]} aria-label={`${POOL_NAMES[r]} you send`} value={supply[r] || ''} placeholder="0" onChange={(e) => setSupply({ ...supply, [r]: clamp(Math.round(+e.target.value || 0), 0, cap) })} className="w-[72px] bg-black/40 border border-white/15 rounded-lg px-2 py-1 text-right tabular-nums focus:border-[#0a84ff] outline-none" />
            <input type="number" min={0} max={cap} step={POOL_STEP[r]} aria-label={`${POOL_NAMES[r]} the pool pays`} value={pay[r] || ''} placeholder="0" onChange={(e) => setPay({ ...pay, [r]: clamp(Math.round(+e.target.value || 0), 0, cap) })} className="w-[72px] bg-black/40 border border-white/15 rounded-lg px-2 py-1 text-right tabular-nums focus:border-[#0a84ff] outline-none" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[13px]">
        <label className="space-y-1">
          <span className="label block">Months</span>
          <select className="field w-full px-2 py-1.5" value={months} onChange={(e) => setMonths(+e.target.value)}>
            {[1, 3, 6, 9, FACTION.maxContractMonths].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label block">Starts in</span>
          <select className="field w-full px-2 py-1.5" value={start} onChange={(e) => setStart(+e.target.value)}>
            {[0, 1, 2, 3, FACTION.maxStartMonths].map((m) => <option key={m} value={m}>{m === 0 ? 'Now' : `${m} months`}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label block">Collateral</span>
          <input type="number" min={0} max={FACTION.maxCollateral} step={25} value={collateral || ''} placeholder="0" onChange={(e) => setCollateral(clamp(Math.round(+e.target.value || 0), 0, FACTION.maxCollateral))} className="field w-full px-2 py-1.5 text-right tabular-nums" />
        </label>
      </div>
      <OrderButton order={{ type: 'factionPropose', nationId: me, proposal: { kind: 'contract', terms } }} label="Put the contract to the vote" cost={`${FACTION.contractInfluence} influence`} effect="Members vote; it starts when it passes" tone="btn-primary" className="w-full" />
      <p className="sr-only">{game.turn} {f.id}</p>
    </div>
  )
}

const ZERO: Record<TradeResource, number> = { capital: 0, food: 0, tp: 0, manpower: 0, oil: 0, steel: 0, goods: 0 }
const CONTRACT_RESOURCES: TradeResource[] = ['capital', 'oil', 'steel', 'goods', 'food']
const RES_NAME: Record<TradeResource, string> = { capital: 'Money', food: 'Food', tp: 'Research', manpower: 'Soldiers', oil: 'Oil', steel: 'Steel', goods: 'Goods' }

function NationContractForm({ game, f, me, orders }: { game: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const { map } = getWorld()
  const [partner, setPartner] = useState<NationId | null>(null)
  const [give, setGive] = useState(ZERO)
  const [receive, setReceive] = useState(ZERO)
  const [months, setMonths] = useState(6)
  const [start, setStart] = useState(0)
  const [collateral, setCollateral] = useState(0)
  const [joinWars, setJoinWars] = useState(false)
  const ids = useMemo(() => Object.keys(game.nations).filter((id) => game.nations[id].alive && id !== me), [game, me])
  const items = useMemo(
    () =>
      nationItems(game, ids, (id) => ({
        why: atWar(game, me, id) ? 'At war with you' : null,
        chip: f.members.includes(id) ? { text: 'Member', tone: 'good' as const } : undefined,
        note: opinionLabel(opinionOf(game, map, id, me, { coalition: false })),
      })).sort((a, b) => Number(f.members.includes(b.id)) - Number(f.members.includes(a.id))),
    [game, ids, map, f, me],
  )
  const bundle = (b: Record<TradeResource, number>): ResourceBundle => {
    const out: ResourceBundle = {}
    for (const r of TRADE_RESOURCES) if (b[r] > 0) out[r] = b[r]
    return out
  }
  const terms = { give: bundle(give), receive: bundle(receive), months, ...(start > 0 ? { start } : {}), ...(collateral > 0 ? { collateral } : {}), ...(joinWars ? { joinWars: true } : {}) }
  const edit = (set: (b: Record<TradeResource, number>) => void, b: Record<TradeResource, number>, r: TradeResource) => (e: React.ChangeEvent<HTMLInputElement>) => set({ ...b, [r]: clamp(Math.round(+e.target.value || 0), 0, TRADE_LIMITS.maxAmount) })
  return (
    <div className="space-y-3 rounded-xl bg-black/30 p-3">
      <p className="text-[13px] text-white/75">A standing contract with any nation. It pays out every month on its own, can start later, can hold your collateral, and can bind them to join your wars. Breaking it costs the breaker their reputation and gives the other side a reason for war.</p>
      <NationPicker label="Contract partner" items={items} value={partner} onChange={setPartner} placeholder="Search for a partner" max={200} />
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-1.5 items-center text-[13.5px]">
        <span className="label">Resource</span>
        <span className="label text-right">You send</span>
        <span className="label text-right">You get</span>
        {CONTRACT_RESOURCES.map((r) => (
          <div key={r} className="contents">
            <span>{RES_NAME[r]}</span>
            <input type="number" min={0} step={5} aria-label={`${RES_NAME[r]} you send each month`} value={give[r] || ''} placeholder="0" onChange={edit(setGive, give, r)} className="w-[72px] bg-black/40 border border-white/15 rounded-lg px-2 py-1 text-right tabular-nums focus:border-[#0a84ff] outline-none" />
            <input type="number" min={0} step={5} aria-label={`${RES_NAME[r]} you get each month`} value={receive[r] || ''} placeholder="0" onChange={edit(setReceive, receive, r)} className="w-[72px] bg-black/40 border border-white/15 rounded-lg px-2 py-1 text-right tabular-nums focus:border-[#0a84ff] outline-none" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[13px]">
        <label className="space-y-1">
          <span className="label block">Months</span>
          <select className="field w-full px-2 py-1.5" value={months} onChange={(e) => setMonths(+e.target.value)}>
            {[1, 3, 6, 9, TRADE_LIMITS.maxMonths].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label block">Starts in</span>
          <select className="field w-full px-2 py-1.5" value={start} onChange={(e) => setStart(+e.target.value)}>
            {[0, 1, 2, 3, TRADE_LIMITS.maxStart].map((m) => <option key={m} value={m}>{m === 0 ? 'Now' : `${m} months`}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label block">Your collateral</span>
          <input type="number" min={0} max={TRADE_LIMITS.maxCollateral} step={25} value={collateral || ''} placeholder="0" onChange={(e) => setCollateral(clamp(Math.round(+e.target.value || 0), 0, TRADE_LIMITS.maxCollateral))} className="field w-full px-2 py-1.5 text-right tabular-nums" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={joinWars} onChange={(e) => setJoinWars(e.target.checked)} className="w-4 h-4" />
        <span>They join every war I fight</span>
      </label>
      {partner ? (
        <OrderButton order={{ type: 'propose', nationId: me, target: partner, proposal: { kind: 'trade', terms } }} label={`Offer the contract to ${game.nations[partner].name}`} cost={`${PROPOSAL_COSTS.trade} influence`} effect={game.humans.includes(partner) ? 'They see it when the next month begins' : 'They answer when the month ends'} tone="btn-primary" className="w-full" />
      ) : (
        <p className="text-[13px] text-white/60">Choose a partner first.</p>
      )}
      <p className="sr-only">{orders.length}</p>
    </div>
  )
}

function dealLine(game: GameState, d: Deal): string {
  const c = d.contract
  const parts = [d.give && Object.keys(d.give).length ? `${game.nations[d.from]?.name} sends ${describeBundle(d.give)}` : '', d.receive && Object.keys(d.receive).length ? `${game.nations[d.to]?.name} sends ${describeBundle(d.receive)}` : '', c?.joins ? `${game.nations[c.joins]?.name} joins ${game.nations[c.joins === d.from ? d.to : d.from]?.name}'s wars` : ''].filter(Boolean)
  return parts.join('; ') || 'Standing deal'
}

function ContractsTab({ game, f, me, orders }: { game: GameState; f: Faction; me: NationId; orders: Order[] }) {
  const mine = game.deals.filter((d) => d.from === me || d.to === me || (f.members.includes(d.from) && f.members.includes(d.to)))
  const [open, setOpen] = useState<'none' | 'pool' | 'nation'>('none')
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-label="Contracts with the pool">
        <div className="flex items-center justify-between gap-2">
          <div className="label">Contracts with the pool</div>
          <button className="btn px-3 py-1.5 text-[13px]" aria-expanded={open === 'pool'} onClick={() => setOpen(open === 'pool' ? 'none' : 'pool')}>{open === 'pool' ? 'Close' : 'New supply contract'}</button>
        </div>
        {open === 'pool' && <PoolContractForm game={game} f={f} me={me} />}
        {f.contracts.length === 0 && <p className="text-[13.5px] text-white/65">No contracts with the pool. A member can promise oil, steel or money every month, and be paid for it.</p>}
        {f.contracts.map((c) => (
          <div key={c.id} className="rounded-xl border border-white/12 bg-white/5 p-3 text-[14px]">
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{game.nations[c.member]?.name}</span>
              <span className="text-white/65 tabular-nums">{game.turn < c.from ? `starts ${turnDate(c.from)}` : `${c.until - game.turn + 1} months left`}</span>
            </div>
            <div className="text-white/80 mt-0.5">{describeContract(c, game.nations[c.member]?.name)}.</div>
          </div>
        ))}
      </section>
      <section className="space-y-2" aria-label="Contracts between nations">
        <div className="flex items-center justify-between gap-2">
          <div className="label">Contracts between nations</div>
          <button className="btn px-3 py-1.5 text-[13px]" aria-expanded={open === 'nation'} onClick={() => setOpen(open === 'nation' ? 'none' : 'nation')}>{open === 'nation' ? 'Close' : 'New contract'}</button>
        </div>
        {open === 'nation' && <NationContractForm game={game} f={f} me={me} orders={orders} />}
        {mine.length === 0 && <p className="text-[13.5px] text-white/65">No standing contracts yet.</p>}
        {mine.map((d) => {
          const other = d.from === me ? d.to : d.from
          const canCancel = d.from === me || d.to === me
          return (
            <div key={d.id} className="rounded-xl border border-white/12 bg-white/5 p-3 text-[14px] space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{d.from === me || d.to === me ? game.nations[other]?.name : `${game.nations[d.from]?.name} and ${game.nations[d.to]?.name}`}</span>
                <span className="text-white/65 tabular-nums">{d.contract && game.turn < d.contract.start ? `starts ${turnDate(d.contract.start)}` : `${Math.max(0, d.until - game.turn + 1)} months left`}</span>
              </div>
              <div className="text-white/80">{dealLine(game, d)}.</div>
              {d.contract && d.contract.held > 0 && <div className="text-[12.5px] text-[#ffd60a]">{game.nations[d.contract.poster]?.name} holds {Math.round(d.contract.held)} money in collateral.</div>}
              {canCancel && d.kind !== 'reparations' && <OrderButton order={{ type: 'cancelDeal', nationId: me, dealId: d.id }} label="Cancel" tone="btn-quiet" effect={d.contract ? 'Walking away from a running contract costs the collateral' : 'They will remember it'} />}
            </div>
          )
        })}
      </section>
    </div>
  )
}

// ---- the log ----

function LogTab({ game, f }: { game: GameState; f: Faction }) {
  const lines = [...f.history].reverse()
  return (
    <div className="space-y-5">
      <Wars game={game} f={f} />
      <section className="space-y-1.5" aria-label="War log">
        <div className="label">What the faction has done</div>
        {lines.length === 0 && <p className="text-[13.5px] text-white/65">Nothing yet.</p>}
        {lines.map((h, i) => (
          <p key={i} className="text-[13.5px] border-l-2 border-white/15 pl-2.5 py-0.5">
            <span className="text-white/55 tabular-nums mr-1.5">{turnDate(h.turn)}</span>
            {h.text}
          </p>
        ))}
      </section>
    </div>
  )
}

// ---- no faction yet ----

function Found({ game, me }: { game: GameState; me: NationId }) {
  const [name, setName] = useState('')
  const [charter, setCharter] = useState<FactionCharter>({ vote: 'majority', spoils: 'share', exit: 'refund' })
  const focus = useGame((st) => st.factionFocus)
  const others = game.factions ?? []
  const choice = <K extends keyof FactionCharter>(key: K, label: string) => (
    <div className="space-y-1">
      <div className="label">{label}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" role="radiogroup" aria-label={label}>
        {(Object.keys(CHARTER_TEXT[key]) as FactionCharter[K][]).map((v) => (
          <button key={v} role="radio" aria-checked={charter[key] === v} className={`btn px-3 py-2 text-[13.5px] text-left min-h-[40px] ${charter[key] === v ? 'btn-primary' : ''}`} onClick={() => setCharter({ ...charter, [key]: v })}>
            {(CHARTER_TEXT[key] as Record<string, string>)[v as string]}
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/14 bg-white/5 p-4 space-y-3">
        {focus && game.nations[focus] && <p className="rounded-lg bg-[#0a84ff]/12 border border-[#0a84ff]/40 px-3 py-2 text-[13px] text-white/85">You came from {game.nations[focus].name}. Found the faction now; when it exists, {game.nations[focus].name} is already picked in the invitation list on the Pool and members tab.</p>}
        <h3 className="text-[20px] font-semibold tracking-tight">Pool your strength with friends</h3>
        <p className="text-[14px] text-white/80">A faction works like a company owned by countries. Members put in money, oil, steel, goods, food and soldiers; the pool grows into a shared army and treasury. Your share of it follows what you put in. The members vote together to go to war with a country, and the pooled army attacks as one. Conquered land is split by share.</p>
        <label className="block space-y-1">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={FACTION.nameMax} placeholder="The Iron Pact" aria-label="Faction name" className="field w-full px-3 py-2 text-[15px]" />
        </label>
        {choice('vote', 'How votes count')}
        {choice('spoils', 'Conquered land')}
        {choice('exit', 'Leaving')}
        <OrderButton order={{ type: 'factionFound', nationId: me, name, charter }} label="Found the faction" cost={`${FACTION.foundInfluence} influence`} effect="It exists when the month ends; then invite others" tone="btn-primary" className="w-full" />
      </section>
      <FactionNotices game={game} me={me} />
      {others.length > 0 && (
        <section className="space-y-2" aria-label="Factions in the world">
          <div className="label">Factions in the world</div>
          {others.map((g) => (
            <div key={g.id} className="rounded-xl border border-white/12 bg-white/5 p-3 text-[14px]">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{g.name}</span>
                <span className="text-white/65">{g.members.length} members · pool {num(poolValue(g))}</span>
              </div>
              <div className="text-white/75">{g.members.map((m) => game.nations[m]?.name).join(', ')}{g.wars.length ? ` · at war with ${g.wars.map((w) => game.nations[w.target]?.name).join(', ')}` : ''}</div>
              <div className="text-[12.5px] text-white/60 mt-0.5">{CHARTER_TEXT.vote[g.charter.vote]} · {CHARTER_TEXT.spoils[g.charter.spoils]} · {CHARTER_TEXT.exit[g.charter.exit]}</div>
              <div className="mt-2">
                <OrderButton order={{ type: 'factionRequest', nationId: me, factionId: g.id }} label={`Ask to join ${g.name}`} cost={`${FACTION.requestInfluence} influence`} effect={g.members.some((m) => game.humans.includes(m) || game.nations[m]?.isPlayer) ? 'A member who is a player decides' : 'Its members answer when the month ends'} />
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

export function FactionPanel() {
  const view = usePlayerView()
  const [tab, setTab] = useState<FactionTab>('council')
  const focus = useGame((s) => s.factionFocus)
  const hasFaction = !!view && !!factionOf(view.game, view.game.playerId)
  // Coming from a country's card in Diplomacy, the invitation list is the one to show.
  const [seenFocus, setSeenFocus] = useState<NationId | null>(null)
  if (!focus && seenFocus) setSeenFocus(null)
  if (focus && hasFaction && focus !== seenFocus) {
    setSeenFocus(focus)
    setTab('pool')
  }
  if (!view) return null
  const { game, orders } = view
  const me = game.playerId
  const f = factionOf(game, me)
  const open = f ? f.proposals.filter((p) => !p.votes[me] || orders.some((o) => o.type === 'factionVote' && o.proposalId === p.id)).length : 0
  return (
    <PanelShell
      title="Faction"
      kicker={f ? `${f.name} · ${f.members.length} members · ${f.proposals.length} vote${f.proposals.length === 1 ? '' : 's'} open · ${f.wars.length} war${f.wars.length === 1 ? '' : 's'}` : 'Pool money, materials and soldiers with other countries and vote on war together.'}
      panel="faction"
      tabs={f ? <Tabs<FactionTab> value={tab} onChange={setTab} options={[['council', open > 0 ? `Council (${open})` : 'Council'], ['pool', 'Pool and members'], ['contracts', 'Contracts'], ['log', 'War log']] as const} /> : undefined}
    >
      {!f && <Found game={game} me={me} />}
      {f && tab === 'council' && (
        <div className="space-y-5">
          <FactionCard game={game} f={f} me={me} />
          <FactionNotices game={game} me={me} />
          {f.proposals.length > 0 && (
            <section className="space-y-3" aria-label="Votes">
              <div className="label text-[#ffd60a]">Votes</div>
              {f.proposals.map((p) => (
                <VoteCard key={p.id} game={game} f={f} p={p} me={me} orders={orders} />
              ))}
            </section>
          )}
          <ProposeCountry game={game} f={f} me={me} orders={orders} />
          <Wars game={game} f={f} />
        </div>
      )}
      {f && tab === 'pool' && <PoolTab game={game} f={f} me={me} orders={orders} />}
      {f && tab === 'contracts' && <ContractsTab game={game} f={f} me={me} orders={orders} />}
      {f && tab === 'log' && <LogTab game={game} f={f} />}
    </PanelShell>
  )
}
