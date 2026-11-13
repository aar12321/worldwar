import { useMemo } from 'react'
import { AGENCY, AGENCY_ROLE, DOMESTIC_OPS, FOREIGN_OPS, agencyName, levelsCost, type AgencyId, type DomesticOp, type ForeignOp } from '../data/agencies'
import { operationOdds } from '../engine/agencies'
import { atWar } from '../engine/helpers'
import { militaryPower } from '../engine/militaryStats'
import { getWorld } from '../map/world'
import { nationNeighbors } from '../ai/opinion'
import { useGame } from '../store'
import { fmt, usePlayerView } from './hooks'
import { OrderButton } from './panel'

const FOREIGN_ORDER: ForeignOp[] = ['intel', 'case', 'sabotage', 'rebels', 'aid', 'steal', 'coup', 'cyber']
const DOMESTIC_ORDER: DomesticOp[] = ['counter', 'calm', 'crackdown', 'corruption']

function AgencyCard({ id }: { id: AgencyId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const a = player.agencies[id]
  const used = view.orders.filter((o) => (id === 'foreign' ? o.type === 'operation' : o.type === 'domestic')).length
  void game
  return (
    <div className="inset-card p-3.5 space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[17px] font-semibold tracking-tight">{agencyName(player.name, id)}</div>
          <p className="text-[13px] text-white/70 max-w-prose">{AGENCY_ROLE[id]}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="label">Level</div>
          <div className="text-[22px] font-semibold tabular-nums">
            {a.level}
            <span className="text-white/50 text-[14px]"> / {AGENCY.maxLevel}</span>
          </div>
        </div>
      </div>
      <div className="text-[13px] text-white/75">
        Teams this month: {Math.max(0, a.level - used)} of {a.level} · Experience {a.exp} · Costs {fmt(a.level * AGENCY.upkeepPerLevel, 1)} money a month
      </div>
      {a.level < AGENCY.maxLevel && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: Math.min(4, AGENCY.maxLevel - a.level) }, (_, i) => i + 1).map((levels) => (
              <OrderButton
                key={levels}
                order={{ type: 'fundAgency', nationId: player.id, agency: id, levels }}
                label={levels === 1 ? `Raise to level ${a.level + 1}` : `Raise to level ${a.level + levels}`}
                cost={`${levelsCost(a.level, levels)} money`}
                effect={levels === 1 ? 'One more team, better odds, more operations. Takes effect at once.' : `${levels} levels at once.`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** The agencies: what they cost, what they can do, and a button for each operation with honest odds. */
export function AgenciesTab() {
  const view = usePlayerView()
  const target = useGame((s) => s.agencyTarget)
  const setTarget = useGame((s) => s.setAgencyTarget)
  const { map } = getWorld()
  const game = view?.game
  const me = view?.player.id
  const list = useMemo(() => {
    if (!game || !me) return []
    const near = nationNeighbors(game, map, me)
    return Object.values(game.nations)
      .filter((n) => n.alive && n.id !== me)
      .sort((a, b) => Number(near.has(b.id)) - Number(near.has(a.id)) || Number(atWar(game, me, b.id)) - Number(atWar(game, me, a.id)) || militaryPower(game, b.id) - militaryPower(game, a.id))
  }, [game, me, map])
  if (!view || !game || !me) return null
  const { player } = view
  const chosen = target && game.nations[target]?.alive && target !== me ? target : list[0]?.id
  const t = chosen ? game.nations[chosen] : null
  const seen = chosen ? (game.intel[`${me}|${chosen}`] ?? -1) >= game.turn : false
  const rebelRegions = Object.values(game.regions).filter((r) => r.owner === me && r.rebels > 0)

  return (
    <div className="space-y-5">
      <p className="text-[14px] text-white/80">
        A great power does not just attack. It watches, builds a case, and works in the shadows. Each agency sends one team per level each month, and results arrive when the month ends.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <AgencyCard id="foreign" />
        <AgencyCard id="domestic" />
      </div>

      <section className="space-y-3">
        <h3 className="text-[16px] font-semibold tracking-tight">Abroad: {agencyName(player.name, 'foreign')}</h3>
        <label className="block">
          <span className="label">Target nation</span>
          <select className="field mt-1.5 w-full px-3 py-2 text-[14px]" value={chosen ?? ''} onChange={(e) => setTarget(e.target.value)} aria-label="Target nation">
            {list.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        {t && (
          <>
            <div className="inset-card p-3 text-[14px]">
              {seen ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div>
                    <div className="label">Military</div>
                    <div className="font-semibold tabular-nums">{fmt(militaryPower(game, t.id), 0)}</div>
                  </div>
                  <div>
                    <div className="label">Money</div>
                    <div className="font-semibold tabular-nums">{fmt(t.resources.capital, 0)}</div>
                  </div>
                  <div>
                    <div className="label">Stability</div>
                    <div className="font-semibold tabular-nums">{Math.round(t.stability)}%</div>
                  </div>
                  <div>
                    <div className="label">Agencies</div>
                    <div className="font-semibold tabular-nums">
                      {t.agencies.foreign.level} / {t.agencies.domestic.level}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-white/70">Their real numbers are hidden. Gather intelligence to see them.</p>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {FOREIGN_ORDER.map((op) => {
                const spec = FOREIGN_OPS[op]
                const odds = operationOdds(game, me, op, t.id)
                return (
                  <OrderButton
                    key={op}
                    order={{ type: 'operation', nationId: me, op, target: t.id }}
                    label={spec.name}
                    cost={`${spec.money} money${spec.pp ? `, ${spec.pp} influence` : ''}`}
                    effect={`${Math.round(odds.chance * 100)}% chance. ${spec.effect}${spec.friendly ? '' : ' If caught: reputation falls and they get a reason to fight you.'}`}
                  />
                )
              })}
            </div>
            {t && (
              <details className="text-[13px] text-white/70">
                <summary className="cursor-pointer">What the odds are made of</summary>
                <ul className="mt-1.5 space-y-0.5">
                  {operationOdds(game, me, 'sabotage', t.id).parts.map((p) => (
                    <li key={p.label} className="flex justify-between">
                      <span>{p.label}</span>
                      <span className="tabular-nums">
                        {p.value >= 0 ? '+' : ''}
                        {Math.round(p.value * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-[16px] font-semibold tracking-tight">At home: {agencyName(player.name, 'domestic')}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {DOMESTIC_ORDER.filter((op) => op !== 'crackdown').map((op) => {
            const spec = DOMESTIC_OPS[op]
            return <OrderButton key={op} order={{ type: 'domestic', nationId: me, op }} label={spec.name} cost={`${spec.money} money`} effect={spec.effect} />
          })}
          {rebelRegions.length === 0 ? (
            <OrderButton order={{ type: 'domestic', nationId: me, op: 'crackdown' }} label={DOMESTIC_OPS.crackdown.name} cost={`${DOMESTIC_OPS.crackdown.money} money`} effect={DOMESTIC_OPS.crackdown.effect} />
          ) : (
            rebelRegions.slice(0, 3).map((r) => (
              <OrderButton key={r.id} order={{ type: 'domestic', nationId: me, op: 'crackdown', regionId: r.id }} label={`Break up rebels in ${map.regions[r.id].name}`} cost={`${DOMESTIC_OPS.crackdown.money} money`} effect={DOMESTIC_OPS.crackdown.effect} />
            ))
          )}
        </div>
      </section>
    </div>
  )
}
