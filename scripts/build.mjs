import { parseArgs } from 'node:util'
import { holdBuildAdmission } from '../../dsh-gea-plugin/scripts/build-admission.mjs'
import { run } from '../../dsh-gea-plugin/scripts/development-dependencies.mjs'

const { values } = parseArgs({ options: { client: { type: 'boolean', default: false } } })
holdBuildAdmission({ operation: 'build' })
run(process.execPath, ['scripts/generate-plugin-package-version.mjs'], process.cwd())
if (values.client) {
  run('corepack', ['pnpm', 'exec', 'tsdown'], process.cwd())
  run(process.execPath, ['scripts/normalize-client-banner.mjs'], process.cwd())
} else {
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], process.cwd())
  run('corepack', ['pnpm', 'run', 'build:client'], process.cwd())
}
