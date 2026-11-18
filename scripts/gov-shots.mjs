// Screenshots of the Government desk (docs/GOVERNMENT_STATUS.md): every section at 1440x900 and 390x844, after appointing two
// ministers, drafting a reform and raising the civil service. Usage: node scripts/gov-shots.mjs [--mode live] [--out dir]
import { withGame } from './shots.mjs'

const args = process.argv.slice(2)
const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'turns'
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined

await withGame({ nation: 'poland', seed: 3, mode, outDir }, async (g) => {
  await g.advance(mode === 'live' ? { days: 35 } : { months: 2 })
  await g.dismiss()
  const result = await g.page.evaluate(() => {
    const st = () => window.__store.getState()
    const out = []
    const id = st().game.playerId
    for (const ministry of ['finance', 'labour']) {
      // The first candidate the desk offers: the same list the UI shows.
      const ok = st().issueOrder({ type: 'civics', nationId: id, action: { kind: 'appoint', ministry, candidate: `${ministry}-0-0` } })
      out.push(`appoint ${ministry}: ${ok}`)
    }
    out.push(`service: ${st().issueOrder({ type: 'civics', nationId: id, action: { kind: 'service', level: 3 } })}`)
    out.push(`draft: ${st().issueOrder({ type: 'civics', nationId: id, action: { kind: 'draft', area: 'labourLaw', option: 'flexible' } })}`)
    st().openTab('economy', 'government')
    return out
  })
  console.log(result.join('\n'))
  await g.advance(mode === 'live' ? { days: 31 } : { months: 1 })
  await g.dismiss()
  // The monthly report waits for its button.
  await g.page.getByRole('button', { name: /^Start / }).first().click({ timeout: 3000 }).catch(() => {})
  await g.page.evaluate(() => window.__store.getState().openTab('economy', 'government'))
  await g.page.waitForTimeout(800)
  console.log(await g.shot('gov-first'))
  console.log('errors so far', JSON.stringify(g.errors.slice(0, 10)))
  for (const [tab, name] of [['Overview', 'gov-overview'], ['Cabinet', 'gov-cabinet'], ['Talent', 'gov-talent'], ['Jobs', 'gov-jobs'], ['Policies', 'gov-policies'], ['Groups', 'gov-groups'], ['Laws', 'gov-laws']]) {
    await g.page.getByRole('tablist', { name: 'Government sections' }).getByRole('tab', { name: tab, exact: true }).click({ timeout: 15_000 })
    await g.page.waitForTimeout(400)
    for (const f of await g.shotBoth(name)) console.log(f)
    // And the bottom of the section, where the charts and the last cards are.
    await g.page.evaluate(() => [...document.querySelectorAll('.econ-grid > *')].at(-1)?.scrollIntoView({ block: 'end' }))
    await g.page.waitForTimeout(300)
    console.log(await g.shot(`${name}-end`))
    await g.page.evaluate(() => document.querySelector('.econ-grid')?.scrollIntoView({ block: 'start' }))
  }
  console.log('state', JSON.stringify(await g.state()))
  console.log('errors', JSON.stringify(g.errors.slice(0, 10)))
})
