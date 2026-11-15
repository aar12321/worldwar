import { COUNCIL, EMPIRE_RULES, OCCUPATION, RESOLUTIONS, TIERS, tierSpec } from '../data/empire'
import { projectedVote } from '../engine/council'
import { capitalDistance, capitalsOf, empireCount, tierOf } from '../engine/empire'
import { computeEconomy } from '../engine/economy'
import type { OccupationPolicy, ResolutionKind } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame, type EmpireTab } from '../store'
import { usePlayerView } from './hooks'
import { Bar, LevelPicker, Pending, StatTile, Tiles } from './kit'
import { pct } from './format'
import { Card, Line } from './economy/parts'
import { OrderButton, PanelShell, Tabs } from './panel'
import { useState } from 'react'
import { Spark } from './Charts'

const TABS = [
  ['overview', 'Overview'],
  ['provinces', 'Provinces'],
  ['world', 'World'],
  ['stats', 'Statistics'],
] as const satisfies readonly (readonly [EmpireTab, string])[]

/** What a tier opens, one line each, for the table. */
function unlocks(t: ReturnType<typeof tierSpec>): [string, string][] {
  return [
    ['Interest rate', t.rate ? `${t.rate[0]}% to ${t.rate[1]}%` : "the world's rate"],
    ['Printing', `${Math.round(t.printCap * 100)}% a month`],
    ['Bonds', `${t.bondTerms.map((m) => (m === 12 ? '1' : m === 36 ? '3' : '5')).join(', ')} years`],
    ['Projects at once', String(t.projectSlots)],
    ['State enterprises', String(t.enterpriseSlots)],
    ['Laws', String(t.lawSlots)],
    ['Specialization', pct(t.specializationCap)],
    ['Academy', `level ${t.academyMax}`],
    ['Administration', `${t.adminBase} countries`],
    ['Wealth fund', t.wealthFund ? 'yes' : 'no'],
    ['Move capital', t.moveCapital ? 'yes' : 'no'],
    ['Regional capitals', String(t.regionalCapitals)],
    ['World Bank loans', `up to ${t.loanMax}, ${t.loanMonths} months${t.loanPact ? ', with a pact' : ''}`],
    ['World Council', t.council ? `put resolutions (${t.council === 0.5 ? '1/2' : '2/3'} needed)` : 'no'],
  ]
}

export function EmpireDesk() {
  const view = usePlayerView()
  const tab = useGame((s) => s.empireTab)
  const setTab = useGame((s) => s.setEmpireTab)
  if (!view) return null
  const { game, player } = view
  const spec = tierOf(player)
  return (
    <PanelShell title="Empire" kicker={`${spec.name} · ${empireCount(game, player.id)} countries`} panel="empire" wide tabs={<Tabs value={tab} onChange={setTab} options={TABS} />}>
      <div>
        {tab === 'overview' && <Overview />}
        {tab === 'provinces' && <Provinces />}
        {tab === 'world' && <World />}
        {tab === 'stats' && <Statistics />}
      </div>
    </PanelShell>
  )
}

function Statistics() {
  const view = usePlayerView()!
  const { game, player } = view
  const mine = (game.history ?? []).filter((h) => h.nation === player.id)
  const series = (f: (h: (typeof mine)[number]) => number) => mine.map(f)
  const n = Object.values(game.nations).filter((x) => x.alive).length
  return (
    <section className="econ-grid">
      <p className="text-[13px] text-white/70 span-all">One point a month for {player.name}. The charts keep up to fifty years.</p>
      <Spark label="Money" values={series((h) => h.money)} color="#30d158" />
      <Spark label="Net income a month" values={series((h) => h.income)} color="#30d158" format={(v) => v.toFixed(1)} />
      <Spark label="Military strength" values={series((h) => h.power)} color="#ff9f0a" />
      <Spark label="Countries" values={series((h) => h.countries)} color="#0a84ff" />
      <Spark label="Stability" values={series((h) => h.stability)} color="#bf5af2" format={(v) => `${v.toFixed(0)}%`} />
      <Spark label="Population" values={series((h) => h.population)} color="#64d2ff" format={(v) => v.toFixed(1)} />
      <Spark label="Schooling" values={series((h) => h.schooling * 100)} color="#ffd60a" format={(v) => `${v.toFixed(0)}%`} />
      <Spark label="Inflation" values={series((h) => h.inflation)} color="#ff453a" format={(v) => `${v.toFixed(1)}%`} invert />
      <Spark label="Out of work" values={series((h) => h.unemployment * 100)} color="#ff6961" format={(v) => `${v.toFixed(1)}%`} invert />
      <Spark label={`Economy rank of ${n}`} values={series((h) => h.rank)} color="#0a84ff" format={(v) => `#${v.toFixed(0)}`} invert />
    </section>
  )
}

function Overview() {
  const view = usePlayerView()!
  const { game, player } = view
  const count = empireCount(game, player.id)
  const spec = tierOf(player)
  const next = TIERS.find((t) => t.id === spec.id + 1)
  const now = unlocks(spec)
  const after = next ? unlocks(next) : null
  return (
    <section className="econ-grid">
      <Card title={spec.name} hint={next ? `${next.countries - count} more ${next.countries - count === 1 ? 'country' : 'countries'} to become a ${next.name}. Countries count in full; each puppet's count half.` : 'You rule the world as no one has before.'}>
        {next && <Bar value={Math.min(1, (count - spec.countries) / Math.max(1, next.countries - spec.countries))} color="#0a84ff" label="Progress to the next tier" />}
        <div className="flex flex-wrap gap-2 text-[13px]">
          {TIERS.map((t) => (
            <span key={t.id} className={`chip ${t.id === spec.id ? 'text-[#6eeb8a]' : t.id < spec.id ? '' : 'opacity-60'}`}>
              {t.name} · {t.countries}+
            </span>
          ))}
        </div>
        <p className="text-[12px] text-white/60">A fall in size does not take powers away at once: you keep your tier until you are a tenth below its line.</p>
      </Card>

      <Card title="What you can do now" hint={next ? `And what a ${next.name} adds.` : undefined}>
        <div className="rounded-xl bg-white/5 divide-y divide-white/8 text-[13px]">
          {now.map(([k, v], i) => (
            <div key={k} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-1.5">
              <span className="text-white/75">{k}</span>
              <span className="tabular-nums">{v}</span>
              {after && <span className={`tabular-nums ${after[i][1] !== v ? 'text-[#6eeb8a]' : 'text-white/40'}`}>{after[i][1]}</span>}
            </div>
          ))}
        </div>
        {next && <p className="text-[12px] text-white/60">The right-hand column is what a {next.name} gets.</p>}
      </Card>
    </section>
  )
}

function Provinces() {
  const view = usePlayerView()!
  const setPrograms = useGame((s) => s.setPrograms)
  const { game, player, econ } = view
  const { map } = getWorld()
  const a = econ.admin
  const spec = tierOf(player)
  const caps = capitalsOf(game, player)
  const prog = view.pendingPrograms
  const owned = Object.values(game.regions)
    .filter((r) => r.owner === player.id)
    .sort((x, y) => y.population - x.population)
  const far = owned.filter((r) => !caps.includes(r.id) && r.integration >= 1).slice(0, 12)
  const wait = EMPIRE_RULES.capitalMoveCooldown - (game.turn - (player.capitalMoved ?? -99))

  return (
    <section className="econ-grid">
      <Tiles>
        <StatTile label="Administration" value={`${a.load.toFixed(1)} of ${a.capacity.toFixed(1)}`} tone={a.over > 0 ? 'bad' : a.load > a.capacity * 0.85 ? 'warn' : undefined} sub={a.over > 0 ? `${a.over.toFixed(1)} over: stability -${a.stability.toFixed(0)}, output -${pct(a.output)}` : 'within what your officials can run'} />
        <StatTile label="Unsettled" value={String(econ.occupied)} sub="conquered, not yet at home" />
        <StatTile label="Governors" value={String(a.governors)} sub={`${(a.governors * EMPIRE_RULES.governorSalary).toFixed(1)} money a month`} />
      </Tiles>

      <Card title="Occupation policy" hint="How conquered countries are held. It applies to every unsettled country." right={<Pending show={prog.occupation !== player.programs.occupation} />}>
        <LevelPicker
          label="Occupation policy"
          levels={(Object.keys(OCCUPATION) as OccupationPolicy[]).map((k) => OCCUPATION[k].name)}
          value={(Object.keys(OCCUPATION) as OccupationPolicy[]).indexOf(prog.occupation)}
          onChange={(i) => setPrograms({ occupation: (Object.keys(OCCUPATION) as OccupationPolicy[])[i] })}
          disabled={(i) => (spec.occupation.includes((Object.keys(OCCUPATION) as OccupationPolicy[])[i]) ? null : 'Needs a bigger empire')}
        />
        <p className="text-[13px] text-white/70">{OCCUPATION[prog.occupation].blurb}</p>
      </Card>

      <Card title="Capitals" hint="A capital needs no administration and holds its Defense Line better; countries near one settle faster. Regional capitals ease the load in far provinces.">
        <div className="text-[14px] space-y-1">
          <Line k="Capital" v={map.regions[player.capital]?.name ?? player.capital} />
          {caps.slice(1).map((c) => (
            <Line key={c} k="Regional capital" v={map.regions[c]?.name ?? c} />
          ))}
          <Line k="Regional capitals" v={`${player.regionalCapitals.length} of ${spec.regionalCapitals}`} />
        </div>
        {spec.regionalCapitals === 0 && <p className="text-[13px] text-white/65">A Superpower (25 countries) may have regional capitals; a Great power (10) may move its capital.</p>}
        {far.length > 0 && (spec.regionalCapitals > 0 || spec.moveCapital) && (
          <div className="rounded-xl bg-white/5 divide-y divide-white/8">
            {far.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[13px]">
                <span className="min-w-0 truncate">
                  {map.regions[r.id].name} <span className="text-white/55">· {Math.round(capitalDistance(game, map, player, r.id, caps))} km from a capital</span>
                </span>
                <span className="flex gap-1.5 shrink-0">
                  {spec.regionalCapitals > 0 && <OrderButton order={{ type: 'setRegionalCapital', nationId: player.id, regionId: r.id, on: true }} label="Regional" cost={`${EMPIRE_RULES.regionalCapitalInfluence} infl.`} />}
                  {spec.moveCapital && <OrderButton order={{ type: 'moveCapital', nationId: player.id, regionId: r.id }} label="Capital" cost={`${EMPIRE_RULES.capitalMoveInfluence} infl.`} effect={wait > 0 ? `In ${wait} months` : `Stability -${EMPIRE_RULES.capitalMoveStability}`} />}
                </span>
              </div>
            ))}
          </div>
        )}
        {player.regionalCapitals.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {player.regionalCapitals.map((c) => (
              <OrderButton key={c} order={{ type: 'setRegionalCapital', nationId: player.id, regionId: c, on: false }} label={`Release ${map.regions[c]?.name ?? c}`} />
            ))}
          </div>
        )}
      </Card>
    </section>
  )
}

const KINDS = Object.keys(RESOLUTIONS) as ResolutionKind[]

function World() {
  const view = usePlayerView()!
  const { game, player, econ } = view
  const { map } = getWorld()
  const spec = tierOf(player)
  const [kind, setKind] = useState<ResolutionKind>('sanctions')
  const [target, setTarget] = useState('')
  const [second, setSecond] = useState('')
  const def = RESOLUTIONS[kind]
  const gross = new Map<string, number>()
  for (const n of Object.values(game.nations)) if (n.alive) gross.set(n.id, computeEconomy(game, map, n.id).gross)
  const vote = spec.council ? projectedVote(game, map, player.id, kind, target || undefined, second || undefined, gross) : null
  const rivals = Object.values(game.nations)
    .filter((n) => n.alive && n.id !== player.id)
    .sort((a, b) => a.name.localeCompare(b.name))
  const reserve = game.worldStats.reserve
  const wait = COUNCIL.cooldown - (game.turn - (player.lastResolution ?? -99))

  return (
    <section className="econ-grid">
      <Tiles>
        <StatTile label="World interest rate" value={`${game.worldStats.rate.toFixed(1)}%`} />
        <StatTile label="World inflation" value={`${game.worldStats.inflation.toFixed(1)}%`} />
        <StatTile label="Reserve currency" value={reserve ? (reserve === player.id ? 'Yours' : (game.nations[reserve]?.name ?? reserve)) : 'None'} sub={reserve === player.id ? `+${econ.seigniorage.toFixed(1)} a month` : 'the largest economy, if a Superpower'} tone={reserve === player.id ? 'good' : undefined} />
      </Tiles>

      <Card title="World Council" hint="A Superpower may put resolutions to every nation. Votes are weighted by income; your allies and puppets vote yes and the target votes no.">
        {!spec.council ? (
          <p className="text-[13px] text-white/70">Needs a Superpower (25 countries). You hold {empireCount(game, player.id)}.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {KINDS.map((k) => (
                <button key={k} className={`btn text-left px-2.5 py-2 text-[13px] ${kind === k ? 'btn-primary' : 'btn-quiet'}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {RESOLUTIONS[k].name}
                </button>
              ))}
            </div>
            <p className="text-[13px] text-white/70">{def.blurb}</p>
            {def.needsTarget && (
              <select className="field px-3 py-2 w-full" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target nation">
                <option value="">{kind === 'ceasefire' ? 'First nation…' : 'Target…'}</option>
                {rivals.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            )}
            {def.needsSecond && (
              <select className="field px-3 py-2 w-full" value={second} onChange={(e) => setSecond(e.target.value)} aria-label="Second nation">
                <option value="">Second nation…</option>
                {rivals.filter((n) => n.id !== target).map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            )}
            {vote && (
              <div className="space-y-1">
                <div className="flex justify-between text-[13px]">
                  <span>Projected vote</span>
                  <span className="tabular-nums">
                    {pct(vote.yes / Math.max(1, vote.total))} yes · needs more than {pct(vote.needed)}
                  </span>
                </div>
                <Bar value={vote.yes / Math.max(1, vote.total)} color={vote.passes ? '#30d158' : '#ffd60a'} label="Projected vote in favor" />
                <p className={`text-[12px] ${vote.passes ? 'text-[#6eeb8a]' : 'text-[#ffb340]'}`}>{vote.passes ? 'It would pass.' : 'It would fail: you would spend the influence and the next try must wait.'}</p>
              </div>
            )}
            <OrderButton order={{ type: 'resolution', nationId: player.id, kind, target: target || undefined, target2: second || undefined }} label="Put to the vote" cost={`${def.cost} influence`} effect={wait > 0 ? `Again in ${wait} months` : 'Decided when the month ends'} tone="btn-primary" />
          </>
        )}
      </Card>

      <Card title="World Bank loans" hint="Lend money to a nation from the Diplomacy desk. The size and length depend on your tier; a Superpower can attach a non-aggression pact.">
        <div className="text-[14px] space-y-1">
          <Line k="Most you can lend" v={String(spec.loanMax)} />
          <Line k="Longest loan" v={`${spec.loanMonths} months`} />
          <Line k="With a pact" v={spec.loanPact ? 'yes' : 'Superpower'} />
        </div>
      </Card>
      {game.accord && game.accord.until >= game.turn && <p className="text-[13px] text-[#6eeb8a]">A trade accord is in force until {game.accord.until - game.turn} months from now.</p>}
    </section>
  )
}
