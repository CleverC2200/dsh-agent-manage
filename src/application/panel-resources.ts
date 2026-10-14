/** 文件作用：读写用户面板资源，并把技能、命令和 Agent 条目转换为应用层结果。 */
/**
 * Installed suite and user resources share one inventory; paths never come from HTTP callers.
 *
 * 中文：本文件将用户自建资源与已安装 suite 提供的 skills、commands、agents 合并成统一面板清单。
 * 编辑和删除使用服务端已解析的资源 id，不信任 HTTP 调用方直接提供的文件路径。
 */
import { realpath, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { z } from 'zod'
import type { UserPanelEntryWire, UserPanelKind } from '../contracts/market.js'
import { defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from '../runtime/user-store.js'
import type { UserPanelStore } from '../runtime/user-panels.js'
import type { Catalog } from './catalog.js'
import type { Suite } from '../model/types.js'

const installedResourceIdentity = z.tuple([z.string().min(1), z.string().min(1), z.enum(['skills', 'commands', 'agents']), z.string().min(1)])

/** The routes consume this structural surface, also implemented by user-only stores in tests. 中文：路由层依赖的面板资源仓库接口，测试可用纯用户资源实现替换。 */
export interface PanelResourceStore {
  /** Strict runtime reads propagate I/O failures so catalogs cannot publish partial replacements. 中文：列出全部资源；严格模式会向上抛出 I/O 失败，避免发布不完整快照。 */
  list(strict?: boolean): Promise<UserPanelEntryWire[]>
  /** 按稳定 id 查找单个面板资源，不存在时返回 undefined。 */
  get(id: string): Promise<UserPanelEntryWire | undefined>
  /** 在用户资源区创建一个新条目。 */
  create(name: string, text: string): Promise<UserPanelEntryWire>
  /** 更新用户资源，或在安全路径边界内更新受管插件资源。 */
  update(id: string, text: string): Promise<void>
  /** 删除用户资源，或在安全路径边界内删除受管插件资源。 */
  remove(id: string): Promise<void>
}

/** 为三类用户面板创建统一资源仓库，共享同一 Catalog 与对应的用户存储。 */
export function createPanelResources(catalog: Catalog, users: Record<UserPanelKind, UserPanelStore>): Record<UserPanelKind, PanelResourceStore> {
  return {
    skills: new PanelResources(catalog, users.skills, 'skills'),
    commands: new PanelResources(catalog, users.commands, 'commands'),
    agents: new PanelResources(catalog, users.agents, 'agents')
  }
}

class PanelResources implements PanelResourceStore {
  /** 绑定目录服务、用户资源存储和当前面板类型。 */
  constructor(
    private catalog: Catalog,
    private users: UserPanelStore,
    private kind: UserPanelKind
  ) {}

  /** 合并用户资源与已安装的本地 suite 资源，同时投影禁用状态、frontmatter 和所属 suite。 */
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

  /** Read one user entry or a stable installed identity without loading other resource bodies. */
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

  /** 将创建请求交给对应的用户资源存储，不直接修改 suite 源文件。 */
  create(name: string, text: string): Promise<UserPanelEntryWire> {
    return this.catalog.changePanelResources(() => this.users.create(name, text))
  }

  /** 将插件资源 id 解析为可写真实路径，拒绝内联 JSON、外部源和符号链越界。 */
  private async pluginPath(id: string): Promise<string> {
    const entry = await this.get(id)
    if (entry?.origin !== 'plugin') throw new Error('Unknown installed plugin resource')
    if (entry.path.endsWith('.json')) throw new Error('Inline manifest resources are read-only; edit their source manifest')
    const root = await realpath(this.users.root())
    const path = await realpath(entry.path)
    const rel = relative(root, path)
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('External source files are read-only; create a user resource to customize them')
    return path
  }

  /** 验证新 frontmatter 后更新资源；普通 id 走用户存储，复合 id 走受管插件路径。 */
  async update(id: string, text: string): Promise<void> {
    await this.catalog.changePanelResources(async () => {
      if (!id.startsWith('[')) return this.users.update(id, text)
      parseFrontmatterRecord(text)
      await writeFile(await this.pluginPath(id), text, 'utf8')
    })
  }

  /** 删除资源；普通 id 交给用户存储，插件资源则先经过路径安全校验。 */
  async remove(id: string): Promise<void> {
    await this.catalog.changePanelResources(async () => {
      if (!id.startsWith('[')) return this.users.remove(id)
      await unlink(await this.pluginPath(id))
    })
  }
}
