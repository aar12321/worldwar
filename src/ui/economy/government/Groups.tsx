import { GROUP_SPECS, GROUPS_RULES, PIPELINE } from '../../../data/civics'
import { civicsEffects, groupReport } from '../../../engine/civics'
import { usePlayerView } from '../../hooks'
import { Bar } from '../../kit'
import { Card, Line } from '../parts'

/** How business, labour, the military, tradition and the provinces feel, why, and what it does. */
export function GroupsSection() {
  const { game, player } = usePlayerView()!
  const { groups, approval } = groupReport(game, player)
  const eff = civicsEffects(player)
  return (
    <>
      <Card
        title="Interest groups"
        hint={`Each group reacts to your ministers, policies and civil service (that part moves stability) and to the times: taxes, jobs, war (that part only moves approval). Approval sets the odds in ${PIPELINE.body[player.government] ?? 'the council'}. Under a ${player.government.replace('_', '-')} government some groups count for more.`}
        right={<span className={`chip shrink-0 ${approval < 40 ? 'text-[#ff8a84]' : approval > 60 ? 'text-[#6eeb8a]' : ''}`}>Approval {Math.round(approval)}%</span>}
      >
        <div className="space-y-2.5">
          {groups.map((g) => {
            const spec = GROUP_SPECS[g.id]
            return (
              <div key={g.id} className="space-y-1">
                <div className="flex justify-between gap-2 text-[14px]">
                  <span className="font-semibold inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: spec.color }} />
                    {spec.name}
                    <span className="text-[12px] font-normal text-white/55">weight {g.weight}</span>
                  </span>
                  <span className="tabular-nums">{Math.round(g.satisfaction)}%</span>
                </div>
                <Bar value={g.satisfaction / 100} color={g.satisfaction < 35 ? '#ff453a' : g.satisfaction > 65 ? '#30d158' : spec.color} label={`${spec.name} satisfaction`} />
                <div className="text-[12px] text-white/60">
                  {spec.blurb} Your choices {fmtPts(g.choice * 1.5)}, the times {fmtPts(g.mood)}.
                </div>
              </div>
            )
          })}
        </div>
      </Card>
      <Card title="What the desk does to stability" hint="Ministers, the civil service, reforms and the groups' feelings about your choices, added to where stability is heading.">
        <div className="text-[14px] space-y-1">
          {eff.parts.length ? eff.parts.map((p) => <Line key={p.label} k={p.label} v={`${p.value >= 0 ? '+' : ''}${p.value.toFixed(1)}`} warn={p.value < 0} />) : <p className="text-white/60">Nothing yet: appoint ministers or pass a reform.</p>}
          {eff.parts.length > 0 && <Line k="Total" v={`${eff.stability >= 0 ? '+' : ''}${eff.stability.toFixed(1)}`} strong />}
        </div>
        <p className="text-[12px] text-white/55">A group's feeling from choices counts up to {GROUPS_RULES.choiceCap} points either way.</p>
      </Card>
    </>
  )
}

const fmtPts = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}`
