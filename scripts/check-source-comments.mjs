import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const workbench = process.env.DSH_WORKBENCH_CHECKOUT ?? resolve(import.meta.dirname, '../../dsh-agent-workbench')
const args = process.argv.slice(2).filter((value, index) => index !== 0 || value !== '--')
const result = spawnSync(process.execPath, [resolve(workbench, 'scripts/check-source-comments.mjs'), '--root', process.cwd(), ...args], {
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
