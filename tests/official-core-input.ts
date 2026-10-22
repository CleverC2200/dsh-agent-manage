/** Tests load every official module from the caller's single selected Core. */
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { resolve, join } from 'node:path'
import z from 'zod'

export const core = realpathSync(resolve(process.env.DSH_CORE_CHECKOUT ?? resolve(import.meta.dirname, '../../../official-latest-standard')))
const manifestSchema = z.object({
  name: z.string(),
  main: z.string().optional(),
  exports: z.record(z.string(), z.union([z.string(), z.object({ default: z.string().optional() }).passthrough()])).optional()
})
const packages = new Map<string, { root: string; manifest: z.infer<typeof manifestSchema> }>()
for (const group of ['vendor', 'packages']) {
  const groupRoot = join(core, group)
  for (const entry of readdirSync(groupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const roots = group === 'vendor' ? [join(groupRoot, entry.name)] : readdirSync(join(groupRoot, entry.name)).map(child => join(groupRoot, entry.name, child))
    for (const root of roots) {
      try {
        const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')))
        packages.set(manifest.name, { root, manifest })
      } catch (error) {
        if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) continue
        throw error
      }
    }
  }
}

/** Resolve the selected Core's own public export, never a package from another SDK. */
export function officialModulePath(name: string): string {
  const id = name.split('/').slice(0, 2).join('/')
  const pkg = packages.get(id)
  if (!pkg) throw Error(`Selected Core has no package ${name}`)
  const subpath = name === id ? '.' : '.' + name.slice(id.length)
  const selected = pkg.manifest.exports?.[subpath]
  let path = (typeof selected === 'string' ? selected : selected?.default) ?? (subpath === '.' ? pkg.manifest.main : undefined)
  if (!path && subpath.startsWith('./src/') && typeof pkg.manifest.exports?.['./src/*'] === 'string')
    path = pkg.manifest.exports['./src/*'].replaceAll('*', () => subpath.slice('./src/'.length))
  if (!path) throw Error(`Selected Core has no public export ${name}`)
  return realpathSync(resolve(pkg.root, path))
}

/** Native Host exports preserve the same module identity as the Loader harness. */
export function officialHostAliases(): { find: RegExp; replacement: string }[] {
  const aliases: { find: RegExp; replacement: string }[] = []
  for (const [id, { root, manifest }] of packages) {
    for (const [subpath, declared] of Object.entries(manifest.exports ?? { '.': manifest.main })) {
      const target = typeof declared === 'string' ? declared : declared?.default
      if (typeof target !== 'string') continue
      const name = id + (subpath === '.' ? '' : subpath.slice(1))
      aliases.push({
        find: new RegExp('^' + name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '(.*)') + '$'),
        replacement: resolve(root, target.replaceAll('*', '$1'))
      })
    }
  }
  return aliases
}
