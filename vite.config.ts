/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    include: ['src/**/*.test.ts'],
  },
})
