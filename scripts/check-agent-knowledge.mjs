import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const supplied = process.argv.slice(2)
const args = supplied[0] === '--' ? supplied.slice(1) : supplied
const workbench = process.env.DSH_WORKBENCH_CHECKOUT ?? '../dsh-agent-workbench'
const result = spawnSync(process.execPath, [resolve(workbench, 'scripts/check-agent-knowledge.mjs'), '--root', process.cwd(), '--config', 'docs/agent-knowledge.json', ...args], {
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
