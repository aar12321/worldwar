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
import { OrderButton, PanelShell, Tabs } from './panel'
import { AgenciesTab } from './AgenciesTab'
import { WarsTab } from './WarsPanel'

const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`

function UnitCard({ line }: { line: UnitStatLine }) {
  const view = usePlayerView()!
  const { game, player } = view
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

      <div className="unit-actions">
        <OrderButton
          order={{ type: 'queueTrain', nationId: player.id, unit: line.unit }}
          label="Train one"
          cost={`${orderCost(game, { type: 'queueTrain', nationId: player.id, unit: line.unit }).capital} money${spec.steel > 0 ? ` · ${spec.steel} steel` : ''}`}
          effect={`${spec.manpowerCost}k soldiers · ready in ${months} ${months === 1 ? 'turn' : 'turns'}${spec.oil > 0 ? ` · burns ${spec.oil} oil a month` : ''}`}
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
        <Total label="Divisions" value={formatDivisions(sheet.totalUnits)} />
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
              {UNIT_SPECS[j.unit].name} <span className="text-white/70">· {i < sheet.trainingSlots ? `${j.remaining} ${j.remaining === 1 ? 'turn' : 'turns'} left` : 'waiting for a slot'}</span>
            </span>
            <OrderButton order={{ type: 'cancelTrain', nationId: player.id, jobId: j.id }} label="Cancel" tone="btn-quiet" />
          </div>
        ))}
      </section>

      <section className="unit-grid">
        {sheet.units.map((line) => (
          <UnitCard key={line.unit} line={line} />
        ))}
      </section>

      <section className="inset-card p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[16px] font-semibold">Commander</div>
            <div className="text-[13px] text-white/70">{commander ? `${commander.name} drills your least-trained unit every turn, for free.` : 'A commander drills your least-trained unit every turn, for free.'}</div>
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
    </>
  )
}

const MILITARY_TABS = [
  ['forces', 'Forces'],
  ['wars', 'Wars'],
] as const

/** The Military desk: build the force, and run the wars it fights. */
export function MilitaryPanel() {
  const view = usePlayerView()
  const tab = useGame((s) => s.militaryTab)
  const setTab = useGame((s) => s.setMilitaryTab)
  if (!view) return null
  const { game, player } = view
  const wars = enemiesOf(game, player.id).length
  return (
    <PanelShell
      title="Military"
      kicker={`One force for the whole nation · ${wars} of ${maxWars(game, player.id)} wars`}
      panel="military"
      wide
      tabs={<Tabs value={tab} onChange={setTab} options={[MILITARY_TABS[0], ['wars', wars > 0 ? `Wars (${wars})` : 'Wars'], ['agencies', 'Agencies']] as const} />}
    >
      {tab === 'forces' ? <Forces /> : tab === 'wars' ? <WarsTab /> : <AgenciesTab />}
    </PanelShell>
  )
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset-card py-2.5">
      <div className="label">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
