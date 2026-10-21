import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

test('selected Core resolves every target wildcard through its public export', t => {
  const core = realpathSync(mkdtempSync(join(tmpdir(), 'official-export-')))
  t.after(() => rmSync(core, { recursive: true, force: true }))
  mkdirSync(join(core, 'vendor/fixture/source/item'), { recursive: true })
  mkdirSync(join(core, 'packages'))
  writeFileSync(
    join(core, 'vendor/fixture/package.json'),
    JSON.stringify({
      name: '@fixture/paths',
      exports: { './src/*': './source/*/copy-*.ts' }
    })
  )
  const expected = join(core, 'vendor/fixture/source/item/copy-item.ts')
  writeFileSync(expected, 'export const value = 1\n')
  const helper = pathToFileURL(join(import.meta.dirname, 'official-core-input.ts')).href
  const actual = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `const { officialModulePath } = await import(${JSON.stringify(helper)}); process.stdout.write(officialModulePath('@fixture/paths/src/item'))`],
    { encoding: 'utf8', env: { ...process.env, DSH_CORE_CHECKOUT: core } }
  )
  assert.equal(actual, expected)
  mkdirSync(join(core, 'vendor/fixture/source/$&'))
  const literal = join(core, 'vendor/fixture/source/$&/copy-$&.ts')
  writeFileSync(literal, 'export const value = 2\n')
  const resolved = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `const { officialModulePath } = await import(${JSON.stringify(helper)}); process.stdout.write(officialModulePath('@fixture/paths/src/$&'))`],
    { encoding: 'utf8', env: { ...process.env, DSH_CORE_CHECKOUT: core } }
  )
  assert.equal(resolved, literal)
})

test('Host aliases preserve literal package names and every target capture', t => {
  const core = realpathSync(mkdtempSync(join(tmpdir(), 'official-alias-')))
  t.after(() => rmSync(core, { recursive: true, force: true }))
  mkdirSync(join(core, 'vendor/fixture'), { recursive: true })
  mkdirSync(join(core, 'packages'))
  writeFileSync(
    join(core, 'vendor/fixture/package.json'),
    JSON.stringify({
      name: '@fixture/paths.v1',
      exports: { './src/*': './source/*/copy-*.ts', './one/*': './single/*.ts', '.': './index.ts' }
    })
  )
  const helper = pathToFileURL(join(import.meta.dirname, 'official-core-input.ts')).href
  const script = `
    const { officialHostAliases } = await import(${JSON.stringify(helper)})
    const aliases = officialHostAliases()
    const resolve = name => {
      const alias = aliases.find(alias => alias.find.test(name))
      return alias ? name.replace(alias.find, alias.replacement) : null
    }
    process.stdout.write(JSON.stringify([
      resolve('@fixture/paths.v1/src/item'), resolve('@fixture/paths.v1/one/item'), resolve('@fixture/paths.v1'),
      resolve('@fixture/pathsXv1/src/item'), resolve('@fixture/paths.v1-other/src/item')
    ]))
  `
  const actual = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, DSH_CORE_CHECKOUT: core }
    })
  )
  assert.deepEqual(actual, [join(core, 'vendor/fixture/source/item/copy-item.ts'), join(core, 'vendor/fixture/single/item.ts'), join(core, 'vendor/fixture/index.ts'), null, null])
})
