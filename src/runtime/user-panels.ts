import { join } from 'node:path'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillSource } from '@deepseek-ai/dsh-skill'
import { deleteEntryFile, entryExists, listEntryFiles, readEntryFile, USER_ENTRY_NAME, userEntryDir, writeEntryFile, type UserEntryFile } from './user-store.js'
import type { HostTranslate } from './host-locale.js'

export const USER_PANEL_SKILL_SOURCE = 'user-panel' satisfies SkillSource

const USER_PANEL_RANK = 600

export interface UserPanelEntry {
  name: string
  description: string

  disabled: boolean

  metadata: Record<string, unknown>

  path: string

  content: string
  rawText: string
  origin: 'user'
}

export class UserPanelStore {
  constructor(
    private readonly dataRoot: string,
    private readonly kind: 'skills' | 'commands' | 'agents',

    private readonly extraNameCheck: (name: string) => boolean = () => true
  ) {}

  dirPath(): string {
    return userEntryDir(this.dataRoot, this.kind)
  }

  root(): string {
    return this.dataRoot
  }

  private get dir(): string {
    return this.dirPath()
  }

  async list(strict = false, metadataOnly = false): Promise<UserPanelEntry[]> {
    const files = await listEntryFiles(this.dir, strict, metadataOnly)
    return files.map(file => this.serialize(file))
  }

  async get(name: string): Promise<UserPanelEntry | undefined> {
    if (!USER_ENTRY_NAME.test(name)) return undefined
    const file = await readEntryFile(join(this.dir, `${name}.md`), name)
    if (file === undefined) return undefined
    return this.serialize(file)
  }

  private serialize(file: UserEntryFile): UserPanelEntry {
    const strictDescription = typeof file.description === 'string' && file.description !== '' ? file.description : undefined
    const shallowDescription = typeof file.meta['description'] === 'string' && file.meta['description'] !== '' ? file.meta['description'] : ''
    return {
      name: file.fallbackName,
      description: strictDescription ?? shallowDescription,
      disabled: file.meta['disabled'] === true,
      metadata: file.meta,
      path: file.file,
      content: file.body,
      rawText: file.text,
      origin: 'user'
    }
  }

  async create(name: string, text: string): Promise<UserPanelEntry> {
    if (!USER_ENTRY_NAME.test(name) || !this.extraNameCheck(name))
      throw new Error(`invalid name "${name}" — use lowercase letters, digits, and dashes, starting with a letter or digit`)
    if (await entryExists(this.dir, name)) throw new Error(`an entry named "${name}" already exists`)
    await writeEntryFile(this.dir, name, text)
    const created = await this.get(name)
    if (created === undefined) throw new Error(`entry "${name}" vanished after write`)
    return created
  }

  async update(name: string, text: string): Promise<void> {
    if (!USER_ENTRY_NAME.test(name) || !this.extraNameCheck(name)) throw new Error(`invalid entry name "${name}"`)
    if (!(await entryExists(this.dir, name))) throw new Error(`no entry named "${name}"`)
    await writeEntryFile(this.dir, name, text)
  }

  async remove(name: string): Promise<void> {
    if (!USER_ENTRY_NAME.test(name)) throw new Error(`invalid entry name "${name}"`)
    await deleteEntryFile(this.dir, name)
  }
}

export function createUserPanelStores(dataRoot: string): {
  skills: UserPanelStore
  commands: UserPanelStore
  agents: UserPanelStore
} {
  return {
    skills: new UserPanelStore(dataRoot, 'skills', isUserSkillEntryName),
    commands: new UserPanelStore(dataRoot, 'commands'),
    agents: new UserPanelStore(dataRoot, 'agents', isUserSkillEntryName)
  }
}

export function isUserSkillEntryName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

interface UserSkillLocator {
  name: string
}

export class UserPanelSkillProvider implements SkillProvider {
  readonly name = 'user-panel'

  constructor(
    private readonly skills: UserPanelStore,
    private readonly t: HostTranslate
  ) {}

  async list(_options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const candidates: SkillCandidate[] = []
    const skills = await this.skills.list(false, true)
    for (const entry of skills) {
      if (entry.disabled || !isUserSkillEntryName(entry.name)) continue
      candidates.push({
        name: entry.name,
        description: this.t('userSkillDescription', { description: entry.description === '' ? entry.name : entry.description }),
        ...(typeof entry.metadata['whenToUse'] === 'string' && entry.metadata['whenToUse'] !== '' ? { whenToUse: entry.metadata['whenToUse'] } : {}),
        invocation: {
          modelInvocable: entry.metadata['disable-model-invocation'] !== true,
          userInvocable: entry.metadata['user-invocable'] !== false
        },
        source: USER_PANEL_SKILL_SOURCE,
        provider: this.name,
        rank: USER_PANEL_RANK,
        locator: { name: entry.name } satisfies UserSkillLocator,
        path: entry.path,
        resourceBase: { kind: 'directory', path: this.skills.dirPath() }
      })
    }
    return candidates
  }

  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as UserSkillLocator
    const store = this.skills
    const entry = await store.get(locator.name)
    if (entry === undefined || entry.disabled) return undefined
    return {
      name: candidate.name,
      description: candidate.description,
      ...(typeof entry.metadata['whenToUse'] === 'string' && entry.metadata['whenToUse'] !== '' ? { whenToUse: entry.metadata['whenToUse'] } : {}),
      invocation: candidate.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: store.dirPath() },
      path: entry.path,
      content: entry.content
    }
  }
}
