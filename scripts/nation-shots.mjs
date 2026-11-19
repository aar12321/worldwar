// Screenshots of the nation side (docs/UX_AUDIT_NATION.md): every Economy tab, every Empire tab (with a territory and a puppet
// bound so their tabs show), Research and the Briefing, at 1440x900 and 390x844. For each it saves the top of the page
// (`desk-<name>.png`, `phone-<name>.png`) and the whole scrolled page (`deskfull-<name>.png`, `phonefull-<name>.png`), and
// prints how tall each page is, in screens, so overload can be compared before and after.
// Usage: node scripts/nation-shots.mjs [--mode live] [--out dir] [--only economy:budget,tech]
import { withGame, VIEWPORTS } from './shots.mjs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
const mode = arg('--mode') ?? 'turns'
const outDir = arg('--out')
const only = arg('--only')?.split(',')

const TARGETS = [
  ...['country', 'people', 'budget', 'bank', 'business', 'projects', 'space', 'market', 'stocks', 'government'].map((t) => ['economy', t]),
  ...['overview', 'provinces', 'world', 'reaction', 'stats', 'territories', 'puppets'].map((t) => ['empire', t]),
  ['tech'],
  ['briefing'],
]

await withGame({ nation: 'poland', seed: 3, mode, outDir }, async (g) => {
  await g.advance(mode === 'live' ? { days: 65 } : { months: 3 })
  await g.dismiss()
  await g.page.getByRole('button', { name: /^Start / }).first().click({ timeout: 2000 }).catch(() => {})
  // A territory and a puppet, so the Empire desk shows those tabs. Uses the same engine modules the game runs on.
  const bound = await g.page.evaluate(async () => {
    const terr = await import('/src/engine/territories.ts')
    const pup = await import('/src/engine/puppets.ts')
    const st = window.__store.getState()
    const game = structuredClone(st.game)
    const me = game.playerId
    const others = Object.keys(game.nations).filter((id) => id !== me && game.nations[id].alive !== false && !game.nations[id].overlord)
    const pick = (name) => others.find((id) => id === name) ?? others.shift()
    const t = pick('lithuania')
    const p = pick('slovakia')
    terr.bindTerritory(game, t, me)
    pup.bindPuppet(game, p, me)
    window.__store.setState({ game })
    return [t, p]
  }).catch((e) => `bind failed: ${e.message}`)
  console.log('bound', JSON.stringify(bound))
  const heights = []
  for (const [desk, tab] of TARGETS) {
    const name = tab ? `${desk}-${tab}` : desk
    if (only && !only.includes(name) && !only.includes(desk)) continue
    await g.page.evaluate(([d, t]) => {
      const st = window.__store.getState()
      if (t) st.openTab(d, t)
      else if (st.panel !== d) st.setPanel(d)
    }, [desk, tab])
    await g.page.waitForTimeout(700)
    await g.shotBoth(name)
    for (const [label, vp] of Object.entries(VIEWPORTS)) {
      await g.page.setViewportSize(vp)
      await g.page.waitForTimeout(300)
      const m = await g.page.evaluate(() => {
        const b = document.querySelector('[data-panel-body]')
        return b ? { scroll: b.scrollHeight, client: b.clientHeight } : null
      })
      if (!m) continue
      heights.push(`${name} ${label}: ${(m.scroll / m.client).toFixed(1)} screens (${m.scroll}px of ${m.client}px)`)
      console.log(heights.at(-1))
      const extra = Math.min(5000, m.scroll - m.client)
      // The globe is hidden for the tall shot: drawing it in software at that size is what makes the screenshot time out.
      await g.page.addStyleTag({ content: 'canvas { visibility: hidden !important }' }).then((h) => h.evaluate((el) => el.setAttribute('data-shot-hide', ''))).catch(() => {})
      if (extra > 0) {
        await g.page.setViewportSize({ width: vp.width, height: vp.height + extra })
        await g.page.waitForTimeout(400)
      }
      await g.page.screenshot({ path: join(g.outDir, `${label === 'phone' ? 'phone' : 'desk'}full-${name}.png`), timeout: 120_000 }).catch((e) => console.log(`full shot of ${name} ${label} failed: ${e.message.split('\n')[0]}`))
      await g.page.evaluate(() => document.querySelectorAll('[data-shot-hide]').forEach((el) => el.remove()))
    }
    await g.page.setViewportSize(VIEWPORTS.desktop)
  }
  console.log(heights.join('\n'))
  console.log('errors', JSON.stringify(g.errors.slice(0, 10)))
})
