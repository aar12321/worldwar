import { TRAINING, UNIT_SPECS, WEAPONS, trainingCost, trainingRank, weaponCost } from '../data/unitTypes'
import { nextWeaponLevel } from '../engine/arms'
import { formatDivisions } from '../engine/helpers'
import { militarySheet, type UnitStatLine } from '../engine/militaryStats'
import { trainMonths } from '../engine/training'
import { useGame } from '../store'
import { Pips } from './bits'
import { fmt, usePlayerView } from './hooks'
import { OrderButton, PanelShell } from './panel'

const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`

function UnitCard({ line }: { line: UnitStatLine }) {
  const view = usePlayerView()!
  const { game, player } = view
  const spec = UNIT_SPECS[line.unit]
  const weapons = nextWeaponLevel(game, player.id, line.unit)
  const bonusAttack = line.attack / line.baseAttack - 1
  const bonusDefense = line.defense / line.baseDefense - 1
  return (
    <div className="inset-card p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[17px] font-semibold tracking-tight">{line.name}</div>
          <div className="text-[13px] text-white/70">
            {spec.capitalCost} money · {spec.manpowerCost}k soldiers · {trainMonths(line.unit)} {trainMonths(line.unit) === 1 ? 'turn' : 'turns'} · upkeep {spec.upkeep}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[24px] font-semibold tabular-nums leading-none">{formatDivisions(line.count)}</div>
          <div className="label">{Math.abs(line.count - 1) < 0.05 ? 'division' : 'divisions'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-white/6 py-2">
          <div className="label">Attack</div>
          <div className="text-[18px] font-semibold tabular-nums">{line.attack.toFixed(2)}</div>
          <div className="text-[12px] text-white/65">base {line.baseAttack} · {pct(bonusAttack)}</div>
        </div>
        <div className="rounded-xl bg-white/6 py-2">
          <div className="label">Defense</div>
          <div className="text-[18px] font-semibold tabular-nums">{line.defense.toFixed(2)}</div>
          <div className="text-[12px] text-white/65">base {line.baseDefense} · {pct(bonusDefense)}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-[14px]">
        <span className="flex items-center gap-2">
          Weapons <Pips value={line.weaponLevel} max={WEAPONS.maxLevel} />
        </span>
        <OrderButton
          order={{ type: 'upgradeWeapons', nationId: player.id, unit: line.unit }}
          label={weapons.level >= WEAPONS.maxLevel ? 'Best weapons' : `Upgrade · ${weaponCost(weapons.level)} money`}
          tone="btn-primary"
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[14px]">
        <span className="flex items-center gap-2">
          Drill <Pips value={line.drillRank} max={TRAINING.max} />
          <span className="text-white/70">{trainingRank(line.drillRank)}</span>
        </span>
        <OrderButton
          order={{ type: 'train', nationId: player.id, unit: line.unit }}
          label={line.drillRank >= TRAINING.max ? 'Fully drilled' : `Drill · ${trainingCost(line.drillRank)} money`}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] text-white/70">Raise one more</span>
        <OrderButton order={{ type: 'queueTrain', nationId: player.id, unit: line.unit }} label={`Train · ${spec.capitalCost} money`} tone="btn-primary" />
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

export function MilitaryPanel() {
  const view = usePlayerView()
  const issueOrder = useGame((s) => s.issueOrder)
  if (!view) return null
  const { game, player } = view
  const sheet = militarySheet(game, player.id)
  const jobs = game.trainingQueue.filter((j) => j.nationId === player.id)
  const commander = player.generals.find((g) => g.id === player.military.commanderId)

  return (
    <PanelShell title="Your military" kicker="One force. Every number here is what battles use." panel="military" wide>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <Total label="Strength" value={sheet.totalPower.toFixed(0)} />
        <Total label="Divisions" value={formatDivisions(sheet.totalUnits)} />
        <Total label="Upkeep / turn" value={`-${fmt(sheet.upkeep, 1)}`} />
        <Total label="Food / turn" value={`-${fmt(sheet.foodUse, 1)}`} />
      </div>
      <p className={`text-[14px] ${sheet.combinedArms ? 'text-[#6eeb8a]' : 'text-white/70'}`}>
        {sheet.combinedArms
          ? `Combined arms: infantry, armor, and air together add ${Math.round(sheet.combinedArmsBonus * 100)}% to attack.`
          : 'Field infantry, armor, and air together (at least half a division of each) for a combined arms bonus.'}
      </p>

      <section className="inset-card p-3.5 space-y-2">
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

      <section className="space-y-3">
        {sheet.units.map((line) => (
          <UnitCard key={line.unit} line={line} />
        ))}
      </section>

      <section className="inset-card p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[16px] font-semibold">In training</div>
          <div className="text-[13px] text-white/70">
            {sheet.trainingUsed} queued · {sheet.trainingSlots} train at once
          </div>
        </div>
        {jobs.length === 0 && <p className="text-[14px] text-white/70">Nothing in training. Barracks add training slots.</p>}
        {jobs.map((j, i) => (
          <div key={j.id} className="flex items-center justify-between gap-3 text-[14px]">
            <span>
              {UNIT_SPECS[j.unit].name} <span className="text-white/70">· {i < sheet.trainingSlots ? `${j.remaining} ${j.remaining === 1 ? 'turn' : 'turns'} left` : 'waiting for a slot'}</span>
            </span>
            <OrderButton order={{ type: 'cancelTrain', nationId: player.id, jobId: j.id }} label="Cancel" tone="btn-quiet" />
          </div>
        ))}
      </section>
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
