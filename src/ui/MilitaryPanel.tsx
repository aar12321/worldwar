import { useState, type ReactNode } from 'react'
import { TRAINING, UNIT_SPECS, WEAPONS, trainingCost, trainingRank, weaponCost } from '../data/unitTypes'
import { nextWeaponLevel } from '../engine/arms'
import { enemiesOf, formatDivisions, maxWars } from '../engine/helpers'
import { orderCost } from '../engine/orders'
import { militarySheet, type UnitStatLine } from '../engine/militaryStats'
import { trainMonths } from '../engine/training'
import { useGame } from '../store'
import { Pips } from './bits'
import { fmt, usePlayerView } from './hooks'
import { UnitIcon } from './icons'
import { DeskTabs, OrderButton, PanelShell, TabHost } from './panel'
import { NumberStepper, Term } from './widgets'
import { ACADEMY, GENERAL_TRAITS } from '../data/projects'
import { tierOf } from '../engine/empire'
import { academyCost } from '../engine/industry'
import { AIRCRAFT_IDS, AIRCRAFT_NODES } from '../data/aircraft'
import { activeDevs, devSlots, finishedDevs } from '../engine/aircraft'
import { Bar } from './kit'

const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`

function UnitCard({ line }: { line: UnitStatLine }) {
  const view = usePlayerView()!
  const { game, player } = view
  const [batch, setBatch] = useState(1)
  const issueBatch = useGame((st) => st.issueBatch)
  const toast = useGame((st) => st.toast)
  const spec = UNIT_SPECS[line.unit]
  const weapons = nextWeaponLevel(game, player.id, line.unit)
  const bonusAttack = line.attack / line.baseAttack - 1
  const bonusDefense = line.defense / line.baseDefense - 1
  const months = trainMonths(line.unit)
  return (
    <div className="inset-card p-3.5 space-y-3">
      <div className="flex items-start gap-3">
        <span className="unit-badge" aria-hidden>
          <UnitIcon unit={line.unit} size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold tracking-tight">{line.name}</div>
          <div className="text-[13px] text-white/70">{spec.role}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[24px] font-semibold tabular-nums leading-none">{formatDivisions(line.count)}</div>
          <div className="label">{Math.abs(line.count - 1) < 0.05 ? 'division' : 'divisions'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-white/6 py-2">
          <div className="label">Attack</div>
          <div className="text-[18px] font-semibold tabular-nums">{line.attack.toFixed(2)}</div>
          <div className="text-[12px] text-white/65">
            base {line.baseAttack} · {pct(bonusAttack)}
          </div>
        </div>
        <div className="rounded-xl bg-white/6 py-2">
          <div className="label">Defense</div>
          <div className="text-[18px] font-semibold tabular-nums">{line.defense.toFixed(2)}</div>
          <div className="text-[12px] text-white/65">
            base {line.baseDefense} · {pct(bonusDefense)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-[14px]">
        <span className="flex items-center gap-2">
          Weapons <Pips value={line.weaponLevel} max={WEAPONS.maxLevel} />
        </span>
        <span className="flex items-center gap-2">
          Drill <Pips value={line.drillRank} max={TRAINING.max} />
          <span className="text-white/70">{trainingRank(line.drillRank)}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <NumberStepper label={`${line.name} to train at once`} value={batch} onChange={setBatch} min={1} max={25} quick={[1, 5, 10]} slider={false} />
        {batch > 1 && (
          <button
            className="btn btn-primary px-3 py-1 text-[13px]"
            title={`Queue ${batch} ${line.name} until the queue is full or you run out of money, soldiers or steel`}
            onClick={() => {
              const order = { type: 'queueTrain' as const, nationId: player.id, unit: line.unit }
              const { done, failed } = issueBatch(Array.from({ length: batch }, () => order))
              if (done > 0 && failed > 0) toast(`${done} queued; the rest could not be: the queue, money, soldiers or steel ran out.`, 'info')
            }}
          >
            Queue {batch}
          </button>
        )}
      </div>

      <div className="unit-actions">
        <OrderButton
          order={{ type: 'queueTrain', nationId: player.id, unit: line.unit }}
          label="Train one"
          cost={`${orderCost(game, { type: 'queueTrain', nationId: player.id, unit: line.unit }).capital} money${spec.steel > 0 ? ` · ${spec.steel} steel` : ''}`}
          effect={`${spec.manpowerCost > 0 ? `${spec.manpowerCost}k soldiers` : 'no soldiers needed'} · ready in ${months} ${months === 1 ? 'month' : 'months'}${spec.oil > 0 ? ` · burns ${spec.oil} oil a month` : ''}`}
          tone="btn-primary"
        />
        <OrderButton
          order={{ type: 'upgradeWeapons', nationId: player.id, unit: line.unit }}
          label={weapons.level >= WEAPONS.maxLevel ? 'Best weapons' : 'Better weapons'}
          cost={weapons.level >= WEAPONS.maxLevel ? undefined : `${weaponCost(weapons.level)} money`}
          effect={`+${Math.round(WEAPONS.bonusPerLevel * 100)}% attack and defense, for good`}
        />
        <OrderButton
          order={{ type: 'train', nationId: player.id, unit: line.unit }}
          label={line.drillRank >= TRAINING.max ? 'Fully drilled' : 'Drill'}
          cost={line.drillRank >= TRAINING.max ? undefined : `${trainingCost(line.drillRank)} money`}
          effect={`+${Math.round(TRAINING.bonusPerLevel * 100)}% attack and defense per rank`}
        />
      </div>

      {line.sources.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-white/75">Where the bonuses come from</summary>
          <ul className="mt-2 space-y-1">
            {line.sources.map((src) => (
              <li key={src.label} className="flex justify-between gap-3 text-white/80">
                <span>{src.label}</span>
                <span className="tabular-nums text-white/70">
                  ATK {pct(src.attack)} · DEF {pct(src.defense)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** The way into aircraft development: what is in hand and how far along, with the big Develop button. */
function AircraftCard() {
  const view = usePlayerView()!
  const setOpen = useGame((s) => s.setAircraftOpen)
  const { player, econ } = view
  const active = activeDevs(player)
  const done = finishedDevs(player).length
  const slots = devSlots(player)
  return (
    <section className="inset-card p-3.5 space-y-2.5" aria-label="Aircraft development">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold">Aircraft development</div>
          <div className="text-[13px] text-white/70">
            Better fighters and bombers: radar, missile hunters, stealth, range, payload and drone wingmen. {done} of {AIRCRAFT_IDS.length} developed · {active.length} of {slots} in hand{econ.aircraftBill > 0 ? ` · ${fmt(econ.aircraftBill, 1)} money a month` : ''}.
          </div>
        </div>
        <button className="btn btn-primary px-5 py-2.5 text-[15px] shrink-0" onClick={() => setOpen(true)}>
          Develop
        </button>
      </div>
      {active.map((id) => {
        const p = player.aircraft![id]!
        const node = AIRCRAFT_NODES[id]
        return (
          <div key={id} className="space-y-1">
            <div className="flex justify-between text-[13px]">
              <span>{node.name}</span>
              <span className="text-white/70 tabular-nums">
                {p.progress.toFixed(1)} of {node.months} months
              </span>
            </div>
            <Bar value={p.progress / node.months} color="#6cb4ff" label={`${node.name} progress`} />
          </div>
        )
      })}
    </section>
  )
}

function Forces() {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const { game, player } = view
  const sheet = militarySheet(game, player.id)
  const jobs = game.trainingQueue.filter((j) => j.nationId === player.id)
  const commander = player.generals.find((g) => g.id === player.military.commanderId)
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <Total label="Strength" value={sheet.totalPower.toFixed(0)} />
        <Total label={<Term word="Division">Divisions</Term>} value={formatDivisions(sheet.totalUnits)} sub={sheet.inField > 0.05 ? `${formatDivisions(sheet.totalUnits - sheet.inField)} at home · ${formatDivisions(sheet.inField)} in the field` : undefined} />
        <Total label="Upkeep a month" value={`-${fmt(sheet.upkeep, 1)}`} />
        <Total label="Food a month" value={`-${fmt(sheet.foodUse, 1)}`} />
      </div>
      <p className={`text-[14px] ${sheet.combinedArms ? 'text-[#6eeb8a]' : 'text-white/70'}`}>
        {sheet.combinedArms
          ? `Combined arms: infantry, tanks and planes together add ${Math.round(sheet.combinedArmsBonus * 100)}% to attack.`
          : `Field infantry, tanks and planes together (at least half a division of each) and all of them attack ${Math.round(sheet.combinedArmsBonus * 100)}% harder.`}
      </p>

      <section className="inset-card p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[16px] font-semibold">In training</div>
          <div className="text-[13px] text-white/70">
            {Math.min(jobs.length, sheet.trainingSlots)} of {sheet.trainingSlots} slots busy{jobs.length > sheet.trainingSlots ? ` · ${jobs.length - sheet.trainingSlots} waiting` : ''}
          </div>
        </div>
        {jobs.length === 0 && <p className="text-[14px] text-white/70">Nothing in training. Each barracks level adds a slot.</p>}
        {jobs.map((j, i) => (
          <div key={j.id} className="flex items-center justify-between gap-3 text-[14px]">
            <span className="flex items-center gap-2">
              <UnitIcon unit={j.unit} size={18} />
              {UNIT_SPECS[j.unit].name} <span className="text-white/70">· {i < sheet.trainingSlots ? `${j.remaining} ${j.remaining === 1 ? 'month' : 'months'} left` : 'waiting for a slot'}</span>
            </span>
            <OrderButton order={{ type: 'cancelTrain', nationId: player.id, jobId: j.id }} label="Cancel" tone="btn-quiet" />
          </div>
        ))}
      </section>

      <AircraftCard />

      <section className="unit-grid">
        {sheet.units.map((line) => (
          <UnitCard key={line.unit} line={line} />
        ))}
      </section>

      <section className="inset-card p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[16px] font-semibold">Commander</div>
            <div className="text-[13px] text-white/70">{commander ? `${commander.name} drills your least-trained unit every month, for free.` : 'A commander drills your least-trained unit every month, for free.'}</div>
            {commander && (
              <div className="text-[13px] text-[#6cb4ff] mt-0.5">
                {GENERAL_TRAITS[commander.trait].name}: {GENERAL_TRAITS[commander.trait].blurb}
              </div>
            )}
          </div>
          <select
            className="field px-3 py-2 text-[14px]"
            aria-label="Commander"
            value={player.military.commanderId ?? ''}
            onChange={(e) => issueOrder({ type: 'assignGeneral', nationId: player.id, generalId: e.target.value || null })}
          >
            <option value="">None</option>
            {player.generals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="inset-card p-3.5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[16px] font-semibold">Military academy · level {player.academy} of {tierOf(player).academyMax}</div>
            <div className="text-[13px] text-white/70">
              New recruits join already drilled to the academy's level, drill costs {Math.round(ACADEMY.drillDiscount * player.academy * 100)}% less, and combined arms fights {Math.round(ACADEMY.combinedArms * player.academy * 100)}% better. Higher weapon levels need less factory. It costs {ACADEMY.upkeep} a month a level.
            </div>
          </div>
          {player.academy < 3 && <OrderButton order={{ type: 'fundAcademy', nationId: player.id }} label="Expand" cost={`${academyCost(player)} money`} tone="btn-primary" className="shrink-0" />}
        </div>
        <div className="text-[12px] text-white/60">Needs schooling of {Math.round(ACADEMY.schooling[Math.min(2, player.academy)] * 100)}% for the next level (yours is {Math.round(player.people.schooling * 100)}%). Doctors return part of the wounded infantry to the ranks after every battle.</div>
      </section>
    </>
  )
}

/** The Military desk: build the force, and run the wars it fights. Its tabs are listed in the registry (src/ui/registry.ts). */
export function MilitaryPanel() {
  const view = usePlayerView()
  if (!view) return null
  const { game, player } = view
  const wars = enemiesOf(game, player.id).length
  return (
    <PanelShell title="Military" kicker={`One force for the whole nation · ${wars} of ${maxWars(game, player.id)} wars`} panel="military" wide tabs={<DeskTabs desk="military" />}>
      <TabHost desk="military" />
    </PanelShell>
  )
}

/** The Forces tab, named for the registry. */
export { Forces as MilitaryForces }

function Total({ label, value, sub }: { label: ReactNode; value: string; sub?: string }) {
  return (
    <div className="inset-card py-2.5">
      <div className="label">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-white/65 px-1">{sub}</div>}
    </div>
  )
}
