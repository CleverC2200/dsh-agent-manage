import { workflowFiles, checkWorkflows } from './workflow-preflight.mjs'
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const listed = (...args) =>
  git(...args)
    .split('\0')
    .filter(Boolean)
const skill = file => /(?:^|\/)(?:SKILL\.md|[^/]+\.skill\.md)$/.test(file)
const documentation = file => (/^(?:docs\/|docs-site\/|\.agents\/notes\/)/.test(file) && /\.(?:md|mdx|txt)$/.test(file)) || /^[^/]+\.md$/.test(file)
function resource(file) {
  if (file.split('/').includes('fixtures')) return false
  if (/(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-(?:lock|workspace)\.yaml|yarn\.lock|requirements[^/]*\.txt)$/.test(file)) return false
  return (
    /^(?:business-resources|presets|default-presets|docs\/agent-inputs)\//.test(file) ||
    skill(file) ||
    /^business\/[^/]+\/(?:plugin\.json|page\.json|sql\.config\.json|SOURCE\.md)$/.test(file)
  )
}
function versionOnly(files, base, head) {
  if (!base || files.length !== 2 || !files.includes('package.json') || !files.includes('src/plugin-package-version.ts')) return false
  try {
    const before = JSON.parse(git('show', `${base}:package.json`))
    const after = JSON.parse(git('show', `${head}:package.json`))
    const oldVersion = before.version,
      newVersion = after.version
    if (typeof oldVersion !== 'string' || typeof newVersion !== 'string' || !newVersion || oldVersion === newVersion) return false
    delete before.version
    delete after.version
    if (!isDeepStrictEqual(before, after)) return false
    const literal = value => "'" + JSON.stringify(value).slice(1, -1).replaceAll("'", "\\'") + "'"
    const oldParts = git('show', `${base}:src/plugin-package-version.ts`).split('version: ' + literal(oldVersion))
    const newParts = git('show', `${head}:src/plugin-package-version.ts`).split('version: ' + literal(newVersion))
    return oldParts.length === 2 && isDeepStrictEqual(oldParts, newParts)
  } catch {
    return false
  }
}
const workingTree = process.argv.includes('--working-tree')
const availableFiles = () => listed('ls-files', '--cached', ...(workingTree ? ['--others', '--exclude-standard'] : []), '-z').filter(file => existsSync(file))
function plan() {
  const event = !workingTree && process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {}
  const head = (!workingTree && process.env.SOURCE_HEAD_SHA) || event.pull_request?.head?.sha || event.after || git('rev-parse', 'HEAD').trim()
  if (git('rev-parse', head) !== git('rev-parse', 'HEAD')) throw Error('SOURCE_HEAD_MISMATCH')
  const base = process.env.SOURCE_BASE_SHA || event.pull_request?.base?.sha || event.before || (workingTree ? head : undefined)
  const hasBase = base && !/^0+$/.test(base)
  const diffBase = hasBase ? (process.env.GITHUB_EVENT_NAME === 'pull_request' ? git('merge-base', base, head).trim() : base) : null
  let files = hasBase ? listed('diff', '--no-renames', '--name-only', '-z', diffBase, head) : listed('ls-files', '-z')
  if (workingTree)
    files = [...new Set([...files, ...listed('diff', '--no-renames', '--name-only', '-z', 'HEAD'), ...listed('ls-files', '--others', '--exclude-standard', '-z')])].sort()
  const mode =
    workingTree && !files.length
      ? 'docs'
      : hasBase && files.length && files.every(file => !resource(file) && documentation(file))
        ? 'docs'
        : hasBase && files.length && files.every(file => resource(file) || documentation(file))
          ? 'resources'
          : 'code'
  const codeql =
    !versionOnly(
      files.filter(file => !documentation(file)),
      diffBase,
      head
    ) &&
    (mode === 'code' || files.some(file => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)))
  const changedWorkflows = workflowFiles(files)
  return {
    mode,
    ...(workingTree ? { workingTree: true, scope: 'local-working-tree' } : {}),
    files,
    workflows: changedWorkflows.length > 0,
    'workflow-files': JSON.stringify(changedWorkflows),
    base: diffBase,
    head,
    engineering: mode === 'code',
    'dependency-review': mode === 'code' && process.env.GITHUB_EVENT_NAME === 'pull_request',
    codeql
  }
}

function checkResources(result) {
  const tracked = availableFiles()
  const groups = result.files.filter(resource).map(file => /^(?:business-resources|business)\/[^/]+\//.exec(file)?.[0] || dirname(file) + '/')
  const skillChanged = result.files.some(skill)
  const files = tracked.filter(
    file => resource(file) && (groups.some(group => file.startsWith(group)) || (skillChanged && /^business-resources\/[^/]+\/(?:prompt|capability)\.json$/.test(file)))
  )
  const root = realpathSync(process.cwd())
  function reference(file, target) {
    const path = resolve(dirname(file), target)
    if (!tracked.some(entry => entry === relative(root, path) || entry.startsWith(relative(root, path) + '/')) || !existsSync(path))
      throw Error(`RESOURCE_REFERENCE_MISSING: ${file}: ${target}`)
    const local = relative(root, realpathSync(path))
    if (local === '..' || local.startsWith('../') || isAbsolute(local)) throw Error(`RESOURCE_REFERENCE_OUTSIDE: ${file}: ${target}`)
    return path
  }
  let skillNames
  function readSkillNames() {
    return (skillNames ??= new Map(
      tracked
        .filter(path => path.startsWith('business-resources/') && skill(path))
        .map(path => [
          path,
          readFileSync(reference(path, basename(path)), 'utf8')
            .match(/^name:\s*(.+)$/m)?.[1]
            .trim()
            .replace(/^(['"])(.*)\1$/, '$2')
        ])
    ))
  }
  for (const file of files) {
    if (!/\.(?:md|json|mjs|cjs|js|py)$/.test(file)) continue
    const text = readFileSync(reference(file, basename(file)), 'utf8')
    if (/\.(?:mjs|cjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
    if (file.endsWith('.py'))
      execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), filename=sys.argv[1])', file], { stdio: 'inherit' })
    if (file.endsWith('.json')) {
      const value = JSON.parse(text)
      if (file.endsWith('/SOURCE.json') && Array.isArray(value.files))
        for (const entry of value.files) {
          if (typeof entry.path !== 'string' || typeof entry.packagedSha256 !== 'string') throw Error(`RESOURCE_INTEGRITY_METADATA: ${file}`)
          const path = reference(file, entry.path)
          if (createHash('sha256').update(readFileSync(path)).digest('hex') !== entry.packagedSha256) throw Error(`RESOURCE_INTEGRITY_MISMATCH: ${file}: ${entry.path}`)
        }
      if (/(?:^|\/)(?:prompt|capability)\.json$/.test(file) && Array.isArray(value.skills)) {
        const names = [...readSkillNames().values()]
        for (const name of value.skills) if (!names.includes(name)) throw Error(`RESOURCE_SKILL_MISSING: ${file}: ${name}`)
      }
      if (/^business\/[^/]+\/plugin\.json$/.test(file)) {
        if (!value.id || value.id !== dirname(file).split('/').at(-1)) throw Error(`RESOURCE_ID_MISMATCH: ${file}`)
        for (const target of [value.declarations?.page, value.sqlConfig].filter(Boolean)) reference(file, target)
      }
    }
    if (file.endsWith('.md')) {
      if (skill(file) && (!/^name:\s*\S+/m.test(text) || !/^description:\s*\S+/m.test(text))) throw Error(`RESOURCE_SKILL_METADATA: ${file}`)
      for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
        const target = match[1].replace(/^<|>$/g, '').split('#')[0]
        if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target)) continue
        reference(file, decodeURIComponent(target))
      }
    }
  }
  for (const group of new Set(groups.filter(group => /^business-resources\/[^/]+\/$/.test(group)))) {
    if (![...tracked, ...result.files].some(file => file === group + 'capability.json' || file === group + 'mcp.json')) continue
    const source = group + 'prompt.json'
    const [profile, capability, mcp] = ['prompt.json', 'capability.json', 'mcp.json'].map(file => JSON.parse(readFileSync(reference(source, file), 'utf8')))
    reference(source, 'skills')
    if (
      !profile ||
      typeof profile.persona !== 'string' ||
      !profile.persona.trim() ||
      profile.consumerCode !== capability?.data?.consumerCode ||
      !Array.isArray(profile.skills) ||
      new Set(profile.skills).size !== profile.skills.length ||
      !Array.isArray(capability?.skills) ||
      profile.skills.length !== capability.skills.length ||
      profile.skills.some(name => typeof name !== 'string' || !capability.skills.includes(name)) ||
      (profile.pageAgents !== undefined &&
        (!Array.isArray(profile.pageAgents) ||
          profile.pageAgents.length < 1 ||
          profile.pageAgents.length > 4 ||
          !profile.pageAgents.includes('gea-html-' + capability.id) ||
          new Set(profile.pageAgents).size !== profile.pageAgents.length ||
          profile.pageAgents.some(id => typeof id !== 'string' || !/^gea-html-inventory-[a-z]+$/.test(id))))
    )
      throw Error(`RESOURCE_AGENT_IDENTITY: ${source}`)
    if (
      capability.id !== group.split('/')[1] ||
      typeof capability.label !== 'string' ||
      !capability.label.trim() ||
      capability.label.length > 120 ||
      (capability.enabled !== undefined && typeof capability.enabled !== 'boolean') ||
      typeof capability.data?.consumerCode !== 'string' ||
      !/^[a-z][a-z0-9_-]+$/.test(capability.data.consumerCode) ||
      capability.maxEffect !== 'view' ||
      (capability.layers !== undefined && (!Array.isArray(capability.layers) || capability.layers.some(layer => layer !== 'read')))
    )
      throw Error(`RESOURCE_CAPABILITY: ${group}capability.json`)
    const references = capability.resourceReferences
    if (references !== undefined) {
      if (!references || typeof references !== 'object' || Array.isArray(references) || Object.keys(references).some(key => !['skills', 'consumers'].includes(key)))
        throw Error(`RESOURCE_CAPABILITY_REFERENCES: ${group}capability.json`)
      for (const [key, pattern, own] of [
        ['skills', /^[a-z][a-z0-9-]*$/, capability.id],
        ['consumers', /^[a-z][a-z0-9_-]*$/, profile.consumerCode]
      ]) {
        const names = references[key]
        if (
          !Array.isArray(names) ||
          names.length > 8 ||
          new Set(names).size !== names.length ||
          names.some(name => typeof name !== 'string' || name.length > 80 || !pattern.test(name) || name === own)
        )
          throw Error(`RESOURCE_CAPABILITY_REFERENCES: ${group}capability.json`)
      }
      if (
        JSON.stringify(capability.skills) !== JSON.stringify([capability.id, ...references.skills]) ||
        JSON.stringify(profile.skills) !== JSON.stringify(capability.skills) ||
        JSON.stringify(profile.crossConsumers ?? []) !== JSON.stringify(references.consumers)
      )
        throw Error(`RESOURCE_CAPABILITY_REFERENCES: ${group}capability.json`)
    }
    const localNames = [...readSkillNames()].filter(([path]) => path.startsWith(group)).map(([, name]) => name)
    for (const name of capability.skills)
      if (!localNames.includes(name) && !references?.skills.includes(name)) throw Error(`RESOURCE_SKILL_MISSING: ${group}capability.json: ${name}`)
    if (
      !mcp ||
      mcp.provider !== 'gea' ||
      mcp.transport !== 'host-provided' ||
      mcp.contract !== 'gea-html-v2' ||
      mcp.consumer?.consumerType !== 'AGENT' ||
      mcp.consumer.consumerCode !== profile.consumerCode ||
      JSON.stringify(mcp.capabilities) !== JSON.stringify(capability.data.mock === true ? [] : ['governed-sql-read'])
    )
      throw Error(`RESOURCE_CAPABILITY: ${group}mcp.json`)
  }
  if (groups.includes('business-resources/inventory-orderfulfillment/') && existsSync('tests/fulfillment-resource-package.test.mjs'))
    execFileSync(process.execPath, ['--test', 'tests/fulfillment-resource-package.test.mjs'], { stdio: 'inherit' })
  console.log(JSON.stringify({ mode: result.mode, checked: files.length }))
}

function check(result) {
  if (workingTree) checkWorkflows(result.files)
  if (result.mode === 'docs') return console.log(JSON.stringify({ mode: 'docs', checked: 0 }))
  checkResources(result)
  if (result.mode !== 'code') return
  if (result.base) {
    const changedCode = result.files.filter(file => !file.endsWith('.md') && !file.endsWith('.mdx'))
    if (changedCode.length) execFileSync('git', ['diff', '--check', result.base, ...(workingTree ? [] : [result.head]), '--', ...changedCode], { stdio: 'inherit' })
  }
  const full =
    !result.base ||
    !result.files.length ||
    result.files.some(
      file =>
        (!resource(file) && !documentation(file) && !/\.(?:[cm]?[jt]s|[jt]sx|json|css|scss|html|svg)$/.test(file)) ||
        /^(?:scripts|\.github|\.codex)\//.test(file) ||
        /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-(?:lock|workspace)\.yaml|yarn\.lock|requirements[^/]*\.txt|(?:ts|js)config(?:\.[^/]*)?\.json|\.nvmrc|\.node-version|\.tool-versions|\.npmrc|\.yarnrc(?:\.yml)?|\.?(?:babel|eslint|prettier|swc|biome|oxlint|oxfmt)[^/]*|[^/]+\.config\.[^/]+)$/.test(
          file
        )
    )
  const files = workingTree
    ? full
      ? availableFiles()
      : result.files.filter(file => existsSync(file))
    : !full
      ? listed('diff', '--no-renames', '--diff-filter=AM', '--name-only', '-z', result.base, result.head)
      : availableFiles()
  for (const file of files) {
    if (file.split('/').includes('fixtures')) continue
    if (/\.(?:mjs|cjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
    else if (file.endsWith('.json')) JSON.parse(readFileSync(file, 'utf8'))
  }
}

const phase = process.argv[process.argv.indexOf('--phase') + 1]
if (workingTree && !['plan', 'check', 'affected-plan'].includes(phase)) throw Error('SOURCE_WORKING_TREE_PLAN_ONLY')
const result = plan()
if (phase === 'plan') {
  if (!workingTree && result.mode === 'code' && existsSync('scripts/quality-peer-baseline.json')) {
    const own = basename(process.cwd())
    const baseline = JSON.parse(readFileSync('scripts/quality-peer-baseline.json', 'utf8'))
    for (const [key, repo] of [
      ['workbench-sha', 'dsh-agent-workbench'],
      ['manage-sha', 'dsh-agent-manage'],
      ['gea-sha', 'dsh-gea-plugin']
    ]) {
      const head = own === repo ? result.head : baseline.repositories?.find(entry => entry.repo === repo)?.head
      if (!/^[a-f0-9]{40}$/.test(head || '')) throw Error('SOURCE_PEER_REQUIRED')
      result[key] = head
    }
  }
  if (!workingTree && process.env.GITHUB_OUTPUT)
    for (const key of Object.keys(result).filter(key => !['files', 'base', 'head'].includes(key))) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${result[key]}\n`)
  console.log(JSON.stringify(result))
} else if (phase === 'check') check(result)
else if (['affected-plan', 'affected-prepare', 'affected-check'].includes(phase)) {
  if (result.mode !== 'code') throw Error('SOURCE_CODE_PHASE_REQUIRED')
  const reader = workingTree
    ? resolve(basename(process.cwd()) === 'dsh-agent-workbench' ? 'scripts/source-checks.mjs' : '../dsh-agent-workbench/scripts/source-checks.mjs')
    : basename(process.cwd()) === 'dsh-gea-plugin'
      ? resolve('../../source/dsh-agent-workbench/scripts/source-checks.mjs')
      : resolve(basename(process.cwd()) === 'dsh-agent-workbench' ? 'scripts/source-checks.mjs' : '../dsh-agent-workbench/scripts/source-checks.mjs')
  await (await import(pathToFileURL(reader))).sourceChecks(result, phase)
} else if (phase === 'final') {
  const expected = { PLAN_RESULT: 'success', CHECK_RESULT: result.mode === 'docs' ? 'skipped' : 'success', DEPENDENCY_RESULT: result['dependency-review'] ? 'success' : 'skipped' }
  if (process.env.HAS_CODEQL === 'true') expected.CODEQL_RESULT = result.codeql ? 'success' : 'skipped'
  for (const [key, value] of Object.entries(expected))
    if (process.env[key] !== value) throw Error(`SOURCE_RESULT_REJECTED: ${key}=${process.env[key] || 'missing'}, expected ${value}`)
  console.log(JSON.stringify({ mode: result.mode, status: 'success' }))
} else throw Error('SOURCE_PHASE_REQUIRED')
