// Screenshots of the "world" desks (docs/UX_AUDIT_WORLD.md): every Military tab, Diplomacy, Bloc, the country card, the jump window
// and help, at 1440x900 and 390x844, in a set-up war: Germany at war with France, a missile program, a salvo from France in the air
// (live), and a stale pact offer from an ally. It also prints how tall each desk's scrolling body is, so pages can be compared.
// Usage: node scripts/world-shots.mjs [--mode turns|live] [--out dir] [--only mil-forces,diplomacy]
import { withGame } from './shots.mjs'

const args = process.argv.slice(2)
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const mode = arg('--mode', 'turns')
const outDir = arg('--out', undefined)
const only = arg('--only', '')
  .split(',')
  .filter(Boolean)
const want = (name) => only.length === 0 || only.includes(name)

await withGame({ nation: 'germany', seed: 3, mode, outDir }, async (g) => {
  await g.advance(mode === 'live' ? { days: 3 } : { months: 1 })
  await g.dismiss()
  const setup = await g.page.evaluate(() => {
    const st = () => window.__store.getState()
    const out = []
    const game0 = st().game
    const me = game0.playerId
    const foe = Object.values(game0.nations).find((n) => n.name === 'France')?.id
    const friend = Object.values(game0.nations).find((n) => n.name === 'Poland')?.id
    // Rich enough to try everything.
    window.__store.setState((s) => {
      const p = s.game.nations[me]
      const nations = { ...s.game.nations, [me]: { ...p, resources: { ...p.resources, capital: p.resources.capital + 9000, pp: p.resources.pp + 400, tp: p.resources.tp + 900, steel: p.resources.steel + 400, oil: p.resources.oil + 300 } } }
      const key = [me, friend].sort().join('|')
      const alliances = s.game.alliances.includes(key) ? s.game.alliances : [...s.game.alliances, key]
      // An offer that became moot: a pact from a nation already allied with you.
      const proposals = [...s.game.proposals, { id: 'stale-pact', kind: 'pact', from: friend, to: me, created: s.game.turn, expires: s.game.turn + 2 }]
      return { game: { ...s.game, nations, alliances, proposals } }
    })
    out.push(`declare war: ${st().issueOrder({ type: 'declareWar', nationId: me, target: foe })}`)
    out.push(`charter: ${st().issueOrder({ type: 'fundMissiles', nationId: me })}`)
    out.push(`build: ${st().issueOrder({ type: 'buildMissiles', nationId: me, kind: 'cruise', count: 3 })}`)
    out.push(`shield: ${st().issueOrder({ type: 'missileDefense', nationId: me, item: 'radar' })}`)
    const g = st().game
    if (g.settings.mode === 'live') {
      const target = g.nations[me].capital
      const from = g.nations[foe].capital
      const day = g.day ?? 0
      // The absolute day, as engine/calendar.ts counts it (days since 1 January 2026).
      const abs = Math.round((Date.UTC(2026, g.turn - 1, 1) - Date.UTC(2026, 0, 1)) / 86_400_000) + day
      window.__store.setState((s) => ({ game: { ...s.game, flights: [...(s.game.flights ?? []), { id: 'shot-salvo', nationId: foe, from, target, count: 4, kind: 'cruise', launched: abs, lands: abs + 2, foe: me }] } }))
      out.push('salvo in the air')
    }
    return out
  })
  console.log(setup.join('\n'))
  const lengths = {}
  const measure = async (name) => {
    lengths[name] = await g.page.evaluate(() => {
      const el = document.querySelector('[data-panel-body]')
      return el ? el.scrollHeight : null
    })
  }
  const desk = async (name, fn) => {
    if (!want(name)) return
    await g.page.evaluate(fn)
    await g.page.waitForTimeout(900)
    for (const f of await g.shotBoth(name)) console.log(f)
    await measure(name)
  }
  for (const tab of ['forces', 'deploy', 'theatres', 'armies', 'wars', 'program', 'missiles', 'agencies', 'systems']) {
    if (tab === 'armies' && mode !== 'live') continue
    await desk(`mil-${tab}`, new Function(`window.__store.getState().openTab('military', '${tab}')`))
  }
  await desk('diplomacy', () => window.__store.getState().openTab('diplomacy'))
  await desk('bloc', () => window.__store.getState().openTab('faction'))
  if (want('country')) {
    await g.page.evaluate(() => {
      const st = window.__store.getState()
      st.setPanel(st.panel)
      const game = st.game
      const foe = Object.values(game.nations).find((n) => n.name === 'France')
      st.selectRegion(foe.capital)
    })
    await g.page.waitForTimeout(900)
    for (const f of await g.shotBoth('country')) console.log(f)
    await g.page.evaluate(() => window.__store.getState().selectRegion(null))
  }
  if (want('globe')) {
    await g.page.waitForTimeout(500)
    for (const f of await g.shotBoth('globe')) console.log(f)
  }
  if (want('palette')) {
    await g.page.evaluate(() => window.__store.getState().setPalette(true))
    await g.page.waitForTimeout(600)
    for (const f of await g.shotBoth('palette')) console.log(f)
    await g.page.evaluate(() => window.__store.getState().setPalette(false))
  }
  if (want('help')) {
    await g.page.evaluate(() => window.__store.getState().setHelp(true))
    await g.page.waitForTimeout(600)
    for (const f of await g.shotBoth('help')) console.log(f)
    await g.page.evaluate(() => window.__store.getState().setHelp(false))
  }
  console.log('scroll heights (desktop px)', JSON.stringify(lengths))
  console.log('state', JSON.stringify(await g.state()))
  console.log('errors', JSON.stringify(g.errors.slice(0, 10)))
})
