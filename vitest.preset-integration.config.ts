/** Cross-repository lane: input checkouts are explicit and missing inputs fail. */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'

const gea = resolve(process.env.DSH_GEA_CHECKOUT ?? '../dsh-gea-plugin')
const workbench = resolve(process.env.DSH_WORKBENCH_CHECKOUT ?? '../dsh-agent-workbench')
for (const [name, path] of [
  ['DSH_GEA_CHECKOUT', resolve(gea, 'src/host/prompt-runtime.ts')],
  ['DSH_WORKBENCH_CHECKOUT', resolve(workbench, 'src/page-interaction/reference.ts')]
]) {
  if (!existsSync(path)) throw Error(`PRESET_INTEGRATION_INPUT_REQUIRED: ${name}: ${path}`)
}

export default defineConfig({
  ...base,
  resolve: {
    ...base.resolve,
    alias: [
      { find: /^preset-integration-gea\/(.*)$/, replacement: resolve(gea, 'src/$1.ts') },
      { find: 'dsh-agent-manage/forecast-source', replacement: resolve(import.meta.dirname, 'src/runtime/forecast-source.ts') },
      { find: '@cleverc2200/dsh-agent-workbench/page-interaction/reference', replacement: resolve(workbench, 'src/page-interaction/reference.ts') },
      { find: '@cleverc2200/dsh-agent-workbench/page-interaction/payload-budget', replacement: resolve(workbench, 'src/page-interaction/shared/payload-budget.ts') }
    ]
  },
  test: { ...base.test, include: ['tests/standard-preset-gea.test.ts'], exclude: [] }
})
