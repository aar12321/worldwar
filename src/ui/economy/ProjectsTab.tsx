import { useMemo, useState } from 'react'
import { TIERS } from '../../data/empire'
import { LOCAL, LOCAL_IDS, NEED_TEXT, describeLocal } from '../../data/localProjects'
import { SPENDING } from '../../data/people'
import { PROJECT_IDS, PROJECT_LEVELS, PROJECT_RULES, PROJECTS } from '../../data/projects'
import { describeEffect } from '../../data/society'
import { tierOf } from '../../engine/empire'
import { activeProjects, investedIn, levelCost, levelMonths, monthlyCost, projectLevel, projectProblem } from '../../engine/industry'
import type { LocalProjectId, ProjectId, RegionId } from '../../engine/types'
import { activeLocal, localCost, localInvested, localLevel, localMonthly, localMonths, localProblem, localScale, RUSH, rushCost } from '../../engine/works'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { signed, usePlayerView } from '../hooks'
import { LevelPicker, StatTile } from '../kit'
import { Tabs } from '../panel'
import { DataList } from '../DataList'
import { Card } from './parts'
import { ProjectCard } from './projects/ProjectCard'

type Mode = 'national' | 'local'

/** Public works, the great national projects, and what is built in each of your countries. */
export function ProjectsTab() {
  const view = usePlayerView()!
  const [mode, setMode] = useState<Mode>('national')
  const { game, player, econ } = view
  const spec = tierOf(player)
  const running = activeProjects(player).length
  const runningLocal = activeLocal(game, player.id).length

  return (
    <section className="econ-grid">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 span-all">
        <StatTile label="National projects" value={`${running} of ${spec.projectSlots}`} sub={`up to ${spec.projectSlots} at once`} />
        <StatTile label="In your countries" value={`${runningLocal} of ${spec.localSlots}`} sub={`up to ${spec.localSlots} at once`} />
        <StatTile label="Building costs" value={signed(-econ.projects.building)} sub="money a month" />
        <StatTile label="Upkeep of finished" value={signed(-econ.projects.upkeep)} sub={`${PROJECT_RULES.maintenance * 100}% of what was put in, a month`} />
      </div>
      <div className="span-all">
        <Tabs
          value={mode}
          onChange={setMode}
          options={[
            ['national', 'National'],
            ['local', 'In your countries'],
          ]}
        />
      </div>
      {mode === 'national' ? <National /> : <Countries />}
    </section>
  )
}

// ---- National ----

function National() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const { player, econ } = view
  const works = view.pendingPolicy.spending.works
  const reached = player.tier
  const tiers = [1, 2, 3, 4, 5] as const
  return (
    <>
      <Card title="Public works" hint="Roads, power and the upkeep of every building. Low levels let factories, trade, wall repairs and projects slip; high levels speed them up and make building cheaper.">
        <LevelPicker label="Public works" levels={SPENDING.works.levels} value={works} onChange={(v) => setPolicy({ spending: { works: v } })} />
        <p className="text-[13px] text-white/70">
          Costs {econ.spending.works.toFixed(1)} a month at standard. Level {works}: factories {works >= 2 ? '+' : ''}
          {((works - 2) * 3).toFixed(0)}%, trade {works >= 2 ? '+' : ''}
          {((works - 2) * 5).toFixed(0)}%, building prices {works >= 2 ? '' : '+'}
          {((2 - works) * 3).toFixed(0)}%, projects {works >= 2 ? '' : '−'}
          {Math.abs((works - 2) * 10)}% {works >= 2 ? 'faster' : 'slower'}.
        </p>
      </Card>
      {tiers.map((t) => {
        const ids = PROJECT_IDS.filter((id) => PROJECTS[id].tier === t)
        if (!ids.length) return null
        const spec = TIERS[t - 1]
        return (
          <div key={t} className="span-all space-y-2">
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <h2 className="text-[15px] font-semibold tracking-tight">{t === 1 ? 'Open to every nation' : spec.name}</h2>
              <span className={`text-[12px] ${reached >= t ? 'text-[#6eeb8a]' : 'text-white/55'}`}>{t === 1 ? '' : reached >= t ? 'Unlocked' : `Needs ${spec.countries} countries`}</span>
            </div>
            <div className="econ-grid">
              {ids.map((id) => (
                <NationalCard key={id} id={id} />
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

function NationalCard({ id }: { id: ProjectId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const { map } = getWorld()
  const spec = PROJECTS[id]
  const state = player.projects[id]
  const level = projectLevel(player, id)
  const building = !!state && !state.done
  const nextL = Math.min(PROJECT_LEVELS.max, level + 1)
  // What a level does. The first seven projects keep their effects in the economy itself, so they say it in a sentence.
  const lines = (l: number) => (spec.effects ? describeEffect(spec.effects, PROJECT_LEVELS.power[l]) : [{ text: l > 1 ? `${spec.effect} Worth ${PROJECT_LEVELS.power[l]}× the first level.` : spec.effect, good: true }])
  const buildL = building ? level + 1 : nextL
  return (
    <ProjectCard
      name={spec.name}
      blurb={spec.blurb}
      level={level}
      state={state}
      now={lines(Math.max(1, level))}
      next={level >= 1 && level < PROJECT_LEVELS.max ? lines(level + 1) : undefined}
      months={levelMonths(id, buildL)}
      monthly={monthlyCost(id, buildL)}
      cost={levelCost(id, nextL)}
      upkeep={investedIn(id, level) * PROJECT_RULES.maintenance}
      problem={building || level >= PROJECT_LEVELS.max ? null : projectProblem(game, map, player, id)}
      start={{ type: 'startProject', nationId: player.id, project: id }}
      pause={{ type: 'pauseProject', nationId: player.id, project: id, paused: !state?.paused }}
      rush={{ type: 'rushProject', nationId: player.id, project: id }}
      rushPrice={state && !state.done ? rushCost(game, player, id) : 0}
      rushMonths={RUSH.months}
    />
  )
}

// ---- In your countries ----

function Countries() {
  const view = usePlayerView()!
  const openEconomy = useGame((s) => s.openEconomy)
  const stored = useGame((s) => s.economyRegion)
  const { game, player } = view
  const { map } = getWorld()
  const owned = useMemo(
    () =>
      Object.values(game.regions)
        .filter((r) => r.owner === player.id)
        .sort((a, b) => b.population - a.population),
    [game.regions, player.id],
  )
  const regionId: RegionId = stored && game.regions[stored]?.owner === player.id ? stored : player.capital
  const under = activeLocal(game, player.id)
  const select = (id: RegionId) => openEconomy('projects', id)
  const countOf = (id: RegionId) => Object.values(game.regions[id].works ?? {}).filter((p) => p?.done).length
  const buildingIn = (id: RegionId) => Object.values(game.regions[id].works ?? {}).filter((p) => p && !p.done).length

  return (
    <>
      <Card title="Your countries" hint="Each can have its own projects: an industrial park, a dam, a resort. Pick one, then build.">
        <DataList
          rows={owned}
          rowKey={(r) => r.id}
          searchText={(r) => map.regions[r.id].name}
          searchLabel="Search your countries"
          label="Your countries"
          noun={['country', 'countries']}
          sorts={[
            { id: 'size', label: 'Biggest first', value: (r) => r.population, dir: 'desc' },
            { id: 'name', label: 'A to Z', value: (r) => map.regions[r.id].name, dir: 'asc' },
            { id: 'built', label: 'Most built first', value: (r) => countOf(r.id), dir: 'desc' },
          ]}
          pageSize={25}
          renderRow={(r) => (
            <button className={`w-full text-left rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 text-[14px] ${r.id === regionId ? 'bg-[#0a84ff]/25' : 'hover:bg-white/6'}`} data-row-primary aria-pressed={r.id === regionId} onClick={() => select(r.id)}>
              <span className="font-semibold truncate">{map.regions[r.id].name}</span>
              <span className="text-[12px] text-white/65 whitespace-nowrap">
                {countOf(r.id)} built{buildingIn(r.id) > 0 ? ` · ${buildingIn(r.id)} building` : ''}
              </span>
            </button>
          )}
        />
      </Card>

      {under.length > 0 && (
        <Card title="Under way across your empire" hint="Everything being built in your countries right now.">
          <ul className="space-y-1">
            {under.map((u) => {
              const r = game.regions[u.regionId]
              const p = r.works![u.id]!
              const lvl = localLevel(r, u.id) + 1
              return (
                <li key={`${u.regionId}-${u.id}`}>
                  <button className="w-full text-left rounded-lg px-2.5 py-1.5 hover:bg-white/6 flex items-center justify-between gap-2 text-[13px]" onClick={() => select(u.regionId)}>
                    <span className="truncate">
                      <span className="font-semibold">{LOCAL[u.id].name}</span> <span className="text-white/65">· {map.regions[u.regionId].name}</span>
                    </span>
                    <span className="text-white/70 tabular-nums whitespace-nowrap">{p.paused ? 'Paused' : `${Math.max(0, localMonths(u.id, lvl) - p.progress).toFixed(0)} months left`}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <div className="span-all flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{map.regions[regionId].name}</h2>
        <span className="text-[12px] text-white/60">{localScale(game.regions[regionId]) >= 1.5 ? 'A large country: dearer to build in, and it gives more back.' : localScale(game.regions[regionId]) <= 0.7 ? 'A small country: cheaper to build in, and it gives less back.' : 'A country of middling size.'}</span>
      </div>
      <div className="econ-grid span-all">
        {LOCAL_IDS.map((id) => (
          <LocalCard key={id} id={id} regionId={regionId} />
        ))}
      </div>
    </>
  )
}

function LocalCard({ id, regionId }: { id: LocalProjectId; regionId: RegionId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const { map } = getWorld()
  const spec = LOCAL[id]
  const r = game.regions[regionId]
  const state = r.works?.[id]
  const level = localLevel(r, id)
  const building = !!state && !state.done
  const nextL = Math.min(PROJECT_LEVELS.max, level + 1)
  const scale = localScale(r)
  const dev = map.regions[regionId].development
  const lines = (l: number) => describeLocal(id, PROJECT_LEVELS.power[l], scale, dev).map((text) => ({ text, good: true }))
  const buildL = building ? level + 1 : nextL
  return (
    <ProjectCard
      name={spec.name}
      blurb={spec.blurb}
      level={level}
      state={state}
      now={lines(Math.max(1, level))}
      next={level >= 1 && level < PROJECT_LEVELS.max ? lines(level + 1) : undefined}
      months={localMonths(id, buildL)}
      monthly={localMonthly(id, buildL, r)}
      cost={localCost(id, nextL, r)}
      upkeep={localInvested(id, level, r) * PROJECT_RULES.maintenance}
      problem={building || level >= PROJECT_LEVELS.max ? null : localProblem(game, map, player, id, regionId)}
      start={{ type: 'startProject', nationId: player.id, project: id, regionId }}
      pause={{ type: 'pauseProject', nationId: player.id, project: id, paused: !state?.paused, regionId }}
      rush={{ type: 'rushProject', nationId: player.id, project: id, regionId }}
      rushPrice={building ? rushCost(game, player, id, regionId) : 0}
      rushMonths={RUSH.months}
      where={spec.needs ? `Needs ${NEED_TEXT[spec.needs]}.` : undefined}
    />
  )
}
