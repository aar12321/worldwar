// Screenshots of the nation side (docs/UX_AUDIT_NATION.md): every Economy tab, every Empire tab (with a territory and a puppet
// bound so their tabs show), Research and the Briefing, at 1440x900 and 390x844. For each it saves the top of the page
// (`desk-<name>.png`, `phone-<name>.png`) and the whole scrolled page (`deskfull-<name>.png`, `phonefull-<name>.png`), and
// prints how tall each page is, so overload can be compared before and after.
// The globe is hidden (the desks are what is being looked at, and drawing it in software is what makes screenshots time out
// on a loaded machine). Usage: node scripts/nation-shots.mjs [--mode live] [--out dir] [--only economy-budget,tech]
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
  await g.page.addStyleTag({ content: 'canvas { visibility: hidden !important }' })
  // A territory and a puppet, so the Empire desk shows those tabs. Uses the same engine modules the game runs on.
  const bound = await g.page
    .evaluate(async () => {
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
    })
    .catch((e) => `bind failed: ${e.message}`)
  console.log('bound', JSON.stringify(bound))
  const snap = (file) => g.page.screenshot({ path: join(g.outDir, file), timeout: 120_000 }).catch((e) => console.log(`shot ${file} failed: ${e.message.split('\n')[0]}`))
  for (const [desk, tab] of TARGETS) {
    const name = tab ? `${desk}-${tab}` : desk
    if (only && !only.includes(name) && !only.includes(desk)) continue
    await g.page.evaluate(
      ([d, t]) => {
        const st = window.__store.getState()
        if (t) st.openTab(d, t)
        else if (st.panel !== d) st.setPanel(d)
      },
      [desk, tab],
    )
    await g.page.waitForTimeout(700)
    for (const [label, vp] of Object.entries(VIEWPORTS)) {
      const tag = label === 'phone' ? 'phone' : 'desk'
      await g.page.setViewportSize(vp)
      await g.page.waitForTimeout(500)
      await snap(`${tag}-${name}.png`)
      const m = await g.page.evaluate(() => {
        const b = document.querySelector('[data-panel-body]') ?? document.querySelector('[data-section="tech"] .overflow-auto')
        return b ? { scroll: b.scrollHeight, client: b.clientHeight } : null
      })
      if (!m) continue
      console.log(`${name} ${label}: ${m.scroll}px of content in a ${m.client}px window (${(m.scroll / m.client).toFixed(1)} screens)`)
      const extra = Math.min(5000, m.scroll - m.client)
      if (extra > 0) {
        await g.page.setViewportSize({ width: vp.width, height: vp.height + extra })
        await g.page.waitForTimeout(400)
      }
      await snap(`${tag}full-${name}.png`)
    }
    await g.page.setViewportSize(VIEWPORTS.desktop)
  }
  console.log('errors', JSON.stringify(g.errors.slice(0, 10)))
})
