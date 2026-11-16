#!/usr/bin/env node
// Ranks the slowest test files and tests from a vitest JSON report.
//   npx vitest run --reporter=json --outputFile=/tmp/t.json && node scripts/test-times.mjs /tmp/t.json [topN]
import { readFileSync } from 'node:fs'
const [file, topArg] = process.argv.slice(2)
if (!file) { console.error('usage: test-times.mjs report.json [topN]'); process.exit(2) }
const top = Number(topArg) || 25
const j = JSON.parse(readFileSync(file, 'utf8'))
const rel = (n) => n.replace(/^.*?(src\/)/, '$1')
const files = j.testResults.map((f) => ({ n: rel(f.name), s: (f.endTime - f.startTime) / 1000, c: f.assertionResults.length })).sort((a, b) => b.s - a.s)
console.log(`FILES (of ${files.length}, summed ${files.reduce((a, f) => a + f.s, 0).toFixed(0)}s)`)
files.slice(0, top).forEach((f, i) => console.log(`${String(i + 1).padStart(2)}  ${f.s.toFixed(1).padStart(7)}s  ${String(f.c).padStart(3)} tests  ${f.n}`))
const tests = j.testResults.flatMap((f) => f.assertionResults.map((t) => ({ f: rel(f.name), n: t.fullName, s: (t.duration || 0) / 1000 }))).sort((a, b) => b.s - a.s)
console.log('\nTESTS')
tests.slice(0, top).forEach((t, i) => console.log(`${String(i + 1).padStart(2)}  ${t.s.toFixed(1).padStart(7)}s  ${t.f.split('/').pop()} > ${t.n.slice(0, 100)}`))
