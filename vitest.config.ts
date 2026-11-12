import { defineConfig } from 'vitest/config'
import { presetLanes, presetHostHelpers } from './scripts/preset-test-lanes.mjs'
import { officialHostAliases } from './tests/official-core-input.js'

export const hostConfig = defineConfig({
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

const clientUnitTests = [
  'tests/agent-config-regression.test.ts',
  'tests/agent-source-panel.test.ts',
  'tests/client-busy-overlay.test.ts',
  'tests/client-detail-editors.test.ts',
  'tests/client-download-region.test.ts',
  'tests/client-settings-surface.test.ts',
  'tests/markdown-crash.test.ts',
  'tests/user-agent-recovery-client.test.ts',
  'tests/user-agent-skills-client.test.ts',
  'tests/user-agent-workspace.test.ts'
]

export function unitConfig(exclude: string[] = []) {
  const shared = hostConfig.test
  const excluded = [...shared.exclude, ...exclude]
  return defineConfig({
    resolve: hostConfig.resolve,
    test: {
      fileParallelism: false,
      projects: [
        { resolve: hostConfig.resolve, test: { ...shared, name: 'host', exclude: [...excluded, ...clientUnitTests] } },
        { resolve: hostConfig.resolve, test: { ...shared, name: 'client-unit', include: clientUnitTests, exclude: excluded, environment: 'jsdom' } }
      ]
    }
  })
}

export default unitConfig()
