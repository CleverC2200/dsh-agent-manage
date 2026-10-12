import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from 'vitest'

const config = resolve('.dependency-cruiser.cjs')
const cli = resolve('node_modules/dependency-cruiser/bin/dependency-cruise.mjs')

function cruise(from: string, target: string, alias = false, mode: 'export' | 'type' | 'dynamic' = 'export') {
  const root = mkdtempSync(join(tmpdir(), 'manage-architecture-'))
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  try {
    put('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@boundary': [target] } } }))
    const builtin = !target.startsWith('src/')
    if (!builtin) put(target, 'export const value = 1\nexport type Value = number\n')
    if (target === 'react') {
      put('node_modules/react/package.json', JSON.stringify({ name: 'react', main: 'index.js' }))
      put('node_modules/react/index.js', 'exports.readFile = () => {}\n')
    }
    const specifier = builtin ? target : alias ? '@boundary' : '../' + target.slice(4).replace(/\.ts$/, '.js')
    put(
      from,
      mode === 'type'
        ? `import type { Value } from '${specifier}'\nexport type Output = Value\n`
        : mode === 'dynamic'
          ? `void import('${specifier}')\n`
          : `export { ${builtin ? 'readFile' : 'value'} } from '${specifier}'\n`
    )
    const result = spawnSync(process.execPath, [cli, '--config', config, '--ts-config', 'tsconfig.json', '--output-type', 'err', 'src'], { cwd: root, encoding: 'utf8' })
    expect(result.error).toBeUndefined()
    return { status: result.status, output: result.stdout + result.stderr, stderr: result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('client cannot consume bare Node builtin imports', () => {
  const result = cruise('src/client/consumer.ts', 'fs')
  expect(result.status).not.toBe(0)
  expect(result.output).toContain('error client-cannot-import-node')
})

const boundaries = [
  ['inventory-calculations-stay-pure', 'inventory-compute', 'runtime'],
  ['inventory-calculations-stay-pure', 'aps-compute', 'application'],
  ['client-cannot-import-host', 'client', 'runtime'],
  ['catalog-cannot-import-host-or-client', 'catalog', 'application'],
  ['runtime-cannot-import-client-or-routes', 'runtime', 'routes'],
  ['contracts-cannot-import-runtime', 'contracts', 'runtime']
] as const

for (const [rule, layer, target] of boundaries) {
  test(`${rule}: legal model consumption passes`, () => {
    const result = cruise(`src/${layer}/consumer.ts`, 'src/model/value.ts')
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('no dependency violations found')
  })
  for (const alias of [false, true]) {
    test(`${rule}: ${alias ? 'TypeScript alias' : 'relative re-export'} is rejected`, () => {
      const result = cruise(`src/${layer}/consumer.ts`, `src/${target}/value.ts`, alias)
      expect(result.status).not.toBe(0)
      expect(result.output).toContain(`error ${rule}`)
    })
  }
}

for (const builtin of ['node:fs', 'fs/promises', 'node:fs/promises']) {
  test(`client-cannot-import-node rejects ${builtin}`, () => {
    const result = cruise('src/client/consumer.ts', builtin)
    expect(result.status).not.toBe(0)
    expect(result.output).toContain('error client-cannot-import-node')
  })
}

test('client-cannot-import-node permits browser model consumption', () => {
  const result = cruise('src/client/consumer.ts', 'src/model/value.ts')
  expect(result.status, result.output).toBe(0)
})

test('runtime permits a Node builtin for host effects', () => {
  const result = cruise('src/runtime/consumer.ts', 'node:fs')
  expect(result.status, result.output).toBe(0)
})

test('current src consumers satisfy the public architecture rules', () => {
  const result = spawnSync('corepack', ['pnpm', 'run', 'check:architecture'], { encoding: 'utf8' })
  expect(result.status, result.stdout + result.stderr).toBe(0)
})

for (const [rule, layer, target] of boundaries) {
  for (const mode of ['type', 'dynamic'] as const) {
    test(`${rule}: ${mode} import through an alias is rejected`, () => {
      const result = cruise(`src/${layer}/consumer.ts`, `src/${target}/value.ts`, true, mode)
      expect(result.status).not.toBe(0)
      expect(result.output).toContain(`error ${rule}`)
    })
  }
}

test('browser client may consume an external non-Node package', () => {
  const result = cruise('src/client/consumer.ts', 'react')
  expect(result.status, result.output).toBe(0)
})

test('GEA can resolve the existing public business-resources export', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', "console.log(import.meta.resolve('dsh-agent-manage/business-resources'))"], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe(new URL('../lib/runtime/business-resources.js', import.meta.url).href)
})

for (const path of ['src/runtime/business-resources.js', 'lib/runtime/business-resources.js']) {
  test(`package exports reject the private consumer path ${path}`, () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `import.meta.resolve('dsh-agent-manage/${path}')`], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
  })
}
