import { useEffect, useRef, type MutableRefObject } from 'react'
import type { GlobeMethods } from 'react-globe.gl'
import { LIVE } from '../data/live'
import { clockOf, isLive } from '../engine/calendar'
import type { Army, GameState, MissileFlight, NukeFlight } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { globeBridge, useFx } from '../ui/globeBridge'
import { liveClock } from '../ui/liveClock'
import { absDay } from '../engine/calendar'
import { decalSpecs } from './decals'
import type { ArmySpec } from './armyFx'
import { fxEngine, fxRuntime } from './runtime'
import { playAlert, playLaunch, playNuke, playSalvo } from './sequences'
import { useFxPrefs } from './settings'
import { preloadArt } from '../art/MANIFEST'
import { TIMING } from './timing'
import type { FlightSpec } from './engine'

const { map } = getWorld()
const pointOf = (id: string | undefined) => (id ? map.regions[id] : undefined)

function flightSpecs(game: GameState): FlightSpec[] {
  const out: FlightSpec[] = []
  const me = game.playerId
  const add = (f: MissileFlight | NukeFlight, kind: FlightSpec['kind'], count: number) => {
    const from = pointOf(f.from)
    const to = pointOf(f.target)
    if (!from || !to) return
    const incoming = f.nationId !== me && game.regions[f.target]?.owner === me
    out.push({ id: f.id, kind, from, to, launched: f.launched, lands: f.lands, count, mine: f.nationId === me || incoming, incoming })
  }
  for (const f of game.flights ?? []) add(f, f.kind ?? 'hypersonic', f.count)
  for (const f of game.nukes ?? []) add(f, 'nuke', 1)
  return out
}

function armySpecs(game: GameState): ArmySpec[] {
  const me = game.playerId
  const out: ArmySpec[] = []
  for (const a of game.armies ?? ([] as Army[])) {
    const owner = game.nations[a.nationId]
    const threat = a.nationId !== me && a.phase === 'outbound' && game.regions[a.target]?.owner === me
    out.push({
      id: a.id,
      from: a.from,
      to: a.to,
      start: a.start,
      end: a.end,
      via: a.via,
      color: owner?.color ?? '#888888',
      mine: a.nationId === me,
      threat,
      fighting: a.phase === 'fighting',
      returning: a.phase === 'returning',
      units: a.units,
      alt: 0.05,
      arc: LIVE.arcHeight[a.via],
    })
  }
  return out
}

/**
 * The canvas laid over the globe that the effects engine paints on, plus the wiring that feeds it from the game: flights in the air,
 * marching armies, new salvo reports, nuclear strikes and the decals of recent hits. It adds no state to the game.
 */
export function FxOverlay({ globe }: { globe: MutableRefObject<GlobeMethods | undefined> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const reduced = useGame((s) => s.settings.reducedMotion)
  const palette = useGame((s) => s.settings.ui.palette)
  const quality = useFxPrefs((s) => s.quality)
  const game = useGame((s) => s.game)
  const flights = useGame((s) => s.game?.flights)
  const nukes = useGame((s) => s.game?.nukes)
  const armies = useGame((s) => s.game?.armies)
  const salvos = useGame((s) => s.game?.salvos)
  const playerId = useGame((s) => s.game?.playerId)
  const day = useGame((s) => (s.game ? Math.floor(clockOf(s.game)) : 0))
  const seenSalvos = useRef<Set<string> | null>(null)
  const seenNukes = useRef<Map<string, { lat: number; lng: number; lands: number; mine: boolean }>>(new Map())
  const lastFollow = useRef(0)
  const lastUser = useRef(0)

  // Mount: attach the loop to the canvas and the globe's camera; redraw when the camera moves; stop when the tab hides.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    preloadArt()
    fxRuntime.attach({
      canvas: el,
      camera: () => (globe.current ? (globe.current.camera() as unknown as import('./view').CameraLike) : null),
      clock: () => {
        const g = useGame.getState()
        return { t: g.game && isLive(g.game) ? liveClock.t : g.game ? clockOf(g.game) : 0, running: !!g.game && isLive(g.game) && g.running }
      },
    })
    const onVis = () => fxRuntime.visibility()
    const onResize = () => fxRuntime.wake()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', onResize)
    // The camera: any move wakes the loop for one still frame (the globe's own controls fire `change`).
    let controls: ReturnType<GlobeMethods['controls']> | null = null
    const onChange = () => fxRuntime.wake()
    const onStart = () => {
      lastUser.current = performance.now()
    }
    const bind = window.setInterval(() => {
      const api = globe.current
      if (!api || controls) return
      controls = api.controls()
      controls.addEventListener('change', onChange)
      controls.addEventListener('start', onStart)
      window.clearInterval(bind)
    }, 200)
    fxEngine.onShake = (s) => useFx.getState().shake(Math.min(1.6, s))
    fxEngine.onAction = (lat, lng, importance) => {
      const api = globeBridge.api
      const now = performance.now()
      if (!api || !useFxPrefs.getState().follow || importance < 0.5) return
      if (now - lastFollow.current < TIMING.followCooldown || now - lastUser.current < 8000) return
      if (useGame.getState().fxQueue.length) return
      lastFollow.current = now
      const pov = api.pointOfView()
      api.pointOfView({ lat, lng, altitude: Math.min(pov.altitude, 1.5) }, useGame.getState().settings.reducedMotion ? 0 : TIMING.camera)
    }
    fxEngine.onLaunch = (rt, s) => {
      if (rt.kind === 'nuke') return
      playLaunch(fxEngine, s.kind, s.from)
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', onResize)
      window.clearInterval(bind)
      if (controls) {
        controls.removeEventListener('change', onChange)
        controls.removeEventListener('start', onStart)
      }
      fxEngine.onShake = null
      fxEngine.onAction = null
      fxEngine.onLaunch = null
      fxRuntime.detach()
    }
  }, [globe])

  useEffect(() => {
    fxRuntime.setReduced(reduced)
  }, [reduced, quality])
  useEffect(() => {
    fxEngine.colorblind = palette === 'colorblind'
    fxEngine.alertColor = palette === 'colorblind' ? '#ff9f0a' : '#ff453a'
  }, [palette])

  // Missiles in the air.
  useEffect(() => {
    if (!game) {
      fxEngine.syncFlights([])
      return
    }
    const g = useGame.getState().game
    if (!g) return
    // A warhead that left the list on the day it was due has landed: the strike plays where it fell.
    const now = clockOf(g)
    const present = new Set((g.nukes ?? []).map((n) => n.id))
    for (const [id, n] of seenNukes.current) {
      if (!present.has(id)) {
        if (n.lands <= now + 0.01) playNuke(fxEngine, n, { mine: n.mine })
        seenNukes.current.delete(id)
      }
    }
    for (const n of g.nukes ?? []) {
      const to = pointOf(n.target)
      if (!to) continue
      if (!seenNukes.current.has(n.id)) {
        const incoming = n.nationId !== g.playerId && g.regions[n.target]?.owner === g.playerId
        if (incoming) playAlert(fxEngine, to)
        seenNukes.current.set(n.id, { lat: to.lat, lng: to.lng, lands: n.lands, mine: incoming || n.nationId === g.playerId })
      }
    }
    fxEngine.syncFlights(flightSpecs(g))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flights, nukes, playerId, !!game])

  useEffect(() => {
    const g = useGame.getState().game
    fxEngine.armies.sync(g && isLive(g) ? armySpecs(g) : [])
    fxEngine.touch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armies, playerId])

  // New salvo reports: defence, impacts, shake. The first look at a game only remembers what is already there.
  useEffect(() => {
    if (seenSalvos.current === null) {
      seenSalvos.current = new Set((salvos ?? []).map((r) => r.id))
      return
    }
    if (!salvos) return
    const g = useGame.getState().game
    const fresh = salvos.filter((r) => !seenSalvos.current!.has(r.id))
    for (const r of fresh) seenSalvos.current.add(r.id)
    if (!g) return
    for (const r of fresh.slice(-6)) {
      const to = pointOf(r.region)
      if (!to) continue
      playSalvo(fxEngine, {
        id: r.id,
        kind: r.kind ?? 'cruise',
        raid: r.weapon === 'raid',
        from: pointOf(r.origin),
        to,
        fired: r.fired,
        hit: r.hit,
        stopped: r.fired > 0 ? Math.min(1, r.shield + r.batteries + r.fighters + r.patrol) : 0,
        air: r.fighters + r.patrol > r.shield + r.batteries,
        live: r.day !== undefined,
        mine: r.from === g.playerId || r.to === g.playerId,
        factories: r.factories || r.site,
        dead: r.dead,
        colorblind: palette === 'colorblind',
      })
    }
  }, [salvos, palette, game])

  // Scorch, embers, smoke and fires from recent hits, fading with the days.
  useEffect(() => {
    fxEngine.setDecals(decalSpecs(salvos, day ? day : game ? absDay(game.turn, 0) : 0, map.regions))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salvos, day, quality])

  return <canvas ref={canvas} className="fx-overlay" aria-hidden data-fx-overlay />
}
