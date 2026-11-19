// Screenshots of the Relations desk (docs/RELATIONS_STATUS.md) at 1440x900 and 390x844: the board with no nation open, a filter,
// a nation's headline with its reasons, its actions, and the phone list and detail. Before the shots the player opens an embassy,
// invests and proposes a trade deal, so the ties show. Usage: node scripts/relations-shots.mjs [--mode live] [--out dir]
import { withGame } from './shots.mjs'

const args = process.argv.slice(2)
const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'turns'
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined
const nation = args.includes('--nation') ? args[args.indexOf('--nation') + 1] : 'poland'
const partner = args.includes('--partner') ? args[args.indexOf('--partner') + 1] : 'germany'

await withGame({ nation, seed: 3, mode, outDir }, async (g) => {
  await g.advance(mode === 'live' ? { days: 35 } : { months: 1 })
  await g.dismiss()
  const setup = await g.page.evaluate((partner) => {
    const st = () => window.__store.getState()
    const me = st().game.playerId
    const out = []
    out.push(`embassy: ${st().issueOrder({ type: 'relate', nationId: me, target: partner, act: 'embassy' })}`)
    out.push(`invest: ${st().issueOrder({ type: 'invest', nationId: me, target: partner, sector: 'manufacturing', amount: 60 })}`)
    out.push(`trade: ${st().issueOrder({ type: 'propose', nationId: me, target: partner, proposal: { kind: 'trade', terms: { give: { food: 4 }, receive: { capital: 6 }, months: 12 } } })}`)
    return out
  }, partner)
  console.log(setup.join('\n'))
  await g.advance(mode === 'live' ? { days: 62 } : { months: 2 })
  await g.dismiss()
  await g.page.getByRole('button', { name: /^Start / }).first().click({ timeout: 3000 }).catch(() => {})
  await g.page.evaluate(() => window.__store.getState().openRelations(null))
  await g.page.waitForTimeout(900)
  for (const f of await g.shotBoth('rel-board')) console.log(f)
  // A filter chip.
  await g.page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Neighbours/ }).click({ timeout: 10_000 }).catch((e) => console.log('no neighbours chip', e.message))
  await g.page.waitForTimeout(300)
  for (const f of await g.shotBoth('rel-neighbours')) console.log(f)
  await g.page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Neighbours/ }).click({ timeout: 10_000 }).catch(() => {})
  // A sort by trade value.
  await g.page.getByLabel('Sort by').selectOption('trade')
  await g.page.waitForTimeout(300)
  console.log(await g.shot('rel-sort-trade'))
  await g.page.getByLabel('Sort by').selectOption('opinion')
  // One nation: the headline and its reasons, all groups open.
  await g.page.evaluate((partner) => window.__store.getState().openRelations(partner), partner)
  await g.page.waitForTimeout(500)
  await g.page.evaluate(() => document.querySelectorAll('[data-reason-group]').forEach((d) => (d.open = true)))
  for (const f of await g.shotBoth('rel-partner-why')) console.log(f)
  await g.page.getByRole('tab', { name: 'Actions', exact: true }).click({ timeout: 10_000 })
  await g.page.waitForTimeout(400)
  for (const f of await g.shotBoth('rel-partner-actions')) console.log(f)
  await g.page.evaluate(() => document.querySelector('[data-group="economy"]')?.setAttribute('open', ''))
  await g.page.evaluate(() => document.querySelector('[data-group="economy"]')?.scrollIntoView({ block: 'start' }))
  await g.page.waitForTimeout(300)
  console.log(await g.shot('rel-partner-economy'))
  // The phone, from the list to a nation and back.
  await g.page.setViewportSize({ width: 390, height: 844 })
  await g.page.evaluate(() => window.__store.getState().openRelations(null))
  await g.page.waitForTimeout(500)
  await g.page.screenshot({ path: `${g.outDir}/phone-rel-list.png` })
  console.log(`${g.outDir}/phone-rel-list.png`)
  await g.page.getByRole('button', { name: /^Open / }).first().click({ timeout: 10_000 })
  await g.page.waitForTimeout(400)
  await g.page.screenshot({ path: `${g.outDir}/phone-rel-detail.png` })
  console.log(`${g.outDir}/phone-rel-detail.png`)
  await g.page.setViewportSize({ width: 1440, height: 900 })
  for (const [tab, name] of [['Requests', 'rel-requests'], ['Commitments', 'rel-commitments'], ['History', 'rel-history']]) {
    await g.page.evaluate(() => window.__store.getState().openRelations(null))
    await g.page.getByRole('tab', { name: new RegExp(`^${tab}`) }).first().click({ timeout: 10_000 })
    await g.page.waitForTimeout(300)
    console.log(await g.shot(name))
  }
  const ties = await g.page.evaluate((partner) => {
    const s = window.__store.getState().game
    return { turn: s.turn, ties: s.ties, deals: s.deals.filter((d) => d.from === s.playerId || d.to === s.playerId).length, opinions: s.opinions[`${partner}>${s.playerId}`] }
  }, partner)
  console.log('state', JSON.stringify(ties))
  console.log('errors', JSON.stringify(g.errors.slice(0, 10)))
})
