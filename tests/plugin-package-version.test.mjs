import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const generator = resolve('scripts/generate-plugin-package-version.mjs')

test('compiled Host and client versions remain fixed until the next build', async t => {
  const root = await mkdtemp(join(tmpdir(), 'manage-package-version-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'scripts'))
  await mkdir(join(root, 'client'))
  await copyFile(resolve('scripts/normalize-client-banner.mjs'), join(root, 'scripts/normalize-client-banner.mjs'))
  const manifest = join(root, 'package.json')
  const writeManifest = version => writeFile(manifest, JSON.stringify({ name: '@example/manage', version, type: 'module' }))
  const generate = (...args) => execFileSync(process.execPath, [generator, ...args], { cwd: root, stdio: 'pipe' })
  async function compile(generation) {
    const source = join(root, 'src/plugin-package-version.ts')
    const host = join(root, `host-${generation}`)
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), source, '--module', 'NodeNext', '--target', 'ES2023', '--outDir', host, '--declaration'], { cwd: root })
    const client = ts.transpileModule(await readFile(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } })
    await writeFile(join(root, 'client/client.js'), client.outputText)
    execFileSync(process.execPath, ['scripts/normalize-client-banner.mjs'], { cwd: root })
    let registered
    runInNewContext(await readFile(join(root, 'client/client.js'), 'utf8'), {
      window: {
        __ModuleLoader__: {
          load: registration => {
            registered = registration
          }
        }
      }
    })
    assert.equal(registered.id, '@example/manage')
    const exports = registered.factory(() => assert.fail('version stamp must not read runtime dependencies'))
    return [(await import(pathToFileURL(join(host, 'plugin-package-version.js')))).pluginPackageVersion, exports.pluginPackageVersion]
  }
  await writeManifest('1.2.3')
  generate()
  const loaded = await compile('first')
  const sourceBefore = await readFile(join(root, 'src/plugin-package-version.ts'), 'utf8')
  await writeManifest('1.2.4')
  assert.throws(() => generate('--check'), /PLUGIN_PACKAGE_VERSION_STALE/)
  assert.equal(await readFile(join(root, 'src/plugin-package-version.ts'), 'utf8'), sourceBefore)
  for (const stamp of loaded) {
    assert.deepEqual({ ...stamp }, { name: '@example/manage', version: '1.2.3' })
    assert.equal(Object.isFrozen(stamp), true)
    assert.throws(() => {
      stamp.version = 'changed'
    }, TypeError)
  }
  generate()
  generate('--check')
  for (const stamp of await compile('next')) assert.deepEqual({ ...stamp }, { name: '@example/manage', version: '1.2.4' })
})

test('the Host and client entrypoints expose the compiled package identity', async () => {
  const entries = ['src/index.ts', 'src/client/index.ts'].map(entry => resolve(entry))
  const program = ts.createProgram(entries, { noEmit: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext })
  const checker = program.getTypeChecker()
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  for (const entry of entries) {
    const source = program.getSourceFile(entry)
    const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(source))
    const stamp = exported.find(symbol => symbol.name === 'pluginPackageVersion')
    assert.ok(stamp, `${entry} must export pluginPackageVersion`)
    const identity = checker.getTypeOfSymbolAtLocation(stamp, source)
    for (const field of ['name', 'version']) {
      const property = identity.getProperty(field)
      assert.ok(property, `${entry} must expose ${field}`)
      assert.equal(checker.getTypeOfSymbolAtLocation(property, source).value, manifest[field])
    }
  }
})
