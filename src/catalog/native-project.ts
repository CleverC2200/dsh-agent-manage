import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { sanitizeId } from './paths.js'
import type { Suite, SuiteDimension, SuiteManifest } from '../model/types.js'
import { countSurfaces, discoverSkills } from './surfaces.js'
import { PROJECT_LAYOUTS, type ProjectLayout } from '../model/layouts.js'
import { discoverProjectMcp } from './project-config.js'
import { discoverProjectHooks } from './project-hooks.js'
import { discoverMarkdownResources } from './component-files.js'

export const NATIVE_PROJECT_DIRS: readonly NativeProjectDir[] = PROJECT_LAYOUTS

export type NativeProjectDir = ProjectLayout

export async function discoverNativeProjectSuites(projectRoot: string, dimension: SuiteDimension): Promise<Suite[]> {
  const suites: Suite[] = []
  for (const native of NATIVE_PROJECT_DIRS) {
    const root = join(projectRoot, native.dirName)
    const id = sanitizeId(`${native.dirName}-native`)
    const manifest: SuiteManifest = {
      layout: 'project-native',
      path: join(root, 'native'),
      id,
      name: `${native.label} project files`,
      description: `Skills and agents read in place from the project's ${native.dirName}/ directory.`
    }
    const errors: string[] = []
    const lspFiles = [join(native.dirName, 'lsp.json'), join(native.dirName, '.lsp.json')]
    if (native.dirName === '.claude') lspFiles.push('.lsp.json')
    if (native.dirName === '.github') lspFiles.push('lsp.json')
    for (const path of lspFiles) {
      if ((await stat(join(projectRoot, path)).catch(() => undefined))?.isFile()) {
        errors.push(`${path}: project LSP configuration is not mounted; the host LSP registry does not isolate projects`)
      }
    }

    const skills = await discoverSkills(root, errors)
    const mcp = await discoverProjectMcp(projectRoot, native.mcpFiles ?? [], errors, native.mcpFormat)
    const hooks = await discoverProjectHooks(projectRoot, native.hookFiles ?? [], errors, native.hookFormat)
    const resources = {
      commands: native.subdirs.includes('commands') ? await discoverMarkdownResources(root, 'commands', undefined, manifest.path, errors) : [],
      agents: native.subdirs.includes('agents') ? await discoverMarkdownResources(root, 'agents', undefined, manifest.path, errors) : []
    }
    const surfaces = await countSurfaces(root, skills, mcp)
    surfaces.commands = resources.commands.length
    surfaces.agents = resources.agents.length
    surfaces.hooks = Object.values(hooks?.events ?? {}).reduce((total, groups) => total + groups.reduce((count, group) => count + group.hooks.length, 0), 0)
    surfaces.lsp = 0
    if (Object.values(surfaces).every(count => count === 0) && errors.length === 0) continue
    suites.push({
      sourceId: 'native',
      id,
      root,
      manifest,
      skills,
      resources,
      ...(mcp === undefined ? {} : { mcp }),
      ...(hooks === undefined ? {} : { hooks }),
      surfaces,
      dimension,
      enabled: true,
      activeSurfaces: {
        skills: true,
        commands: native.subdirs.includes('commands'),
        agents: native.subdirs.includes('agents'),
        mcp: mcp !== undefined,
        hooks: hooks !== undefined,
        lsp: false
      },
      errors
    })
  }
  return suites
}
