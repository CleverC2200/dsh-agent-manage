import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/standard-preset-draft.test.ts',
      'tests/standard-preset-gea.test.ts',
      'tests/skill-preset-gea.test.ts',
      'tests/skill-preset-client.test.ts',
      'tests/base-preset-client.test.ts',
      'tests/base-resource-host.test.ts',
      'tests/inventory-family-preset.test.ts',
      'tests/inventory-family-client.test.ts',
      'tests/inventory-family-host.test.ts'
    ],
    environment: 'node',
    testTimeout: 30_000,
    // Serial execution: several tests share fixture directories and global
    // React/Vitest state; parallel file runs cause intermittent failures.
    // The full suite finishes in ~2.5s serially, so the cost is negligible.
    fileParallelism: false,
    server: {
      deps: {
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/]
      }
    }
  }
})
