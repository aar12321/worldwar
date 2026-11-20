// Screenshots of the nation side (docs/UX_AUDIT_NATION.md): every Economy tab, every Empire tab (with a territory and a puppet
// bound so their tabs show), Research and the Briefing, at 1440x900 and 390x844. For each it saves the top of the page
// (`desk-<name>.png`, `phone-<name>.png`) and the whole scrolled page (`deskfull-<name>.png`, `phonefull-<name>.png`), and
// prints how tall each page is, so overload can be compared before and after.
// The globe is hidden (the desks are what is being looked at, and drawing it in software is what makes screenshots time out
// on a loaded machine). Usage: node scripts/nation-shots.mjs [--mode live] [--out dir] [--only economy-budget,tech] [--empire]
// --empire: a large empire instead of Poland alone. Eighteen nations nearby are conquered through the engine's own transferRegion, a
// puppet and a territory are bound, and a war with Russia is started, so the empire list and its fold, the war-time Bank cards and
// the long Empire tables show; the puppet's "Set it free" confirmation is opened, shot, confirmed and the result shot too.
// Every HTTP response of 400 or more is printed with its URL (`http <status> <url>`), so a resource error can be traced.
import { withGame, VIEWPORTS } from './shots.mjs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
const mode = arg('--mode') ?? 'turns'
const outDir = arg('--out')
const only = arg('--only')?.split(',')
const empire = args.includes('--empire')

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
  if (empire) {
    const held = await g.page
      .evaluate(async () => {
        const war = await import('/src/engine/warfare.ts')
        const dip = await import('/src/engine/diplomacy.ts')
        const { createRng } = await import('/src/engine/rng.ts')
        const { getWorld } = await import('/src/map/world.ts')
        const { map } = getWorld()
        const st = window.__store.getState()
        const game = structuredClone(st.game)
        const me = game.playerId
        // Every country of these nations becomes the player's, as a conquest would (razed, unsettled, the people blended in).
        const take = ['germany', 'czechia', 'hungary', 'austria', 'romania', 'belarus', 'ukraine', 'denmark', 'latvia', 'estonia', 'moldova', 'bulgaria', 'serbia', 'croatia', 'slovenia', 'netherlands', 'belgium', 'switzerland'].filter((id) => game.nations[id]?.alive)
        for (const id of take) for (const r of Object.values(game.regions)) if (r.owner === id) war.transferRegion(game, map, r.id, me, true)
        // Half of them settled already, so the list shows both.
        const mine = Object.values(game.regions).filter((r) => r.owner === me)
        mine.forEach((r, i) => { if (i % 2) r.integration = 1 })
        if (game.nations.russia?.alive) dip.declareWar(game, map, me, 'russia', createRng(1, 1), false)
        game.nations[me].resources.capital += 2000
        window.__store.setState({ game })
        return { countries: mine.length, wars: game.wars.filter((w) => w.split('|').includes(me)) }
      })
      .catch((e) => `empire failed: ${e.message}`)
    console.log('empire', JSON.stringify(held))
  }
  const snap = (file) => g.page.screenshot({ path: join(g.outDir, file), timeout: 120_000 }).catch((e) => console.log(`shot ${file} failed: ${e.message.split('\n')[0]}`))
  const freeIt = async () => {
    // The puppet's "Set it free": the question, then the answer, then what is left (the release waits for the month end).
    await g.page.evaluate(() => window.__store.getState().openTab('empire', 'puppets'))
    await g.page.waitForTimeout(700)
    for (const [label, vp] of Object.entries(VIEWPORTS)) {
      const tag = label === 'phone' ? 'phone' : 'desk'
      await g.page.setViewportSize(vp)
      await g.page.waitForTimeout(400)
      const ok = await g.page.getByRole('button', { name: 'Set it free' }).first().click({ timeout: 5000 }).then(() => true, () => false)
      if (!ok) { console.log('no Set it free button'); continue }
      await g.page.waitForTimeout(400)
      await snap(`${tag}-free-ask.png`)
      if (label === 'phone') {
        await g.page.getByRole('dialog').getByRole('button', { name: 'Set it free' }).click({ timeout: 5000 }).catch((e) => console.log('confirm failed', e.message.split('\n')[0]))
        await g.page.waitForTimeout(500)
        await snap(`${tag}-free-done.png`)
      } else {
        await g.page.keyboard.press('Escape')
        await g.page.waitForTimeout(300)
      }
    }
    await g.page.setViewportSize(VIEWPORTS.desktop)
  }
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
  if (!only || only.includes('free')) await freeIt()
  console.log('errors', JSON.stringify(g.errors.slice(0, 10)))
})
