import { useMemo } from 'react'
import { AIRCRAFT_BRANCHES, AIRCRAFT_BRANCH_IDS, AIRCRAFT_EFFECT_TEXT, AIRCRAFT_IDS, AIRCRAFT_NODES, AIRCRAFT_RULES, aircraftLines, type AircraftBranch, type AircraftEffectKey, type AircraftNodeId } from '../data/aircraft'
import { tierSpec } from '../data/empire'
import { MISSILES, MISSILE_TYPES } from '../data/missiles'
import { TECH_BY_ID } from '../data/techTree'
import { activeDevs, aircraftEffects, aircraftPace, devDone, devSlots, devView, finishedDevs, huntCover, type DevView } from '../engine/aircraft'
import { hasTech } from '../engine/helpers'
import { projectSpeed } from '../engine/industry'
import { militarySheet, type MilitarySheet } from '../engine/militaryStats'
import { getsThrough } from '../engine/missiles'
import { tierOf } from '../engine/empire'
import type { GameState, Nation, UnitType } from '../engine/types'
import { useGame } from '../store'
import { fmt, usePlayerView } from './hooks'
import { UnitIcon } from './icons'
import { Bar } from './kit'
import { Modal } from './Modal'
import { OrderButton } from './panel'

const UNITS: UnitType[] = ['fighter', 'air', 'drone']
const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`

const STATUS: Record<DevView['status'], { label: string; tone: string }> = {
  done: { label: 'Developed', tone: 'bg-[#30d158]/20 text-[#6eeb8a]' },
  active: { label: 'In progress', tone: 'bg-[#0a84ff]/25 text-[#8ec5ff]' },
  paused: { label: 'On hold', tone: 'bg-[#ff9f0a]/20 text-[#ffb340]' },
  ready: { label: 'Ready', tone: 'bg-white/12 text-white/85' },
  locked: { label: 'Locked', tone: 'bg-white/8 text-white/55' },
}

/** The stat sheet as it would be with one more development finished, so a card can say what it changes. Shallow copies only. */
function previewSheet(game: GameState, nation: Nation, id: AircraftNodeId): MilitarySheet {
  const after: Nation = { ...nation, aircraft: { ...nation.aircraft, [id]: { progress: AIRCRAFT_NODES[id].months, done: true } } }
  return militarySheet({ ...game, nations: { ...game.nations, [nation.id]: after } }, nation.id)
}

function StatDelta({ now, next }: { now: MilitarySheet; next: MilitarySheet }) {
  const rows = UNITS.map((u) => {
    const a = now.units.find((l) => l.unit === u)!
    const b = next.units.find((l) => l.unit === u)!
    return { unit: u, name: a.name, a, b, atk: b.attack - a.attack > 1e-9, def: b.defense - a.defense > 1e-9 }
  }).filter((r) => r.atk || r.def)
  if (rows.length === 0) return null
  return (
    <ul className="text-[12px] text-white/70 space-y-0.5" aria-label="Changes to the stat sheet">
      {rows.map((r) => (
        <li key={r.unit} className="tabular-nums">
          <span className="text-white/85">{r.name}</span>
          {r.atk && <span> · attack {r.a.attack.toFixed(2)} → <b className="text-[#6eeb8a]">{r.b.attack.toFixed(2)}</b></span>}
          {r.def && <span> · defense {r.a.defense.toFixed(2)} → <b className="text-[#6eeb8a]">{r.b.defense.toFixed(2)}</b></span>}
        </li>
      ))}
    </ul>
  )
}

function Need({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] ${ok ? 'bg-[#30d158]/15 text-[#6eeb8a]' : 'bg-white/8 text-white/65'}`}>
      <span aria-hidden>{ok ? '✓' : '○'}</span>
      <span className="sr-only">{ok ? 'Done: ' : 'Missing: '}</span>
      {children}
    </li>
  )
}

function NodeCard({ id, now, color }: { id: AircraftNodeId; now: MilitarySheet; color: string }) {
  const view = usePlayerView()!
  const { game, player, econ } = view
  const node = AIRCRAFT_NODES[id]
  const dev = devView(game, player, id, projectSpeed(player, econ.coverage.engineers))
  const st = STATUS[dev.status]
  const lines = aircraftLines(node.effects)
  const preview = useMemo(() => (dev.status === 'done' ? null : previewSheet(game, player, id)), [game, player, id, dev.status])
  const perMonth = node.money / node.months
  const techOk = hasTech(player, node.tech)
  const tierOk = (player.tier ?? 1) >= node.tier
  return (
    <article className={`inset-card p-3.5 space-y-2.5 ${dev.status === 'locked' ? 'opacity-80' : ''} ${dev.status === 'done' ? 'ring-1 ring-[#30d158]/30' : dev.status === 'active' ? 'ring-1 ring-[#0a84ff]/50' : ''}`} aria-label={node.name} data-node={id} data-status={dev.status}>
      <header className="flex items-start justify-between gap-2">
        <h4 className="text-[15px] font-semibold tracking-tight leading-snug" style={{ color }}>
          {node.name}
        </h4>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.tone}`}>{st.label}</span>
      </header>
      <p className="text-[13px] text-white/75">{node.blurb}</p>
      <ul className="space-y-0.5 text-[13px]" aria-label="What it does">
        {lines.map((l) => (
          <li key={l} className={dev.status === 'done' ? 'text-[#6eeb8a]' : 'text-white/90'}>
            {dev.status === 'done' ? '✓ ' : '+ '}
            {l}
          </li>
        ))}
      </ul>
      {preview && <StatDelta now={now} next={preview} />}

      {dev.status === 'done' ? null : (
        <>
          <div className="text-[12px] text-white/70 tabular-nums">
            {fmt(node.money)} money over about {node.months} months (about {fmt(perMonth, 1)} a month) · {node.tp} research to begin
          </div>
          {(dev.status === 'ready' || dev.status === 'locked') && (
            <ul className="flex flex-wrap gap-1" aria-label="What it needs">
              {node.requires.map((r) => (
                <Need key={r} ok={devDone(player, r)}>
                  {AIRCRAFT_NODES[r].name}
                </Need>
              ))}
              <Need ok={techOk}>{TECH_BY_ID[node.tech]?.name ?? node.tech}</Need>
              {node.tier > 1 && (
                <Need ok={tierOk}>
                  {tierSpec(node.tier).name} ({tierSpec(node.tier).countries} countries)
                </Need>
              )}
            </ul>
          )}
        </>
      )}

      {(dev.status === 'active' || dev.status === 'paused') && (
        <div className="space-y-1">
          <Bar value={dev.progress / node.months} color={dev.status === 'paused' ? '#ff9f0a' : color} label={`${node.name} progress`} />
          <div className="flex justify-between text-[12px] text-white/75 tabular-nums">
            <span>
              {dev.progress.toFixed(1)} of {node.months} months
            </span>
            <span>{dev.status === 'paused' ? 'On hold: no cost, slot free' : `${dev.monthsLeft} month${dev.monthsLeft === 1 ? '' : 's'} left`}</span>
          </div>
        </div>
      )}

      {dev.status === 'active' && <OrderButton order={{ type: 'pauseAircraftDev', nationId: player.id, node: id, paused: true }} label="Pause" effect="Frees the slot and stops the monthly cost. Progress is kept." className="w-full" />}
      {dev.status === 'paused' && <OrderButton order={{ type: 'pauseAircraftDev', nationId: player.id, node: id, paused: false }} label="Resume" effect="Takes a slot and the monthly cost again." tone="btn-primary" className="w-full" />}
      {(dev.status === 'ready' || dev.status === 'locked') && (
        <OrderButton
          order={{ type: 'startAircraftDev', nationId: player.id, node: id }}
          label="Start development"
          cost={`${node.tp} research`}
          effect={`${fmt(node.money)} money over ${node.months} months, paid month by month`}
          tone="btn-primary"
          className="w-full"
        />
      )}
    </article>
  )
}

function Branch({ branch, now }: { branch: AircraftBranch; now: MilitarySheet }) {
  const spec = AIRCRAFT_BRANCHES[branch]
  const ids = AIRCRAFT_IDS.filter((id) => AIRCRAFT_NODES[id].branch === branch)
  const view = usePlayerView()!
  const done = ids.filter((id) => devDone(view.player, id)).length
  return (
    <section className="space-y-3 min-w-0" aria-label={spec.name}>
      <div className="border-l-4 pl-3 xl:min-h-[92px]" style={{ borderColor: spec.color }}>
        <h3 className="text-[17px] font-semibold tracking-tight">{spec.name}</h3>
        <p className="text-[13px] text-white/70">{spec.role}</p>
        <p className="text-[12px] text-white/55 tabular-nums">
          {done} of {ids.length} developed
        </p>
      </div>
      <div className="space-y-3">
        {ids.map((id) => (
          <NodeCard key={id} id={id} now={now} color={spec.color} />
        ))}
      </div>
    </section>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="inset-card py-2.5 px-2 text-center">
      <div className="label">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-white/65 px-1">{sub}</div>}
    </div>
  )
}

const ABILITY_KEYS: AircraftEffectKey[] = ['hunt', 'pierce', 'jam', 'bomberFloor', 'airRange', 'landing', 'bomberLine', 'droneEvade', 'speed']

/** The air arm as battles see it: the same attack and defense the stat sheet shows, plus what the developments add beyond it. */
function AirArm({ sheet }: { sheet: MilitarySheet }) {
  const view = usePlayerView()!
  const { player } = view
  const fx = aircraftEffects(player)
  const fighters = player.military.units.fighter
  const shield = player.systems?.shield ?? 0
  const cover = huntCover(fx, fighters)
  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" aria-label="Your air arm">
      <div className="inset-card p-3.5 space-y-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[16px] font-semibold">Your air arm</h3>
          <span className="text-[12px] text-white/60">The same numbers battles use</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {UNITS.map((u) => {
            const l = sheet.units.find((x) => x.unit === u)!
            return (
              <div key={u} className="rounded-xl bg-white/6 p-2 text-center" data-unit={u}>
                <div className="flex items-center justify-center gap-1.5 text-[13px] text-white/85">
                  <UnitIcon unit={u} size={16} />
                  {l.name}
                </div>
                <div className="text-[12px] text-white/60 tabular-nums">{l.count.toFixed(1)} divisions</div>
                <div className="mt-1 text-[13px] tabular-nums">
                  Attack <b className="text-[16px]" data-stat="attack">{l.attack.toFixed(2)}</b>
                </div>
                <div className="text-[13px] tabular-nums">
                  Defense <b className="text-[16px]" data-stat="defense">{l.defense.toFixed(2)}</b>
                </div>
                <div className="text-[11px] text-white/55 tabular-nums">
                  base {l.baseAttack} / {l.baseDefense} · {pct(l.attack / l.baseAttack - 1)} / {pct(l.defense / l.baseDefense - 1)}
                </div>
              </div>
            )
          })}
        </div>
        <details className="text-[13px]">
          <summary className="cursor-pointer text-white/75">Where the bonuses come from</summary>
          <ul className="mt-2 space-y-1">
            {UNITS.flatMap((u) => sheet.units.find((x) => x.unit === u)!.sources.filter((src) => src.kind === 'aircraft' || src.kind === 'tech').map((src) => ({ u, src }))).map(({ u, src }) => (
              <li key={`${u}-${src.label}`} className="flex justify-between gap-3 text-white/80">
                <span>
                  {sheet.units.find((x) => x.unit === u)!.name}: {src.label}
                </span>
                <span className="tabular-nums text-white/70">
                  ATK {pct(src.attack)} · DEF {pct(src.defense)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="inset-card p-3.5 space-y-2.5">
        <h3 className="text-[16px] font-semibold">What your developments add</h3>
        {fx ? (
          <ul className="space-y-0.5 text-[13px] text-[#6eeb8a]">
            {ABILITY_KEYS.filter((k) => fx[k] > 0).map((k) => (
              <li key={k}>✓ {AIRCRAFT_EFFECT_TEXT[k](fx[k])}</li>
            ))}
            {ABILITY_KEYS.every((k) => fx[k] <= 0) && <li className="text-white/65">Only better planes so far: see the numbers on the left.</li>}
          </ul>
        ) : (
          <p className="text-[13px] text-white/70">Nothing developed yet. Pick a development below.</p>
        )}
        <div className="space-y-1 pt-1">
          <div className="text-[13px] font-semibold">How much of a missile salvo gets through to you</div>
          <p className="text-[12px] text-white/65">
            Your shield is level {shield}. Missile hunters need fighters at home: you have {fighters.toFixed(1)}, and {AIRCRAFT_RULES.huntWing} cover everything{fx && fx.hunt > 0 ? ` (they stop up to ${Math.round(cover * 100)}% of a flight now)` : ''}.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-[13px] tabular-nums">
            {MISSILE_TYPES.map((k) => {
              const base = getsThrough(shield, k)
              const air = getsThrough(shield, k, fx ? { defender: fx, fighters } : undefined)
              return (
                <li key={k} className="flex justify-between gap-2" data-missile={k}>
                  <span className="text-white/80">{MISSILES[k].name}</span>
                  <span>
                    {Math.round(air * 100)}%{air < base - 1e-9 && <span className="text-[#6eeb8a]"> (was {Math.round(base * 100)}%)</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}

/** The large Develop screen: a tree of aircraft developments in four branches. Opened from Military, Forces. */
export function AircraftDev() {
  const view = usePlayerView()
  const setOpen = useGame((s) => s.setAircraftOpen)
  const sheet = useMemo(() => (view ? militarySheet(view.game, view.player.id) : null), [view])
  if (!view || !sheet) return null
  const { player, econ } = view
  const slots = devSlots(player)
  const active = activeDevs(player)
  const pace = aircraftPace(player, projectSpeed(player, econ.coverage.engineers))
  const done = finishedDevs(player).length
  const close = () => setOpen(false)
  return (
    <Modal
      title="Aircraft development"
      kicker={`Fighters, bombers and drones · ${tierOf(player).name}`}
      onClose={close}
      huge
      tone="#6cb4ff"
      footer={
        <button className="btn px-5 py-2.5 text-[15px]" data-autofocus onClick={close}>
          Close
        </button>
      }
    >
      <div className="space-y-5">
        <p className="text-[14px] text-white/80 max-w-[90ch]">
          Each development takes months of work and money every month, and the research is paid when you begin. Nodes open in order within a branch, and the empire tier gates the stronger ones. A paused development gives up its slot and costs nothing.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Summary">
          <Tile label="In hand" value={`${active.length} of ${slots}`} sub={`A ${tierOf(player).name} runs ${slots} at once`} />
          <Tile label="Developed" value={`${done} of ${AIRCRAFT_IDS.length}`} />
          <Tile label="Money a month" value={`-${fmt(econ.aircraftBill, 1)}`} sub={active.length ? 'For work in hand' : 'Nothing under way'} />
          <Tile label="Engineers' pace" value={`${Math.round(pace * 100)}%`} sub="Of a normal month's work" />
        </div>
        <AirArm sheet={sheet} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {AIRCRAFT_BRANCH_IDS.map((b) => (
            <Branch key={b} branch={b} now={sheet} />
          ))}
        </div>
      </div>
    </Modal>
  )
}
