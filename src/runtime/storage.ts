import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome, resolveUserRoot, resolveDataRoot } from '../catalog/paths.js'

export async function assertCanonicalStorageDirectories(): Promise<void> {
  const userRoot = resolveUserRoot()
  for (const path of [resolveDshHome(), userRoot, resolveDataRoot(), join(userRoot, 'user'), join(userRoot, '.sources')]) {
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Plugin storage cannot use a symbolic-link directory: ${path}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
