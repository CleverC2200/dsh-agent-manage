/** Official browser sources share one source graph, as in Core's own client tests. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../../official-latest-standard/vitest.shared.ts'
import { presetLanes } from './scripts/preset-test-lanes.mjs'
import { verifyWorkbenchClientInputs } from './scripts/check-client-workbench.mjs'
import { core } from './tests/official-core-input.js'

const { config, error } = ts.parseConfigFileTextToJson(`${core}/tsconfig.base.json`, readFileSync(`${core}/tsconfig.base.json`, 'utf8'))
if (error) throw Error('Cannot read fixed Core source mapping')
const aliases = Object.entries(config.compilerOptions.paths as Record<string, string[]>).map(([name, paths]) => ({
  find: new RegExp('^' + name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '(.*)') + '$'),
  replacement: resolve(core, paths[0].replaceAll('*', '$1'))
}))

const workbench = resolve(process.env.DSH_WORKBENCH_CHECKOUT ?? '../dsh-agent-workbench')
verifyWorkbenchClientInputs(workbench, Object.keys(presetLanes.client))

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  resolve: {
    alias: [
      ...aliases,
      { find: /^(?:\.\.\/)+official-latest-standard\/(.*)$/, replacement: `${core}/$1` },
      { find: 'preset-client-workbench/resource-selection', replacement: resolve(workbench, 'src/resource-selection.ts') }
    ],
    dedupe: ['react', 'react-dom']
  },
  test: {
    // Each client file starts an official Host process; keep those process groups serial.
    fileParallelism: false,
    include: Object.keys(presetLanes.client),
    environment: 'jsdom',
    testTimeout: 30_000,
    execArgv: vitestExecArgv,
    server: { deps: { inline: [/@deepseek-ai/, /official-latest-standard/] } }
  }
})
