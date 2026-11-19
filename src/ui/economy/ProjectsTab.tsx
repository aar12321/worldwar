import { useMemo, useState, type ReactNode } from 'react'
import { TIERS } from '../../data/empire'
import { LOCAL, LOCAL_IDS, NEED_TEXT, describeLocal } from '../../data/localProjects'
import { SPENDING } from '../../data/people'
import { PROJECT_IDS, PROJECT_LEVELS, PROJECT_RULES, PROJECTS, WORKS } from '../../data/projects'
import { describeEffect } from '../../data/society'
import { tierOf } from '../../engine/empire'
import { activeProjects, projectSpeed, investedIn, levelCost, levelMonths, monthlyCost, projectLevel, projectProblem } from '../../engine/industry'
import type { LocalProjectId, ProjectId, RegionId } from '../../engine/types'
import { activeLocal, localCost, localInvested, localLevel, localMonthly, localMonths, localProblem, localScale, rushCost, rushGain } from '../../engine/works'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { signed, usePlayerView } from '../hooks'
import { LevelPicker, StatTile, Tiles } from '../kit'
import { Tabs } from '../panel'
import { DataList } from '../DataList'
import { Card, Fold } from './parts'
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
      <Tiles compact>
        <StatTile label="National projects" value={`${running} of ${spec.projectSlots}`} sub="being built at once" tone={running >= spec.projectSlots ? 'warn' : undefined} />
        <StatTile label="In your countries" value={`${runningLocal} of ${spec.localSlots}`} sub="being built at once" tone={runningLocal >= spec.localSlots ? 'warn' : undefined} />
        <StatTile label="Projects a month" value={signed(-(econ.projects.building + econ.projects.upkeep))} sub={`${econ.projects.building.toFixed(1)} building, ${econ.projects.upkeep.toFixed(1)} upkeep`} />
      </Tiles>
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

/** What a level of public works does, worked out from the same constants the engine uses (`worksEffects`, `projectSpeed`). */
function worksText(level: number, cost: number): string {
  const d = level - 2
  const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}%`
  const effects = d === 0 ? 'Standard: no bonus and no penalty.' : `Factories ${signedPct(WORKS.factory * d)}, trade ${signedPct(WORKS.trade * d)}, building prices ${signedPct(-WORKS.buildCost * d)}, projects ${Math.abs(Math.round(PROJECT_RULES.worksSpeed * d * 100))}% ${d > 0 ? 'faster' : 'slower'}, Defense Line repairs ${signedPct(WORKS.heal * d)}.`
  return `${cost.toFixed(1)} money a month at this level (it scales with the upkeep of your buildings). ${effects}`
}

function National() {
  const view = usePlayerView()!
  const setPolicy = useGame((s) => s.setPolicy)
  const { player, econ } = view
  const works = view.pendingPolicy.spending.works
  const reached = player.tier
  const tiers = [1, 2, 3, 4, 5] as const
  // What you have first, then what you can start now; what a bigger empire opens folds away at the bottom.
  const mine = PROJECT_IDS.filter((id) => projectLevel(player, id) > 0 || player.projects[id])
  const open = PROJECT_IDS.filter((id) => !mine.includes(id) && PROJECTS[id].tier <= reached)
  const locked = PROJECT_IDS.filter((id) => !mine.includes(id) && PROJECTS[id].tier > reached)
  return (
    <>
      <Card title="Public works" hint="Roads, power and the upkeep of every building. Its cost is the Public works line of your Budget. Low levels let factories, trade, Defense Line repairs and projects slip; high levels speed them up and make building cheaper.">
        <LevelPicker label="Public works" levels={SPENDING.works.levels} value={works} onChange={(v) => setPolicy({ spending: { works: v } })} />
        <p className="text-[13px] text-white/70">{worksText(works, -(econ.lines.find((l) => l.label === 'Public works')?.amount ?? 0))}</p>
      </Card>
      {mine.length > 0 && (
        <ProjectGroup title="Yours" note="Built or being built">
          {mine.map((id) => (
            <NationalCard key={id} id={id} />
          ))}
        </ProjectGroup>
      )}
      {open.length > 0 && (
        <ProjectGroup title={mine.length ? 'You can start' : 'Projects you can start'} note={`${open.length} open to you`}>
          {open.map((id) => (
            <NationalCard key={id} id={id} />
          ))}
        </ProjectGroup>
      )}
      {locked.length > 0 && (
        <div className="span-all space-y-1.5">
          <h2 className="text-[15px] font-semibold tracking-tight pt-1">For a bigger empire</h2>
          {tiers
            .filter((t) => t > reached)
            .map((t) => {
              const ids = locked.filter((id) => PROJECTS[id].tier === t)
              if (!ids.length) return null
              return (
                <Fold key={t} title={`${TIERS[t - 1].name}: ${ids.map((id) => PROJECTS[id].name).join(', ')}`} value={`needs ${TIERS[t - 1].countries} countries`}>
                  <div className="econ-grid pt-1">
                    {ids.map((id) => (
                      <NationalCard key={id} id={id} />
                    ))}
                  </div>
                </Fold>
              )
            })}
        </div>
      )}
    </>
  )
}

/** A heading and a grid of project cards. */
function ProjectGroup({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="span-all space-y-2">
      <div className="flex items-baseline justify-between gap-3 pt-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <span className="text-[12px] text-white/55">{note}</span>
      </div>
      <div className="econ-grid">{children}</div>
    </div>
  )
}

function NationalCard({ id }: { id: ProjectId }) {
  const view = usePlayerView()!
  const { game, player, econ } = view
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
      rushMonths={rushGain(player, econ.coverage.engineers)}
      speed={projectSpeed({ spending: view.pendingPolicy.spending }, econ.coverage.engineers)}
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
  const { game, player, econ } = view
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
      rushMonths={rushGain(player, econ.coverage.engineers)}
      speed={projectSpeed({ spending: view.pendingPolicy.spending }, econ.coverage.engineers)}
      where={spec.needs ? `Needs ${NEED_TEXT[spec.needs]}.` : undefined}
    />
  )
}
