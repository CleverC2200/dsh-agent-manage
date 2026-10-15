/** 文件作用：提供用户技能、命令和 Agent 人格面板的持久化及技能投影。 */
/**
 * User panel storage: the persistence layer behind the skills / commands /
 * agent-personas panels. Each surface owns one directory of Markdown files
 * under `<userRoot>/user/<kind>/`, so user-authored entries survive restarts,
 * are trivially hand-editable, and stay outside suite checkouts.
 *
 * Skills entries follow the SKILL.md frontmatter grammar (`name`,
 * `description`, optional `whenToUse`, invocation controls) plus a
 * `disabled: true` panel control; commands follow Claude Code command
 * frontmatter (`description`, optional `argument-hint`, `disabled`); agent
 * personas follow Claude Code agents frontmatter (`name`, `description`,
 * optional `whenToUse`, `tools`, `model`, `disabled`).
 * @module runtime/user-panels
 */

import { join } from 'node:path'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillSource } from '@deepseek-ai/dsh-skill'
import { deleteEntryFile, entryExists, listEntryFiles, readEntryFile, USER_ENTRY_NAME, userEntryDir, writeEntryFile, type UserEntryFile } from './user-store.js'
import type { HostTranslate } from './host-locale.js'
/** The skill-source label user-panel entries carry into the skill registry. */
export const USER_PANEL_SKILL_SOURCE = 'user-panel' satisfies SkillSource

/** Ranks sit behind every shipped root so real files always win a name clash. */
const USER_PANEL_RANK = 600

/** A user panel entry as the HTTP layer serializes it. */
export interface UserPanelEntry {
  /** Entry identity: the file's base name. */
  name: string
  description: string
  /** True when the entry is disabled through its `disabled` frontmatter key. */
  disabled: boolean
  /** The parsed frontmatter record (name, description, hint, tools, model, …). */
  metadata: Record<string, unknown>
  /** Absolute file path. */
  path: string
  /** The body after frontmatter removal. */
  content: string
  rawText: string
  origin: 'user'
}

/** Throwing CRUD over one panel directory, shared by the three panels. */
export class UserPanelStore {
  /** 绑定数据根、面板类型和翻译器，形成一个面板独立存储边界。 */
  constructor(
    private readonly dataRoot: string,
    private readonly kind: 'skills' | 'commands' | 'agents',
    /** Extra name grammar for this panel (runs after USER_ENTRY_NAME). */
    private readonly extraNameCheck: (name: string) => boolean = () => true
  ) {}

  /** The panel's directory under the data root. */
  /** 返回当前面板目录路径，供路由和测试展示。 */
  dirPath(): string {
    return userEntryDir(this.dataRoot, this.kind)
  }

  /** The plugin data root the panel lives under. */
  /** 返回面板所属用户根目录。 */
  root(): string {
    return this.dataRoot
  }

  /** 返回当前面板对应的目录；所有读写都通过该受控路径进行。 */
  private get dir(): string {
    return this.dirPath()
  }

  /** Every entry, sorted by name; strict snapshots propagate temporary I/O failures. */
  /** 列出面板条目并映射为 HTTP 层模型；strict 控制坏文件是否抛错。 */
  async list(strict = false, metadataOnly = false): Promise<UserPanelEntry[]> {
    const files = await listEntryFiles(this.dir, strict, metadataOnly)
    return files.map(file => this.serialize(file))
  }

  /** One entry's full record, including the raw file text. */
  /** 按合法名称读取单个面板条目，不存在时返回 undefined。 */
  async get(name: string): Promise<UserPanelEntry | undefined> {
    if (!USER_ENTRY_NAME.test(name)) return undefined
    const file = await readEntryFile(join(this.dir, `${name}.md`), name)
    if (file === undefined) return undefined
    return this.serialize(file)
  }

  /**
   * Project one parsed file onto the wire shape. The description prefers the
   * strict frontmatter parse (multi-line YAML like `description: |` survives
   * intact there) and falls back to the shallow line record.
   */
  /** 将存储层条目转换为前端可用的统一面板模型。 */
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

  /** Create an entry; refuses an occupied name. */
  /** 校验并创建新条目，拒绝重名和非法 Markdown frontmatter。 */
  async create(name: string, text: string): Promise<UserPanelEntry> {
    if (!USER_ENTRY_NAME.test(name) || !this.extraNameCheck(name))
      throw new Error(`invalid name "${name}" — use lowercase letters, digits, and dashes, starting with a letter or digit`)
    if (await entryExists(this.dir, name)) throw new Error(`an entry named "${name}" already exists`)
    await writeEntryFile(this.dir, name, text)
    const created = await this.get(name)
    if (created === undefined) throw new Error(`entry "${name}" vanished after write`)
    return created
  }

  /** Replace one entry's file content wholesale. */
  /** 校验并覆盖既有条目，保持文件名作为稳定身份。 */
  async update(name: string, text: string): Promise<void> {
    if (!USER_ENTRY_NAME.test(name) || !this.extraNameCheck(name)) throw new Error(`invalid entry name "${name}"`)
    if (!(await entryExists(this.dir, name))) throw new Error(`no entry named "${name}"`)
    await writeEntryFile(this.dir, name, text)
  }

  /** Delete one entry; a missing file is a no-op (idempotent delete). */
  /** 删除指定面板条目；名称先过统一格式校验。 */
  async remove(name: string): Promise<void> {
    if (!USER_ENTRY_NAME.test(name)) throw new Error(`invalid entry name "${name}"`)
    await deleteEntryFile(this.dir, name)
  }
}

/** Locate the three stores; constructed once per plugin activation. */
/** 为三类用户面板创建共享数据根下的独立 Store。 */
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

/**
 * The skills/agents panels accept only harness skill-grammar names
 * (`[a-z0-9-]`, no underscores): a candidate name reaching the skill
 * registry's `get()` with an invalid name is dropped there, and several
 * consumers validate strictly, so `_`-named entries would be dead weight.
 * Commands keep the looser command grammar (`_` allowed).
 */
/** 判断候选技能名是否属于用户面板命名空间。 */
export function isUserSkillEntryName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

interface UserSkillLocator {
  name: string
}

/**
 * Skill provider over user skills only. Agent definitions belong to the
 * subagent catalog and never become skill candidates or slash entries.
 */
export class UserPanelSkillProvider implements SkillProvider {
  readonly name = 'user-panel'

  /** 保存技能面板 Store，用于候选发现和正文加载。 */
  constructor(
    private readonly skills: UserPanelStore,
    private readonly t: HostTranslate
  ) {}

  /** 列出启用的用户技能条目并转换为宿主候选。 */
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

  /** 根据候选名称读取用户技能并生成宿主定义，缺失时返回 undefined。 */
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
