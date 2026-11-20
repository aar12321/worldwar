#!/usr/bin/env node
// Screenshot helper: one vite dev server on a free port + software-GL Chromium, with helpers to open a game,
// advance time and capture 1440x900 and 390x844 shots. Usage and API: docs/SPEED.md.
//
// CLI:  node scripts/shots.mjs --nation <regionId> --seed 7 --mode turns --months 2 --out /tmp/shots [--scenario cold-war] [--difficulty normal]
// API:  import { withGame } from './scripts/shots.mjs'
//       await withGame({ nation: 'BRA', seed: 7, mode: 'live' }, async (g) => { await g.advance({ days: 10 }); await g.shotBoth('a') })
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Software GL: the default capture browser cannot make a WebGL context (see .agents/memory/webgl-verification.md).
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox']
export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }

function loadPlaywright() {
  const req = createRequire(import.meta.url)
  const tries = ['playwright', 'playwright-core', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright']
  for (const t of tries) {
    try { return req(t) } catch { /* next */ }
  }
  throw new Error('playwright not found (tried ' + tries.join(', ') + ')')
}

const freePort = () => new Promise((res, rej) => {
  const s = createServer()
  s.once('error', rej)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)) })
})

/** Starts `vite` on a free port; resolves { url, stop }. With url (or SHOTS_URL) it reuses a running server instead. */
export async function startDev({ url } = {}) {
  if (url || process.env.SHOTS_URL) return { url: url || process.env.SHOTS_URL, stop: async () => {} }
  const port = await freePort()
  const bin = join(ROOT, 'node_modules/.bin/vite')
  const child = spawn(bin, ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  const stop = async () => { try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ } }
  const deadline = Date.now() + 90_000
  const target = `http://127.0.0.1:${port}/`
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('vite exited early:\n' + log)
    try { const r = await fetch(target); if (r.ok) return { url: target, stop } } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  await stop()
  throw new Error('vite did not start in 90s:\n' + log)
}

/** Opens a page already inside a new game. opts: nation (region id), seed, mode, difficulty, scenario, view ('desktop'|'phone'), outDir. */
export async function openGame(browser, baseUrl, opts = {}) {
  const view = VIEWPORTS[opts.view || 'desktop']
  const outDir = resolve(opts.outDir || process.env.SHOTS_OUT || join(ROOT, 'node_modules/.tmp/shots'))
  mkdirSync(outDir, { recursive: true })
  const ctx = await browser.newContext({ viewport: view })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
  // The console's "Failed to load resource" line names no URL; this records which resource it was.
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url().slice(0, 200)}`) })
  page.on('requestfailed', (r) => errors.push(`failed ${r.url().slice(0, 200)}: ${r.failure()?.errorText ?? ''}`))
  // Skip the first-run help: the flag lives in settings.
  await page.addInitScript(() => {
    try {
      const k = 'worlds-of-others-settings-v2'
      const s = JSON.parse(localStorage.getItem(k) || '{}')
      s.seenHelp = true
      localStorage.setItem(k, JSON.stringify(s))
    } catch { /* storage unavailable */ }
  })
  await page.goto(baseUrl, { waitUntil: 'load' })
  // window.__store exists in dev only, which is what the dev server gives us.
  await page.waitForFunction(() => !!window.__store, null, { timeout: 90_000 })
  if (opts.nation) {
    await page.evaluate((o) => {
      const g = { playerRegionId: o.nation, seed: o.seed ?? 1, mode: o.mode ?? 'turns' }
      if (o.difficulty) g.difficulty = o.difficulty
      if (o.scenario && o.scenario !== 'standard') g.scenario = o.scenario
      window.__store.getState().newGame(g)
    }, opts)
  }
  await page.waitForTimeout(opts.settleMs ?? 1500)
  const tag = opts.view === 'phone' ? 'phone' : 'desk'
  return {
    page, ctx, errors, outDir,
    state: () => page.evaluate(() => { const g = window.__store.getState().game; return g && { turn: g.turn, day: g.day, player: g.playerId, outcome: g.outcome } }),
    /** Advances game time. Turns mode: ends `months` turns. Live mode: steps `days` days (a month counts 30). */
    async advance({ months = 0, days = 0 } = {}) {
      await page.evaluate(({ months, days }) => {
        const st = () => window.__store.getState()
        const live = st().game?.settings?.mode === 'live'
        if (!live) {
          for (let i = 0; i < months; i++) { const s = st(); if (s.game.pendingEvent) s.dismissEvent?.(s.game.turn); st().endTurn() }
          return
        }
        for (let i = 0; i < days + months * 30; i++) st().stepDay()
      }, { months, days })
      await page.waitForTimeout(400)
    },
    async shot(name) {
      const file = join(outDir, `${tag}-${name}.png`)
      await page.screenshot({ path: file })
      return file
    },
    /** The same view at 1440x900 then 390x844 (the page is resized, then restored). */
    async shotBoth(name) {
      const out = []
      for (const [label, vp] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(vp)
        await page.waitForTimeout(500)
        const file = join(outDir, `${label === 'phone' ? 'phone' : 'desk'}-${name}.png`)
        await page.screenshot({ path: file })
        out.push(file)
      }
      await page.setViewportSize(view)
      return out
    },
    /** Closes the monthly report / open window (Escape), e.g. before a clean shot after advance(). */
    dismiss: async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300) },
    click: (name) => page.getByRole('button', { name }).first().click({ timeout: 15_000 }),
  }
}

/** Runs fn(g) with a dev server + browser + game, and always cleans up. */
export async function withGame(opts, fn) {
  const { chromium } = loadPlaywright()
  const dev = await startDev({ url: opts.url })
  const browser = await chromium.launch({ headless: true, args: GL_ARGS })
  try {
    const g = await openGame(browser, dev.url, opts)
    g.url = dev.url
    return await fn(g)
  } finally {
    await browser.close().catch(() => {})
    await dev.stop()
  }
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const k = argv[i].slice(2)
    o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
  }
  return o
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2))
  if (a.help || !a.nation) {
    console.log('usage: node scripts/shots.mjs --nation <regionId> [--seed 1] [--mode turns|live] [--difficulty d] [--scenario id] [--months 0] [--days 0] [--out dir] [--name shot] [--url http://running-dev-server/]')
    process.exit(a.help ? 0 : 2)
  }
  withGame({ nation: a.nation, seed: Number(a.seed ?? 1), mode: a.mode, difficulty: a.difficulty, scenario: a.scenario, outDir: a.out, url: a.url }, async (g) => {
    if (Number(a.months) || Number(a.days)) await g.advance({ months: Number(a.months || 0), days: Number(a.days || 0) })
    console.log('state', JSON.stringify(await g.state()))
    for (const f of await g.shotBoth(a.name || 'game')) console.log(f)
    if (g.errors.length) console.log('page errors:', g.errors.slice(0, 5))
  }).catch((e) => { console.error(e); process.exit(1) })
}
