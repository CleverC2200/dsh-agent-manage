import { defineConfig } from 'vitest/config'
import { presetLanes, presetHostHelpers } from './scripts/preset-test-lanes.mjs'
import { officialHostAliases } from './tests/official-core-input.js'

export default defineConfig({
  resolve: { alias: officialHostAliases(), dedupe: ['react', 'react-dom'] },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...Object.keys(presetLanes.client), ...Object.keys(presetLanes.gea), ...presetHostHelpers],
    environment: 'node',
    testTimeout: 30_000,

    fileParallelism: false,
    server: {
      deps: {
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/]
      }
    }
  }
})
