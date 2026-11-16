import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import type { GlobeMethods } from 'react-globe.gl'
import { getWorld } from '../../map/world'
import type { GameState } from '../../engine/types'
import { EMPTY_PRESENCE, presenceLayer, presenceSignature, type Lod, type PresenceData, type PresenceGlyph, type PresenceMarker } from './presenceLayer'
import { usePresenceUi } from './presenceUi'

const { map } = getWorld()

/** How close the camera is, as one of three steps. Only a change of step re-renders the globe. */
export function useGlobeLod(ref: MutableRefObject<GlobeMethods | undefined>, active: boolean): Lod {
  const [lod, setLod] = useState<Lod>(1)
  useEffect(() => {
    const api = ref.current
    if (!api || !active) return
    const controls = api.controls()
    const read = () => {
      const pov = api.pointOfView()
      if (!pov) return
      const next: Lod = pov.altitude > 2.3 ? 0 : pov.altitude > 1.2 ? 1 : 2
      setLod((prev) => (prev === next ? prev : next))
    }
    let frame = 0
    const onChange = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(read)
    }
    controls.addEventListener('change', onChange)
    read()
    return () => {
      cancelAnimationFrame(frame)
      controls.removeEventListener('change', onChange)
    }
  }, [ref, active])
  return lod
}

/** The persistent military picture for the globe: the lines, badges and rings, rebuilt only when something that shows has changed. */
export function usePresenceLayer(ref: MutableRefObject<GlobeMethods | undefined>, game: GameState | null, palette: 'standard' | 'colorblind', reduced: boolean): PresenceData {
  const show = usePresenceUi((s) => s.show)
  const lod = useGlobeLod(ref, show && !!game)
  const active = !!game && show && game.outcome !== 'victory'
  const key = active ? `${presenceSignature(game, lod)}|${palette}|${reduced}|${game.playerId}` : ''
  // Rebuilt only when what shows has changed, not on every tick of a live game.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (active ? presenceLayer(game, map, game.playerId, lod, palette, !reduced) : EMPTY_PRESENCE), [key])
}

const GLYPHS: Record<PresenceGlyph, string> = {
  ship: '<path d="M3 15l2 4h14l2-4zM12 4v8M12 5l6 6h-6" />',
  sub: '<ellipse cx="12" cy="14" rx="9" ry="4" /><path d="M9 10h5l1 4M12 10V6h3" />',
  air: '<path d="M12 3l2 7 8 4v2l-8-2-1 5 3 2v1l-4-1-4 1v-1l3-2-1-5-8 2v-2l8-4z" />',
  guard: '<path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6z" />',
  choke: '<path d="M4 9h16M4 15h16M9 5v14M15 5v14" />',
  front: '<path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" stroke="#14171c" />',
  supply: '<rect x="4" y="9" width="16" height="6" rx="1" />',
  base: '<path d="M12 21V8M7 12a5 5 0 0 0 10 0M8 7h8M12 3v2" />',
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** A badge for the military picture: an icon, a short text and a click that opens its card. Not color alone: every kind has its own icon, a guess is dashed and carries a tilde, a hot spot has a warning edge. */
export function paintPresenceMarker(m: PresenceMarker): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'presence-badge'
  el.style.setProperty('--badge', m.color)
  el.dataset.mine = m.mine ? '1' : '0'
  el.dataset.guess = m.guess ? '1' : '0'
  el.dataset.hot = m.hot ? '1' : '0'
  el.dataset.kind = m.glyph
  el.title = m.title
  el.setAttribute('aria-label', m.title)
  el.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="rgba(255,255,255,0.9)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${GLYPHS[m.glyph]}</svg><span>${escapeHtml(m.text)}</span>`
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    usePresenceUi.getState().open(m.card)
  })
  return el
}
