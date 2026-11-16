import { useMemo, useState } from 'react'
import { plannedPosture } from '../ai/deployment'
import { BORDER_LABEL, STATION } from '../data/deployment'
import { bordersOf, type BorderKind, type BorderView } from '../engine/borders'
import { airPatrolStop, borderCover, garrisonDivisions, interception, patrolCover } from '../engine/deployment'
import { threatWatch, type Threat } from '../engine/threats'
import { deploymentView, showDivisions } from '../engine/intel'
import { forceUnits, formatDivisions, totalUnits } from '../engine/helpers'
import type { Deployment, GameState, NationId } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { tensionColor } from './colors'
import { OrderButton } from './panel'

const STATE_CHIP: Record<BorderKind, string> = { open: 'chip chip-green', fortified: 'chip chip-blue', closed: 'chip', disputed: 'chip chip-red' }


interface Draft {
  coastal: number
  subs: number
  air: number
  border: Record<NationId, number>
}

const fromDeployment = (d: Deployment | undefined): Draft => ({ coastal: d?.coastal ?? 0, subs: d?.subs ?? 0, air: d?.air ?? 0, border: { ...(d?.border ?? {}) } })
const pct = (v: number) => `${Math.round(v * 100)}%`
const sameDraft = (a: Draft, b: Draft) => a.coastal === b.coastal && a.subs === b.subs && a.air === b.air && [...new Set([...Object.keys(a.border), ...Object.keys(b.border)])].every((k) => (a.border[k] ?? 0) === (b.border[k] ?? 0))

function Slider({ label, hint, value, max, onChange, detail }: { label: string; hint: string; value: number; max: number; onChange: (v: number) => void; detail: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-white/80">
          {pct(value)} <span className="text-white/60">· {detail}</span>
        </span>
      </div>
      <input type="range" className="w-full" min={0} max={Math.round(max * 100)} step={5} value={Math.round(value * 100)} onChange={(e) => onChange(Math.min(max, +e.target.value / 100))} aria-label={label} />
      <p className="text-[12px] text-white/60">{hint}</p>
    </div>
  )
}

/** The Deployment tab: post warships, fighters and ground troops on station, and watch the borders. */
export function DeploymentTab() {
  const view = usePlayerView()
  if (!view) return null
  const d = view.player.military.deployment
  // A fresh draft whenever the posture really changes (after Apply, an undo, or a new month).
  return <Editor key={`${view.player.id}|${d ? JSON.stringify(d) : 'none'}`} game={view.game} />
}

function Editor({ game }: { game: GameState }) {
  const { map } = getWorld()
  const player = game.nations[game.playerId]
  const orders = useGame((s) => s.orders)
  const live = player.military.deployment
  const [draft, setDraft] = useState<Draft>(() => fromDeployment(live))
  const force = forceUnits(game, player.id)
  const navy = force.naval
  const air = force.fighter + force.drone
  const ground = force.infantry + force.armor + force.artillery + force.robot
  const borders = useMemo(() => bordersOf(game, map, player.id).sort((a, b) => b.tension - a.tension || (a.other < b.other ? -1 : 1)), [game, map, player.id])
  const threats = useMemo(() => threatWatch(game, map, player.id), [game, map, player.id])
  const landNeighbors = useMemo(() => borders.filter((b) => b.land), [borders])
  const groundUsed = Object.values(draft.border).reduce((t, v) => t + v, 0)
  const dirty = !sameDraft(draft, fromDeployment(live))
  const lockedBy = live && live.changed >= game.turn

  // What the draft would do, worked out on a copy of the game with the draft in place.
  const projected = useMemo(() => {
    const posted: Deployment = { coastal: draft.coastal, subs: draft.subs, air: draft.air, border: draft.border, changed: game.turn }
    const g: GameState = { ...game, nations: { ...game.nations, [player.id]: { ...player, military: { ...player.military, deployment: posted } } } }
    const cover = patrolCover(g, player.id)
    const sample = { ...forceUnits(g, player.id) }
    const typical = Math.max(1, totalUnits(sample) * 0.5)
    return {
      cover,
      lane: interception(g, player.id, 'lane', { ...sample, infantry: typical }).share,
      fleet: interception(g, player.id, 'fleet', { ...sample, infantry: typical }).share,
      airborne: interception(g, player.id, 'air', { ...sample, infantry: typical }).share,
      cruise: airPatrolStop(g, player.id, 'cruise'),
      covers: landNeighbors.map((b) => ({ id: b.other, cover: borderCover(g, map, player.id, b.other), divisions: garrisonDivisions(g, player.id, b.other) })),
    }
  }, [draft, game, map, player, landNeighbors])

  const setSea = (key: 'coastal' | 'subs', v: number) => setDraft((p) => ({ ...p, [key]: Math.min(v, 1 - (key === 'coastal' ? p.subs : p.coastal)) }))
  const setBorder = (x: NationId, v: number) =>
    setDraft((p) => {
      const rest = Object.entries(p.border).reduce((t, [k, val]) => (k === x ? t : t + val), 0)
      const border = { ...p.border }
      const next = Math.min(v, 1 - rest)
      if (next > 0) border[x] = Math.round(next * 100) / 100
      else delete border[x]
      return { ...p, border }
    })
  const auto = () => {
    const p = plannedPosture(game, map, player.id, 2)
    setDraft({ coastal: p.coastal, subs: p.subs, air: p.air, border: { ...p.border } })
  }
  const order = { type: 'setDeployment' as const, nationId: player.id, coastal: draft.coastal, subs: draft.subs, air: draft.air, border: draft.border }
  const postedDivisions = navy * (draft.coastal + draft.subs) + air * draft.air + ground * Math.min(1, groundUsed)
  const reserveDivisions = Math.max(0, totalUnits(force) - postedDivisions)

  return (
    <div className="space-y-5">
      <p className="text-[14px] text-white/80">
        Every nation keeps forces on station: warships on patrol and in a submarine screen, fighters and drones in the air, and troops on each border. What stands on station <strong>cannot attack</strong> (only the reserve can), still costs its upkeep and oil, and still defends: a garrison fights at +{Math.round(STATION.postBonus * 100)}% on its own border and at half strength on any other front; patrols fight at +{Math.round(STATION.seaPostBonus * 100)}% against a landing from the sea or air.
      </p>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Total label="On station" value={formatDivisions(postedDivisions)} sub="divisions" />
        <Total label="Reserve" value={formatDivisions(reserveDivisions)} sub="free to attack" />
        <Total label="Whole force" value={formatDivisions(totalUnits(force))} sub="home and abroad" />
      </div>

      <section className="inset-card p-3.5 space-y-4" aria-label="Stations">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[16px] font-semibold">Stations</div>
          <div className="flex gap-2">
            <button className="btn btn-quiet px-3 py-1 text-[13px]" onClick={auto} title="Fill in the posture a careful government would keep: garrisons where the danger is, patrols along the coast">
              Auto-station
            </button>
            <button className="btn btn-quiet px-3 py-1 text-[13px]" onClick={() => setDraft({ coastal: 0, subs: 0, air: 0, border: {} })} title="Bring everything back to the reserve">
              All to reserve
            </button>
          </div>
        </div>

        <Slider
          label="Coastal patrol"
          hint={`Warships in your waters. They meet a landing across a sea lane and sink part of it before it comes ashore.${navy < 0.5 ? ' You have almost no warships: train some at a port.' : ''}`}
          value={draft.coastal}
          max={1 - draft.subs}
          onChange={(v) => setSea('coastal', v)}
          detail={`${formatDivisions(navy * draft.coastal)} of ${formatDivisions(navy)} warships`}
        />
        <Slider
          label="Submarine screen"
          hint="Warships kept under the surface across your approaches. Best against a fleet crossing the open ocean, and they notice who enters your waters."
          value={draft.subs}
          max={1 - draft.coastal}
          onChange={(v) => setSea('subs', v)}
          detail={`${formatDivisions(navy * draft.subs)} warships`}
        />
        <Slider
          label="Air patrol"
          hint={`Fighters and drones over your coast. Best against a landing from the air, and they shoot down part of every cruise missile salvo.${air < 0.5 ? ' You have almost no fighters.' : ''}`}
          value={draft.air}
          max={1}
          onChange={(v) => setDraft((p) => ({ ...p, air: v }))}
          detail={`${formatDivisions(air * draft.air)} of ${formatDivisions(air)} aircraft`}
        />

        <div className="space-y-3 pt-1">
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="font-semibold">Border garrisons</span>
            <span className="tabular-nums text-white/70">
              {pct(groundUsed)} of {formatDivisions(ground)} ground divisions
            </span>
          </div>
          {landNeighbors.length === 0 && <p className="text-[13px] text-white/70">You have no land borders. Your neighbors are across the sea: patrols and the submarine screen guard them.</p>}
          {landNeighbors.map((b) => {
            const info = projected.covers.find((c) => c.id === b.other)
            return (
              <div key={b.other} className="space-y-1">
                <Slider
                  label={game.nations[b.other].name}
                  hint={`${b.fronts} of your ${b.fronts === 1 ? 'country lies' : 'countries lie'} along it. ${b.state === 'disputed' ? 'This border is disputed. ' : ''}A full guard is about ${(STATION.fullPerRegion * b.fronts).toFixed(1)} divisions.`}
                  value={draft.border[b.other] ?? 0}
                  max={Math.max(0, 1 - (groundUsed - (draft.border[b.other] ?? 0)))}
                  onChange={(v) => setBorder(b.other, v)}
                  detail={`${formatDivisions(info?.divisions ?? 0)} divisions · cover ${pct(info?.cover ?? 0)}`}
                />
              </div>
            )
          })}
        </div>

        <div className="rounded-xl bg-white/6 p-3 text-[13px] text-white/80 space-y-1">
          <div className="font-semibold text-white">What this posture does</div>
          <div>
            Against a landing across a sea lane: sinks about {pct(projected.lane)} of it. Across the open ocean: {pct(projected.fleet)}. From the air: {pct(projected.airborne)}.
          </div>
          <div>Air patrols shoot down about {pct(projected.cruise)} of a cruise missile salvo.</div>
          <div>Each garrison adds Defense Line to the countries along its border, and a border you guard well is hard to surprise in the first months of a war.</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <OrderButton
            order={order}
            label={dirty ? 'Post these forces' : 'Posture is in place'}
            effect={lockedBy ? 'Forces were moved this month; they can move again next month.' : dirty ? 'Takes effect at once. They can move again next month.' : undefined}
            tone="btn-primary"
            className={dirty ? '' : 'opacity-60'}
          />
          {live && <span className="text-[12px] text-white/60">Last moved in month {live.changed}.</span>}
        </div>
        {orders.some((o) => o.type === 'setDeployment') && <p className="text-[12px] text-white/60">A move is already waiting.</p>}
        {!live && <p className="text-[12px] text-[#ffd60a]">You have no posture yet. Until you set one, you have no garrison bonus and no weak spot: all your forces stand as a single reserve.</p>}
      </section>

      <ThreatWatch game={game} threats={threats} />

      <section className="inset-card p-3.5 space-y-3" aria-label="Borders">
        <div className="text-[16px] font-semibold">Borders</div>
        {borders.length === 0 && <p className="text-[13px] text-white/70">You have no neighbors.</p>}
        {borders.map((b) => (
          <BorderRow key={b.other} game={game} b={b} />
        ))}
      </section>
    </div>
  )
}

function ThreatWatch({ game, threats }: { game: GameState; threats: Threat[] }) {
  return (
    <section className="inset-card p-3.5 space-y-2" aria-label="Threat watch">
      <div className="text-[16px] font-semibold">Threat watch</div>
      {threats.length === 0 && <p className="text-[13px] text-white/70">Nobody at war with you, or on edge with you, can reach your coast or your borders today.</p>}
      {threats.map((t) => (
        <div key={`${t.nation}|${t.route}`} className="flex items-start justify-between gap-3 text-[14px]">
          <div className="min-w-0">
            <div className="font-semibold">
              <span className="w-2 h-2 rounded-full inline-block mr-1.5" style={{ background: game.nations[t.nation]?.color }} />
              {game.nations[t.nation]?.name}
              <span className={`chip ml-2 ${t.level === 'high' ? 'chip-red' : ''}`}>{t.level === 'high' ? 'Danger' : 'Watch'}</span>
            </div>
            <div className="text-[13px] text-white/75">{t.text}</div>
          </div>
        </div>
      ))}
    </section>
  )
}

function BorderRow({ game, b }: { game: GameState; b: BorderView }) {
  const player = game.playerId
  const other = game.nations[b.other]
  const view = deploymentView(game, player, b.other)
  const theirs = b.land ? (view.exact ? b.theirDivisions : (view.border[player] ?? 0)) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2 text-[14px] font-semibold">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: other.color }} />
          <span className="truncate">{other.name}</span>
          <span className={STATE_CHIP[b.state]}>{BORDER_LABEL[b.state]}</span>
          <span className="chip">{b.land ? 'Land' : 'Sea'}</span>
        </div>
        <div className="tabular-nums text-[13px] text-white/80">{b.tension}</div>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden" role="img" aria-label={`Tension ${b.tension} of 100`}>
        <div className="h-full" style={{ width: `${b.tension}%`, background: tensionColor(b.tension) }} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-[12px] text-white/65">
        <span>{b.parts.map((p) => `${p.label} ${p.value > 0 ? '+' : ''}${p.value}`).join(' · ')}</span>
      </div>
      {b.land && (
        <div className="text-[12px] text-white/75">
          Yours: {formatDivisions(b.mineDivisions)} divisions, cover {pct(b.mineCover)}. Theirs: {theirs > 0 ? `${showDivisions(theirs, view.exact)} facing you` : view.posted ? 'none facing you' : view.exact ? 'no posture' : 'unknown'}
          {view.exact ? '' : ' (a guess: send the agency for the exact numbers)'}.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {b.closedByMe ? (
          <OrderButton order={{ type: 'setBorder', nationId: player, neighbor: b.other, closed: false }} label="Reopen the border" tone="btn-quiet" />
        ) : (
          <OrderButton
            order={{ type: 'setBorder', nationId: player, neighbor: b.other, closed: true }}
            label="Close the border"
            cost={`${STATION.closeCost} influence`}
            effect="Fewer provocations and stronger cover, but it adds to the tension and they will not like it."
            tone="btn-quiet"
          />
        )}
        {b.closedByThem && <span className="chip">They closed it too</span>}
      </div>
    </div>
  )
}

function Total({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="inset-card py-2.5">
      <div className="label">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-white/65 px-1">{sub}</div>}
    </div>
  )
}
