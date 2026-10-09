/** Official browser sources share one source graph, as in Core's own client tests. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../../official-latest-standard/vitest.shared.ts'

const core = realpathSync(resolve(import.meta.dirname, '../../official-latest-standard'))
const { config, error } = ts.parseConfigFileTextToJson(`${core}/tsconfig.base.json`, readFileSync(`${core}/tsconfig.base.json`, 'utf8'))
if (error) throw Error('Cannot read fixed Core source mapping')
const aliases = Object.entries(config.compilerOptions.paths as Record<string, string[]>).map(([name, paths]) => ({
  find: new RegExp('^' + name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)') + '$'),
  replacement: resolve(core, paths[0].replace('*', '$1'))
}))

const workbench = resolve(process.env.DSH_WORKBENCH_CHECKOUT ?? '../dsh-agent-workbench')
if (!existsSync(resolve(workbench, 'src/resource-selection.ts'))) throw Error(`PRESET_CLIENT_INPUT_REQUIRED: DSH_WORKBENCH_CHECKOUT: ${workbench}`)

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  resolve: {
    alias: [...aliases, { find: 'preset-client-workbench/resource-selection', replacement: resolve(workbench, 'src/resource-selection.ts') }],
    dedupe: ['react', 'react-dom']
  },
  test: {
    include: [
      'tests/standard-preset-draft.test.ts',
      'tests/preset-catalog-client.test.ts',
      'tests/skill-preset-client.test.ts',
      'tests/base-preset-client.test.ts',
      'tests/sales-preset-client.test.ts',
      'tests/inventory-family-client.test.ts'
    ],
    environment: 'jsdom',
    testTimeout: 30_000,
    execArgv: vitestExecArgv,
    server: { deps: { inline: [/@deepseek-ai/, /official-latest-standard/] } }
  }
})
