import { z } from 'zod'
import type { UserPanelEntryWire, UserPanelKind } from '../contracts/market.js'
import { defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from '../runtime/user-store.js'
import type { UserPanelStore } from '../runtime/user-panels.js'
import type { Catalog } from './catalog.js'
import type { Suite } from '../model/types.js'

const installedResourceIdentity = z.tuple([z.string().min(1), z.string().min(1), z.enum(['skills', 'commands', 'agents']), z.string().min(1)])

export interface PanelResourceStore {
  list(strict?: boolean): Promise<UserPanelEntryWire[]>

  get(id: string): Promise<UserPanelEntryWire | undefined>

  create(name: string, text: string): Promise<UserPanelEntryWire>

  update(id: string, text: string): Promise<void>

  remove(id: string): Promise<void>
}

export function createPanelResources(catalog: Catalog, users: Record<UserPanelKind, UserPanelStore>): Record<UserPanelKind, PanelResourceStore> {
  return {
    skills: new PanelResources(catalog, users.skills, 'skills'),
    commands: new PanelResources(catalog, users.commands, 'commands'),
    agents: new PanelResources(catalog, users.agents, 'agents')
  }
}

class PanelResources implements PanelResourceStore {
  constructor(
    private catalog: Catalog,
    private users: UserPanelStore,
    private kind: UserPanelKind
  ) {}

  async list(strict = false): Promise<UserPanelEntryWire[]> {
    const entries: UserPanelEntryWire[] = await this.users.list(strict)
    for (const suite of await this.catalog.readInstalledSuites()) entries.push(...(await this.suiteEntries(suite, strict)))
    return entries
  }

  private async suiteEntries(suite: Suite, strict: boolean, resourceName?: string): Promise<UserPanelEntryWire[]> {
    const entries: UserPanelEntryWire[] = []
    const files =
      this.kind === 'skills'
        ? suite.skills.map(skill => ({ name: skill.name, file: skill.file }))
        : (suite.resources?.[this.kind] ?? (await defaultMarkdownResources(suite.root, this.kind)))
    for (const resource of files) {
      if (resourceName !== undefined && resource.name !== resourceName) continue
      const { name, file } = resource
      const rawText = await resourceText(resource).catch(error => {
        if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return undefined
      })
      if (rawText === undefined) continue
      let metadata: Record<string, unknown>
      try {
        metadata = parseFrontmatterRecord(rawText)
      } catch (error) {
        metadata = { disabled: true, validationError: String(error) }
      }
      entries.push({
        id: JSON.stringify([suite.sourceId, suite.id, this.kind, name]),
        name,
        origin: 'plugin',
        suiteName: suite.manifest.name,
        disabled: !suite.enabled || suite.activeSurfaces?.[this.kind] === false || metadata.disabled === true,
        metadata,
        rawText,
        content: stripFrontmatter(rawText),
        path: file,
        description: typeof metadata.description === 'string' ? metadata.description : ''
      })
    }
    return entries
  }

  async get(id: string): Promise<UserPanelEntryWire | undefined> {
    if (!id.startsWith('[')) return this.users.get(id)
    let identity: unknown
    try {
      identity = JSON.parse(id)
    } catch {
      return undefined
    }
    const parsed = installedResourceIdentity.safeParse(identity)
    if (!parsed.success || parsed.data[2] !== this.kind) return undefined
    const [sourceId, suiteId, , name] = parsed.data
    const suite = (await this.catalog.readInstalledSuites(sourceId)).find(entry => entry.id === suiteId)
    return suite === undefined ? undefined : (await this.suiteEntries(suite, false, name))[0]
  }

  create(name: string, text: string): Promise<UserPanelEntryWire> {
    return this.catalog.changePanelResources(() => this.users.create(name, text))
  }

  async update(id: string, text: string): Promise<void> {
    if (id.startsWith('[')) throw Error('PLUGIN_RESOURCE_READ_ONLY')
    await this.catalog.changePanelResources(() => this.users.update(id, text))
  }

  async remove(id: string): Promise<void> {
    if (id.startsWith('[')) throw Error('PLUGIN_RESOURCE_READ_ONLY')
    await this.catalog.changePanelResources(() => this.users.remove(id))
  }
}
