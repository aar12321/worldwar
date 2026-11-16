import { useMemo, useState } from 'react'
import { presetPosture } from '../ai/deployment'
import { ALERT, ALERT_LEVELS, PRESENCE } from '../data/presence'
import { BORDER_LABEL } from '../data/deployment'
import { alertOf, chokeStatus, readinessOf, showCost } from '../engine/presence'
import { ledgerLines, PRESET_INFO, postureSummary, recommendPreset, theatresOf, type Preset, type Theatre } from '../engine/theatres'
import { showDivisions } from '../engine/intel'
import type { GameState, Order } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { tensionColor } from './colors'
import { globeBridge } from './globeBridge'
import { usePlayerView } from './hooks'
import { OrderButton } from './panel'
import { usePresenceUi } from './globe/presenceUi'

const { map } = getWorld()
const pct = (v: number) => `${Math.round(v * 100)}%`

const THREAT: Record<Theatre['threat'], { label: string; chip: string; shape: string }> = {
  low: { label: 'Quiet', chip: 'chip chip-green', shape: 'circle' },
  watch: { label: 'Watch', chip: 'chip', shape: 'diamond' },
  high: { label: 'Danger', chip: 'chip chip-red', shape: 'triangle' },
}

/** The Theatres desk: where the forces stand, what is changing, what they have achieved, and one-click postures. */
export function TheatresTab() {
  const view = usePlayerView()
  if (!view) return null
  return <Desk game={view.game} />
}

function Desk({ game }: { game: GameState }) {
  const player = game.nations[game.playerId]
  const issueOrder = useGame((s) => s.issueOrder)
  const setPanel = useGame((s) => s.setPanel)
  const show = usePresenceUi((s) => s.show)
  const setShow = usePresenceUi((s) => s.setShow)
  const [picked, setPicked] = useState<string | null>(null)
  const d = player.military.deployment
  const theatres = useMemo(() => theatresOf(game, map, player.id), [game, player.id])
  const rec = useMemo(() => recommendPreset(game, map, player.id), [game, player.id])
  const sum = postureSummary(game, player.id)
  const straits = useMemo(() => chokeStatus(game, map).filter((c) => c.holder || c.contested || c.power[player.id] !== undefined), [game, player.id])
  const ledger = ledgerLines(game, player.id)

  const applyPreset = (p: Preset) => {
    const want = presetPosture(game, map, player.id, p)
    const order: Order = { type: 'setDeployment', nationId: player.id, ...want }
    if (!issueOrder(order)) return
    const hot = theatres.some((t) => t.threat === 'high')
    const alert = p === 'defensive' && hot ? 'high' : 'normal'
    if (alertOf(useGame.getState().game?.nations[player.id]?.military.deployment) !== alert) issueOrder({ type: 'setAlert', nationId: player.id, alert })
  }
  const focus = (t: Theatre) => {
    setPanel('none')
    globeBridge.api?.pointOfView({ lat: t.lat, lng: t.lng, altitude: 1.4 }, 700)
  }

  return (
    <div className="space-y-3">
      <section className="inset-card p-3.5 space-y-3" aria-label="Posture">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[16px] font-semibold">Your posture</div>
          <div className="text-[12px] text-white/65">{sum.posted ? `Readiness ${Math.round(sum.readiness)} of 100` : 'Nothing on station yet'}</div>
        </div>
        {!sum.posted && <p className="text-[13px] text-[#ffd60a]">You have no forces on station. Choose a preset below, or set the posts by hand in Deployment.</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px]">
          <Stat label="Alert" value={ALERT[sum.alert].name} />
          <Stat label="Upkeep on station" value={`${sum.upkeep.toFixed(1)} a month`} />
          <Stat label="Supply" value={sum.supply.state === 'good' ? 'Good' : sum.supply.state === 'thin' ? `Thin (${sum.supply.months.toFixed(0)} months of oil)` : 'Dry'} />
          <Stat label="Oil burn" value={`${sum.oil.toFixed(1)} a month`} />
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden" role="img" aria-label={`Readiness ${Math.round(sum.readiness)} of 100`}>
          <div className="h-full bg-[#64d2ff]" style={{ width: `${Math.round(sum.readiness)}%` }} />
        </div>
        <div className="space-y-1.5">
          <div className="label">Alert level</div>
          <div className="flex flex-wrap gap-2">
            {ALERT_LEVELS.map((a) => (
              <OrderButton key={a} order={{ type: 'setAlert', nationId: player.id, alert: a }} label={ALERT[a].name} tone={sum.alert === a ? 'btn-primary' : 'btn-quiet'} />
            ))}
          </div>
          <p className="text-[12px] text-white/75">{ALERT[sum.alert].hint}</p>
          <p className="text-[12px] text-white/60">Readiness moves {PRESENCE.readyStep} points a month toward the level you set, so it cannot be raised on the day a shot is fired. High alert is harder to surprise and its garrisons fight harder; it burns more upkeep and oil.</p>
        </div>
        <div className="space-y-1.5">
          <div className="label">One-click postures</div>
          <p className="text-[13px] text-white/80">
            Advisor: <b>{PRESET_INFO[rec.preset].name}</b>. {rec.why}
          </p>
          <div className="flex flex-wrap gap-2">
            {(['defensive', 'balanced', 'forward'] as Preset[]).map((p) => (
              <button key={p} className={`btn ${rec.preset === p ? 'btn-primary' : 'btn-quiet'}`} onClick={() => applyPreset(p)} title={PRESET_INFO[p].hint} disabled={!!d && d.changed >= game.turn}>
                {PRESET_INFO[p].name}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-white/60">{PRESET_INFO[rec.preset].hint}{d && d.changed >= game.turn ? ' Forces were moved this month; they can move again next month.' : ''}</p>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show patrols, straits and fronts on the globe
        </label>
      </section>

      <TheatreMap game={game} theatres={theatres} picked={picked} onPick={setPicked} />

      <section className="space-y-2" aria-label="Theatres">
        <div className="text-[16px] font-semibold px-1">Theatres</div>
        {theatres.length === 0 && <p className="text-[13px] text-white/70 px-1">You have no neighbors.</p>}
        {theatres.map((t) => (
          <TheatreCard key={t.id} game={game} t={t} picked={picked === t.id} onPick={() => setPicked(t.id)} onFocus={() => focus(t)} />
        ))}
      </section>

      <section className="inset-card p-3.5 space-y-2" aria-label="Ledger">
        <div className="text-[16px] font-semibold">What your forces are doing and achieving</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ledger.map((l) => (
            <div key={l.key} className="inset-card py-2" title={l.hint}>
              <div className="label">{l.label}</div>
              <div className="text-[20px] font-semibold tabular-nums">{l.value}</div>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-white/60">Counted since your forces were first posted. Trade protected and enemy trade denied are money; the rest are counts.</p>
        <div className="flex flex-wrap gap-2">
          <OrderButton order={{ type: 'showOfForce', nationId: player.id, kind: 'exercise' }} label="Hold an exercise" cost={`${showCost(game, { type: 'showOfForce', nationId: player.id, kind: 'exercise' })} money`} effect="Trains the forces on station and keeps readiness up for three months." tone="btn-quiet" />
        </div>
      </section>

      <section className="inset-card p-3.5 space-y-2" aria-label="Straits">
        <div className="text-[16px] font-semibold">Straits and canals</div>
        {straits.length === 0 && <p className="text-[13px] text-white/70">No strait is held or contested. Patrols near a narrow sea hold it, and a held strait adds to your sea trade.</p>}
        {straits.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 text-[13px]">
            <span className="font-semibold">{c.name}</span>
            <span className="text-white/75">{c.holder ? (c.holder === player.id ? 'You hold it' : `Held by ${game.nations[c.holder]?.name}`) : c.contested ? 'Contested' : 'Open'}</span>
          </div>
        ))}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset-card py-2">
      <div className="label">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}

function TheatreCard({ game, t, picked, onPick, onFocus }: { game: GameState; t: Theatre; picked: boolean; onPick: () => void; onFocus: () => void }) {
  const other = game.nations[t.other]
  const me = game.nations[game.playerId]
  const d = me.military.deployment
  const th = THREAT[t.threat]
  const kind: 'ground' | 'naval' = t.kind === 'land' ? 'ground' : 'naval'
  const o: Order = { type: 'showOfForce', nationId: me.id, kind, target: t.other }
  return (
    <section className={`inset-card p-3.5 space-y-2 ${picked ? 'ring-2 ring-white/40' : ''}`} aria-label={t.name} onClick={onPick}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2 text-[14px] font-semibold">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: other.color }} />
          <span className="truncate">{t.name}</span>
          <span className={th.chip}>{th.label}</span>
          <span className="chip">{BORDER_LABEL[t.state]}</span>
        </div>
        <button className="btn btn-quiet" onClick={onFocus}>
          Show on globe
        </button>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden" role="img" aria-label={`Tension ${t.tension} of 100`}>
        <div className="h-full" style={{ width: `${t.tension}%`, background: tensionColor(t.tension) }} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[13px]">
        <Cell label="Tension" value={`${t.tension}${t.delta ? ` (${t.delta > 0 ? '+' : ''}${t.delta})` : ''}`} />
        <Cell label={t.kind === 'land' ? 'Your garrison' : 'Your patrols'} value={`${showDivisions(t.mine, true)} div`} />
        <Cell label="Theirs facing you" value={t.rival === null ? 'Unknown' : `${showDivisions(t.rival, t.rivalExact)} div`} />
        <Cell label="Cover" value={pct(t.cover)} />
      </div>
      <p className="text-[13px] text-white/80">{t.changing}</p>
      {d && !t.atWar && (
        <div className="flex flex-wrap gap-2">
          <OrderButton order={o} label={kind === 'ground' ? 'Mass troops (show of force)' : 'Send a squadron (show of force)'} cost={`${showCost(game, o as Extract<Order, { type: 'showOfForce' }>)} money`} effect="Raises tension and their dislike of you; trains your forces; they may raise their guard." tone="btn-quiet" />
        </div>
      )}
      <span className="sr-only">{th.shape} marker, readiness {Math.round(readinessOf(d))}</span>
    </section>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-white/55">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  )
}

/** A small map of the world: every country a dot in its owner's color, your theatres marked with a shape for how hot they are. */
function TheatreMap({ game, theatres, picked, onPick }: { game: GameState; theatres: Theatre[]; picked: string | null; onPick: (id: string) => void }) {
  const W = 360
  const H = 180
  const x = (lng: number) => ((lng + 180) / 360) * W
  const y = (lat: number) => ((90 - lat) / 180) * H
  const cap = map.regions[game.nations[game.playerId].capital]
  // Crop to where the theatres are (at least a 90 by 45 degree window), so they are not lost in a map of the world.
  const pts = [...theatres.map((t) => ({ lat: t.lat, lng: t.lng })), { lat: cap.lat, lng: cap.lng }]
  const lats = pts.map((p) => p.lat)
  const lngs = pts.map((p) => p.lng)
  const spanX = Math.max(90, (Math.max(...lngs) - Math.min(...lngs)) * 1.4)
  const spanY = Math.max(45, (Math.max(...lats) - Math.min(...lats)) * 1.4, spanX / 2)
  const vw = Math.min(360, Math.max(spanX, spanY * 2))
  const vh = vw / 2
  const cx0 = Math.max(0, Math.min(W - vw, x((Math.max(...lngs) + Math.min(...lngs)) / 2) - vw / 2))
  const cy0 = Math.max(0, Math.min(H - vh, y((Math.max(...lats) + Math.min(...lats)) / 2) - vh / 2))
  const k = vw / 360
  const dots = useMemo(() => map.order.map((id) => ({ id, cx: x(map.regions[id].lng), cy: y(map.regions[id].lat), color: game.nations[game.regions[id].owner]?.color ?? '#555', mine: game.regions[id].owner === game.playerId })), [game])
  return (
    <section className="inset-card p-3.5 space-y-2" aria-label="Map of theatres">
      <div className="text-[16px] font-semibold">Map of theatres</div>
      <svg viewBox={`${cx0} ${cy0} ${vw} ${vh}`} className="w-full h-auto rounded-lg bg-[#0c2342]" role="img" aria-label="World map with your theatres marked">
        {dots.map((d) => (
          <circle key={d.id} cx={d.cx} cy={d.cy} r={(d.mine ? 2.6 : 1.7) * k * 1.6} fill={d.color} opacity={d.mine ? 1 : 0.55} />
        ))}
        {theatres.map((t) => {
          const cx = x(t.lng)
          const cy = y(t.lat)
          const stroke = tensionColor(t.tension)
          const r = (4 + Math.min(5, t.mine)) * k * 0.8
          const sel = picked === t.id
          return (
            <g key={t.id} onClick={() => onPick(t.id)} style={{ cursor: 'pointer' }} role="button" aria-label={`${t.name}: ${THREAT[t.threat].label}, tension ${t.tension}`}>
              {t.threat === 'high' ? (
                <path d={`M${cx} ${cy - r} L${cx + r} ${cy + r} L${cx - r} ${cy + r} Z`} fill="none" stroke={stroke} strokeWidth={(sel ? 2.4 : 1.4) * k * 1.5} />
              ) : t.threat === 'watch' ? (
                <path d={`M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`} fill="none" stroke={stroke} strokeWidth={(sel ? 2.4 : 1.4) * k * 1.5} />
              ) : (
                <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={(sel ? 2.4 : 1.4) * k * 1.5} />
              )}
              {t.kind === 'sea' && <circle cx={cx} cy={cy} r={1.2 * k * 1.5} fill={stroke} />}
            </g>
          )
        })}
      </svg>
      <p className="text-[12px] text-white/60">Circle: quiet. Diamond: on watch. Triangle: danger. A dot inside means a sea theatre. The size shows how much of yours stands there.</p>
    </section>
  )
}
