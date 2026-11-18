/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Test sets (see docs/SPEED.md). VITEST_SET=fast leaves out the long simulation and golden files, sims runs only those, golden only the pinned
 * turn hashes. Unset runs everything. Files are listed by measured wall time (a handful of files are most of the run).
 */
const GOLDEN = ['src/engine/__tests__/turnGolden.test.ts']
const SIMS = [
  'src/engine/__tests__/missileWarSim.test.ts',
  'src/engine/__tests__/superpowerSim.test.ts',
  'src/engine/__tests__/balance.test.ts',
  'src/engine/__tests__/economyCurves.test.ts',
  'src/engine/__tests__/simulation.test.ts',
  'src/engine/__tests__/scenarioSim[ABC].test.ts',
  'src/engine/__tests__/warScoreSim.test.ts',
  'src/engine/__tests__/liveBots.test.ts',
  'src/engine/__tests__/liveSim.test.ts',
  'src/engine/__tests__/spaceLong.test.ts',
  'src/engine/__tests__/missileProgramSim.test.ts',
  'src/ai/tiers.test.ts',
  'src/ai/bot.test.ts',
  'src/ai/strategy.test.ts',
]
const set = process.env.VITEST_SET
const include = set === 'golden' ? GOLDEN : set === 'sims' ? SIMS : ['src/**/*.test.ts']
const exclude = set === 'fast' ? [...GOLDEN, ...SIMS, '**/node_modules/**'] : ['**/node_modules/**']

/** One timeout for every test and hook: the long simulations take minutes on a loaded machine, and a per-test number only fails them under load. */
const TEST_TIMEOUT = Number(process.env.VITEST_TIMEOUT_MS) || 120_000

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: {
    rolldownOptions: {
      output: {
        // Libraries in their own files: they change less often than the game, so browsers keep them cached between versions.
        codeSplitting: {
          groups: [
            // The map data and projections the game itself uses at start, kept apart from the globe that needs them too.
            { name: 'geo', priority: 3, test: /node_modules[\\/](d3-geo|d3-array|topojson-client|world-atlas)[\\/]/ },
            { name: 'globe', test: /node_modules[\\/](three|three-globe|react-globe\.gl|globe\.gl|three-[^\\/]+|kapsule|h3-js|tinycolor2|accessor-fn|frame-ticker|polished|earcut|float-tooltip|preact|data-bind-mapper|index-array-by|lodash-es|yaot)[\\/]/ },
            { name: 'react', priority: 2, test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/ },
            { name: 'motion', priority: 2, test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
  },
  test: {
    environment: 'node',
    include,
    exclude,
    testTimeout: TEST_TIMEOUT,
    hookTimeout: TEST_TIMEOUT,
    // The machine is shared with browsers and other agents: three workers on four cores leaves room to breathe. Override with VITEST_WORKERS.
    maxWorkers: Number(process.env.VITEST_WORKERS) || 3,
    fileParallelism: true,
  },
})
