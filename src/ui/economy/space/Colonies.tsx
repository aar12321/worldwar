import { useState } from 'react'
import { BODIES, BODY_IDS, MINES, MINE_LEVELS, OUTPOST, SPACE, type BodyId, type MineId } from '../../../data/space'
import { mineCostFor, mineMonthsFor, mineOutput, outpostCostFor } from '../../../engine/spaceEffects'
import { spaceWorld } from '../../../engine/space'
import { Pips } from '../../bits'
import { Bar, StatTile, Tiles } from '../../kit'
import { OrderButton } from '../../panel'
import { usePlayerView } from '../../hooks'
import { Card } from '../parts'
import { Chip, Search } from './shared'
import { money, spaceOrder } from './words'

/** Worlds beyond Earth: who has claimed them, what you have built there, and what the mines bring home. */
export function ColoniesSection() {
  const view = usePlayerView()!
  const { player, game, econ } = view
  const world = spaceWorld(game)
  const sp = player.space
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const y = econ.space
  const list = BODY_IDS.filter((id) => !query || `${BODIES[id].name} ${BODIES[id].blurb}`.toLowerCase().includes(query))
  const claimed = Object.entries(world.claims)
  return (
    <>
      <Tiles>
        <StatTile label="Mines bring in" value={y.income > 0 ? `+${money(y.income)}` : '0'} sub="money a month" />
        <StatTile label="Steel and oil" value={`${money(econ.steelProduction)} / ${money(econ.oilProduction)}`} sub="all sources, a month" />
        <StatTile label="Bases" value={BODY_IDS.filter((b) => sp?.bodies[b]?.outpost).length} sub="outposts, stations, colonies" />
      </Tiles>
      <div className="span-all">
      <Card title="Taking a world" hint="It is hard on purpose. Fly a survey probe, then land, then claim it (a claim costs influence and shuts out everyone else), then send the cargo that founds an outpost. Rivals are racing for the same worlds.">
        {claimed.length === 0 ? (
          <p className="text-[13px] text-white/65">Nobody has claimed anything yet.</p>
        ) : (
          <ul className="space-y-1">
            {claimed.map(([body, c]) => (
              <li key={body} className="text-[13px] flex justify-between gap-2">
                <span className="font-semibold">{BODIES[body as BodyId].name}</span>
                <span className={c!.owner === player.id ? 'text-[#6eeb8a]' : 'text-[#ffd60a]'}>
                  {c!.owner === player.id ? 'Yours' : (game.nations[c!.owner]?.name ?? c!.owner)} · since month {c!.turn}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </div>
      <div className="span-all">
        <Search value={q} onChange={setQ} label="Search worlds" />
      </div>
      {list.map((id) => (
        <BodyCard key={id} id={id} />
      ))}
    </>
  )
}

function BodyCard({ id }: { id: BodyId }) {
  const { player, game } = usePlayerView()!
  const body = BODIES[id]
  const sp = player.space
  const st = sp?.bodies[id]
  const claim = game.space?.claims[id]
  const mine = claim?.owner === player.id
  const op = st?.outpost
  const nextL = (op?.level ?? 0) + 1
  return (
    <div className={`inset-card p-3.5 space-y-2.5 span-all ${mine ? 'ring-1 ring-[#30d158]/30' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold tracking-tight">{body.name}</h3>
          <p className="text-[13px] text-white/70">{body.blurb}</p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {op ? <Pips value={op.level} max={OUTPOST.max} /> : null}
          <span className="text-[12px] text-white/60">{op ? OUTPOST.names[op.level] : 'No base'}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip tone={st?.surveyed ? 'good' : undefined}>{st?.surveyed ? 'surveyed' : 'not surveyed'}</Chip>
        <Chip tone={st?.landed ? 'good' : undefined}>{st?.landed ? 'landed' : 'not landed'}</Chip>
        <Chip tone={mine ? 'good' : claim ? 'warn' : undefined}>{claim ? (mine ? 'claimed by you' : `claimed by ${game.nations[claim.owner]?.name ?? claim.owner}`) : 'unclaimed'}</Chip>
        <Chip>distance ×{body.distance}</Chip>
        <Chip>ground ×{body.richness}</Chip>
      </div>
      {!claim && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-white/65">{st?.landed ? 'You have landed. Claim it before a rival does.' : 'Fly a landing mission first (Missions).'}</span>
          <OrderButton order={spaceOrder(player, { kind: 'claim', body: id })} label="Claim" cost={`${SPACE.claimCost} influence`} tone="btn-primary" />
        </div>
      )}
      {mine && !op && <p className="text-[13px] text-[#ffd60a]">Claimed. Fly the outpost cargo mission to found a base (Missions, {body.name}).</p>}
      {mine && op && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] text-white/75">
              {OUTPOST.names[op.level]}: research +{(body.research * op.level).toFixed(1)} a month
              {op.unsupplied > 0 ? <span className="text-[#ff8a84]"> · short of supplies ({op.unsupplied} months)</span> : ''}
            </div>
            <OrderButton
              order={spaceOrder(player, { kind: 'outpost', body: id })}
              label={op.building ? 'Being built' : op.level >= OUTPOST.max ? 'A colony' : `Raise to ${OUTPOST.names[nextL].toLowerCase()}`}
              cost={op.level < OUTPOST.max ? `${outpostCostFor(id, nextL, sp)} over ${OUTPOST.months[nextL]} mo` : undefined}
            />
          </div>
          {op.building && <Bar value={op.building.progress / OUTPOST.months[nextL]} label="Outpost progress" color="#30d158" />}
          <div className="space-y-2">
            <div className="text-[13px] font-semibold">Mines · {Object.values(op.mines).filter((m) => m && m.level > 0).length} of {op.level} places</div>
            {body.mines.map((m) => (
              <MineRow key={m} body={id} mine={m} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function MineRow({ body, mine }: { body: BodyId; mine: MineId }) {
  const { player } = usePlayerView()!
  const sp = player.space
  const spec = MINES[mine]
  const have = sp?.bodies[body]?.outpost?.mines[mine]
  const level = have?.level ?? 0
  const nextL = Math.min(MINE_LEVELS.max, level + 1)
  const out = mineOutput(body, mine, Math.max(1, level), sp)
  const next = mineOutput(body, mine, nextL, sp)
  const text = (o: typeof out) => [o.steel > 0 && `${o.steel.toFixed(1)} steel`, o.oil > 0 && `${o.oil.toFixed(1)} oil`, o.money > 0 && `${o.money.toFixed(1)} money`, o.he3 > 0 && `${o.he3.toFixed(1)} helium-3`, o.water > 0 && `upkeep ${Math.round(o.water * 100)}% less`].filter(Boolean).join(', ')
  return (
    <div className="rounded-xl bg-white/5 p-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">{spec.name}</div>
          <div className="text-[12px] text-white/65">{spec.blurb}</div>
        </div>
        <Pips value={level} max={MINE_LEVELS.max} />
      </div>
      <div className="text-[12px] text-white/75">
        {level > 0 ? `Makes ${text(out)} a month.` : `Level 1 would make ${text(out)} a month.`}
        {level > 0 && level < MINE_LEVELS.max ? ` Level ${nextL}: ${text(next)}.` : ''}
      </div>
      {have?.building && <Bar value={have.building.progress / mineMonthsFor(mine, level + 1)} label={`${spec.name} progress`} color="#ff9f0a" />}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-white/60">
          {have?.building ? `${Math.max(0, mineMonthsFor(mine, level + 1) - have.building.progress).toFixed(0)} months left` : `Needs ${spec.exp} experience and the discovery of in-situ resource use`}
        </span>
        <OrderButton order={spaceOrder(player, { kind: 'mine', body, mine })} label={level === 0 ? 'Build' : level >= MINE_LEVELS.max ? 'Full' : `Level ${nextL}`} cost={level < MINE_LEVELS.max ? `${mineCostFor(body, mine, nextL)} over ${mineMonthsFor(mine, nextL)} mo` : undefined} tone={level === 0 ? 'btn-primary' : ''} />
      </div>
    </div>
  )
}
