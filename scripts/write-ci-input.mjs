import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const value = name => args[args.indexOf(name) + 1]
const root = resolve(value('--root'))
const head = value('--sha')
if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('CANDIDATE_EVENT_REQUIRED: actual event SHA')
writeFileSync(
  resolve(root, 'candidate-input.json'),
  JSON.stringify(
    {
      core: '5badb15009ae1756c3afe0ae0cef1faafc290ccc',
      repositories: [
        { repo: 'dsh-agent-workbench', path: resolve(root, 'candidate/dsh-agent-workbench'), head: '9b4863692cb29a3edc8a2358e98feb7846526d1b' },
        { repo: 'dsh-agent-manage', path: resolve(root, 'candidate/dsh-agent-manage'), head },
        { repo: 'dsh-gea-plugin', path: resolve(root, 'candidate/dsh-gea-plugin'), head: 'b05ca162e1bf5ffb8443962a0b8b7e8ff8a61e96' }
      ]
    },
    null,
    2
  ) + '\n'
)
