import { useMemo, useState } from 'react'
import { BODIES, MISSIONS, MISSION_IDS, ROCKETS, SAMPLE_NAMES, SAT_NAMES, type MissionId, type SampleKind } from '../../../data/space'
import { daysInMonth } from '../../../engine/calendar'
import { companiesFor, missionProgress, quote, type CompanyView, type Quote } from '../../../engine/space'
import { Bar } from '../../kit'
import { OrderButton } from '../../panel'
import { usePlayerView } from '../../hooks'
import { Card } from '../parts'
import { Chip, Search } from './shared'
import { monthsText, money, percent, spaceOrder } from './words'

const PHASE_NAMES = { build: 'Building', launch: 'Launching', transit: 'In flight', arrival: 'At the target' } as const

/** The launch pad: flights under way, the companies you can hire, and every mission on the ladder, in-house or outsourced side by side. */
export function MissionsSection() {
  const view = usePlayerView()!
  const { player, game, econ } = view
  const [q, setQ] = useState('')
  const companies = companiesFor(game, player)
  const open = companies.filter((c) => c.open)
  const best = [...open].sort((a, b) => b.reliability / b.price - a.reliability / a.price)[0]
  const [chosen, setChosen] = useState<string>('')
  const company = open.find((c) => c.id === chosen) ?? best
  const sp = player.space
  const query = q.trim().toLowerCase()
  const groups = useMemo(() => {
    const out: Record<string, MissionId[]> = {}
    for (const id of MISSION_IDS) {
      const m = MISSIONS[id]
      if (query && !`${m.name} ${m.blurb} ${m.group} ${m.body ?? ''}`.toLowerCase().includes(query)) continue
      ;(out[m.group] ??= []).push(id)
    }
    return out
  }, [query])
  return (
    <>
      {(sp?.missions.length ?? 0) > 0 && (
        <Card title="Flights under way" hint="Each flight builds, launches, travels and arrives. A seeded roll decides the launch and the arrival.">
          <ul className="space-y-3">
            {sp!.missions.map((m) => {
              const spec = MISSIONS[m.kind]
              const left = m.left
              return (
                <li key={m.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[14px]">
                    <span className="font-semibold">{spec.name}</span>
                    <span className="text-[12px] text-white/70">
                      {PHASE_NAMES[m.phase]} · {monthsText(Math.max(0, left))} left
                    </span>
                  </div>
                  <Bar value={missionProgress(game, m, daysInMonth(game.turn))} label={`${spec.name} progress`} color="#0a84ff" />
                  <div className="flex flex-wrap gap-1.5">
                    <Chip>{m.mode === 'house' ? 'in-house' : `by ${m.by ?? 'a company'}`}</Chip>
                    <Chip>launch {percent(m.odds[0])}</Chip>
                    <Chip>arrival {percent(m.odds[1])}</Chip>
                    {m.crew > 0 && <Chip tone="warn">{m.crew} crew</Chip>}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <Card title="Private launch companies" hint="They fly your payload for a fixed price. Their record and prices improve as the world's space industry grows. They build no experience for you, and you have no say in how careful they are.">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-white/55">
                <th className="font-medium pb-1 pr-2">Company</th>
                <th className="font-medium pb-1 pr-2">Price</th>
                <th className="font-medium pb-1 pr-2">Launch odds</th>
                <th className="font-medium pb-1">Flies up to</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <CompanyRow key={c.id} c={c} picked={c.id === company?.id} onPick={() => setChosen(c.id)} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-white/60">
          Money paid to a company lifts the technology business of the nation it is based in. A firm of your own (a technology sector of 1.2 or more) keeps a quarter of it at home.
        </p>
      </Card>

      <div className="span-all">
        <Search value={q} onChange={setQ} label="Search missions" />
      </div>
      {Object.entries(groups).map(([group, ids]) => (
        <div key={group} className="span-all space-y-2">
          <h2 className="text-[15px] font-semibold tracking-tight pt-1">{group}</h2>
          <div className="space-y-2">
            {ids.map((id) => (
              <MissionCard key={id} id={id} company={company?.id} workforce={econ.workforce} />
            ))}
          </div>
        </div>
      ))}
      {Object.keys(groups).length === 0 && <p className="span-all text-[13px] text-white/60">No mission matches.</p>}
    </>
  )
}

function CompanyRow({ c, picked, onPick }: { c: CompanyView; picked: boolean; onPick: () => void }) {
  const upTo = Object.values(ROCKETS).find((r) => r.rank === c.ceiling)?.name ?? '-'
  return (
    <tr className={`${picked ? 'bg-[#0a84ff]/20' : ''} ${c.open ? '' : 'opacity-50'}`}>
      <td className="py-1 pr-2">
        <button className="text-left font-semibold underline-offset-2 hover:underline" onClick={onPick} disabled={!c.open} aria-pressed={picked}>
          {c.name}
        </button>
        {c.domestic && <span className="ml-1.5 text-[11px] text-[#6eeb8a]">yours</span>}
        {!c.open && <span className="ml-1.5 text-[11px] text-white/60">not yet</span>}
      </td>
      <td className="py-1 pr-2 tabular-nums">×{c.price.toFixed(2)}</td>
      <td className="py-1 pr-2 tabular-nums">{percent(c.reliability)}</td>
      <td className="py-1">{upTo.toLowerCase()}</td>
    </tr>
  )
}

function Odds({ q }: { q: Quote }) {
  const tone = q.odds.total >= 0.7 ? 'good' : q.odds.total >= 0.5 ? 'warn' : 'bad'
  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip tone={tone}>success {percent(q.odds.total)}</Chip>
      <Chip>launch {percent(q.odds.launch)}</Chip>
      <Chip>arrival {percent(q.odds.arrival)}</Chip>
    </div>
  )
}

function MissionCard({ id, company, workforce }: { id: MissionId; company: string | undefined; workforce: number }) {
  const { player, game } = usePlayerView()!
  const spec = MISSIONS[id]
  const sp = player.space
  const done = sp?.done[id] ?? 0
  const flying = sp?.missions.find((m) => m.kind === id)
  const house = quote(game, player, id, 'house', undefined, workforce)
  const out = quote(game, player, id, 'outsource', company, workforce)
  const body = spec.body ? BODIES[spec.body] : null
  const gives: string[] = []
  if (spec.sat) gives.push(`a ${SAT_NAMES[spec.sat].toLowerCase()} satellite`)
  for (const [k, v] of Object.entries(spec.samples ?? {})) gives.push(`${v} ${SAMPLE_NAMES[k as SampleKind].toLowerCase()}`)
  if (body && spec.stage === 'survey') gives.push(`a survey of ${body.name}`)
  if (body && spec.stage === 'landing') gives.push(`a landing on ${body.name} (needed to claim it)`)
  if (body && spec.stage === 'outpost') gives.push(`the first level of an outpost on ${body.name}`)
  if (spec.tp) gives.push(`${spec.tp} research`)
  gives.push(`prestige +${spec.prestige}`)
  const months = (m: Quote['months']) => `${m[0]} build · ${m[1]} launch${m[2] ? ` · ${m[2]} travel` : ''}${m[3] ? ` · ${m[3]} on site` : ''}`
  return (
    <div className={`inset-card p-3.5 space-y-2 ${done > 0 ? 'ring-1 ring-[#30d158]/25' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{spec.name}</h3>
          <p className="text-[13px] text-white/70">{spec.blurb}</p>
        </div>
        <div className="shrink-0 text-right text-[12px] text-white/65">{done > 0 ? <span className="text-[#6eeb8a]">flown {done}×</span> : 'not flown'}</div>
      </div>
      <p className="text-[12px] text-white/65">
        Gives: {gives.join(', ')}. Needs a {ROCKETS[spec.rocket].name.toLowerCase()}
        {spec.crew ? ` and ${spec.crew} astronauts` : ''}.
      </p>
      {flying ? (
        <p className="text-[13px] text-[#ffd60a]">Under way: {PHASE_NAMES[flying.phase].toLowerCase()}, {monthsText(flying.left)} left in this stage.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="rounded-xl bg-white/5 p-2.5 space-y-1.5">
            <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] font-semibold">In-house</span><span className="text-[15px] font-semibold tabular-nums">{money(house.payload + house.rocketCost)} money</span></div>
            <div className="text-[12px] text-white/70">
              Payload {money(house.payload)} over the build, plus a rocket ({house.rocketCost.toFixed(0)}, taken from your hangar)
            </div>
            <div className="text-[12px] text-white/70">{months(house.months)} · {monthsText(house.total)}</div>
            <div className="text-[12px] text-white/70">
              Needs {spec.engineers} engineers · {spec.exp} experience (you have {Math.floor(sp?.exp ?? 0)}). Builds {spec.gain} experience.
            </div>
            <Odds q={house} />
            <OrderButton order={spaceOrder(player, { kind: 'launch', mission: id, mode: 'house' })} label="Fly it ourselves" cost={`${money(house.monthly)}/mo`} tone="btn-primary" />
          </div>
          <div className="rounded-xl bg-white/5 p-2.5 space-y-1.5">
            <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] font-semibold">Hire a company</span><span className="text-[15px] font-semibold tabular-nums">{money(out.price)} money</span></div>
            <div className="text-[12px] text-white/70">
              {money(out.price)} up front ({(out.price / Math.max(1, house.payload + house.rocketCost)).toFixed(1)}× the in-house cost). The rocket is theirs.
            </div>
            <div className="text-[12px] text-white/70">{months(out.months)} · {monthsText(out.total)}</div>
            <div className="text-[12px] text-white/70">No experience gained, and none needed.</div>
            <Odds q={out} />
            <OrderButton order={spaceOrder(player, { kind: 'launch', mission: id, mode: 'outsource', company })} label="Outsource" cost={`${money(out.price)}`} />
          </div>
        </div>
      )}
    </div>
  )
}
