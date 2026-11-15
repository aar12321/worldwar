import { PROJECT_IDS, PROJECTS, PROJECT_RULES } from '../../data/projects'
import { SPENDING } from '../../data/people'
import { tierOf } from '../../engine/empire'
import { activeProjects, projectProblem } from '../../engine/industry'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { signed, usePlayerView } from '../hooks'
import { Bar, LevelPicker, StatTile, Tiles } from '../kit'
import { OrderButton } from '../panel'
import { Card } from './parts'

/** Public works and the great national projects. */
export function ProjectsTab() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const { game, player, econ } = view
  const spec = tierOf(player)
  const running = activeProjects(player)
  const works = view.pendingPolicy.spending.works
  const { map } = getWorld()
  const upkeep = econ.projects.upkeep

  return (
    <section className="econ-grid">
      <Tiles>
        <StatTile label="Under way" value={`${running.length} of ${spec.projectSlots}`} sub={`a ${spec.name} builds ${spec.projectSlots} at once`} />
        <StatTile label="Building costs" value={signed(-econ.projects.building)} sub="money a month" />
        <StatTile label="Upkeep of finished" value={signed(-upkeep)} sub={`${PROJECT_RULES.maintenance * 100}% of cost a month`} />
      </Tiles>

      <Card title="Public works" hint="Roads, power and the upkeep of every building. Low levels let factories, trade, wall repairs and projects slip; high levels speed them up and make building cheaper.">
        <LevelPicker label="Public works" levels={SPENDING.works.levels} value={works} onChange={(v) => setPolicy({ spending: { works: v } })} />
        <p className="text-[13px] text-white/70">
          Costs {econ.spending.works.toFixed(1)} a month at standard. Level {works}: factories {works >= 2 ? '+' : ''}
          {((works - 2) * 3).toFixed(0)}%, trade {works >= 2 ? '+' : ''}
          {((works - 2) * 5).toFixed(0)}%, building prices {works >= 2 ? '' : '+'}
          {((2 - works) * 3).toFixed(0)}%.
        </p>
      </Card>

      {PROJECT_IDS.map((id) => {
        const p = PROJECTS[id]
        const state = player.projects[id]
        const why = state ? null : projectProblem(game, map, player, id)
        const months = state ? Math.max(0, p.months - state.progress) : p.months
        return (
          <div key={id} className="inset-card p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold tracking-tight">{p.name}</h3>
                <p className="text-[13px] text-white/70">{p.blurb}</p>
              </div>
              {state?.done && <span className="chip text-[#6eeb8a]">Built</span>}
            </div>
            <p className="text-[13px]">{p.effect}</p>
            {state && !state.done ? (
              <>
                <Bar value={state.progress / p.months} color="#0a84ff" label={`${p.name} progress`} />
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="text-white/75">
                    {state.paused ? 'Paused' : `${months.toFixed(0)} months left`} · {signed(-p.cost / p.months)} a month
                  </span>
                  <OrderButton order={{ type: 'pauseProject', nationId: player.id, project: id, paused: !state.paused }} label={state.paused ? 'Resume' : 'Pause'} />
                </div>
              </>
            ) : state?.done ? (
              <p className="text-[13px] text-white/65">Upkeep {signed(-p.cost * PROJECT_RULES.maintenance)} a month.</p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className={`text-[13px] ${why ? 'text-[#ff8a84]' : 'text-white/75'}`}>
                  {why ?? `${p.cost} money over ${p.months} months`}
                </span>
                <OrderButton order={{ type: 'startProject', nationId: player.id, project: id }} label="Start" cost={`${p.cost / p.months | 0}/mo`} tone="btn-primary" />
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
