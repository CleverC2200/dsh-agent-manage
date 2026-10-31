import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { z } from 'zod'
import { dump } from 'js-yaml'
import { parseDocument } from 'yaml'
import { ARCHIVE_MAX_BYTES, ARCHIVE_MAX_ENTRIES, ARCHIVE_MAX_ENTRY_BYTES, ARCHIVE_MAX_EXTRACTED_BYTES, extractLocalZip } from '../catalog/archive.js'
import { gitClone, gitHead } from '../catalog/git.js'
import type { SkillDirectorySnapshot, SkillGitSource, UserAgentSkill, UserAgentView } from '../contracts/user-agents.js'

const sourceInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('zip'), data: z.string().max(Math.ceil((ARCHIVE_MAX_BYTES * 4) / 3)) }).strict(),
  z.object({ kind: z.literal('git'), url: z.url(), branch: z.string().min(1).optional() }).strict()
])
const targetInput = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict()
const fileVersion = z.string().regex(/^[a-f0-9]{64}$/)
const versionInput = targetInput.extend({ revision: z.number().int().nonnegative() }).strict()
const fileInput = targetInput.extend({ path: z.string().min(1) }).strict()
const stateSchema = z.object({ revision: z.number().int().nonnegative(), root: z.string() })

import { sourceResolutions, sourceSyncEntry, resolveSourceEntry, type SourceSyncEntry } from './source-sync.js'
import type { SkillDirectoryCandidate, SkillDirectoryAcquisition, SkillDirectoryView, SkillDirectorySourcePreview } from '../contracts/skill-directories.js'

type Entry = { data: Buffer; mode: number }
type Tree = Map<string, Entry>

export class SkillDirectories {
  private pending: Promise<unknown> = Promise.resolve()
  private readonly acquisitions = new Map<string, { root: string; candidates: SkillDirectoryCandidate[]; source?: Omit<SkillGitSource, 'path' | 'base'> }>()
  private readonly sourcePlans = new Map<
    string,
    { id: string; name: string; agentRevision: number; workRevision: number; work: Tree; upstream: SkillDirectorySnapshot; source: SkillGitSource; entries: SourceSyncEntry[] }
  >()
  constructor(
    private readonly ctx: Pick<Context, 'skills'>,
    private readonly store: string,
    private readonly getAgent: (id: string) => Promise<UserAgentView>,
    private readonly save: (id: string, skills: UserAgentSkill[], revision?: number) => Promise<UserAgentView>,
    private readonly sourceRoot?: (skill: UserAgentSkill) => Promise<string | undefined>
  ) {}

  async acquire(input: unknown, signal?: AbortSignal): Promise<SkillDirectoryAcquisition> {
    const value = sourceInput.parse(input)
    const token = randomUUID()
    const root = join(this.store, 'imports', token)
    let source: Omit<SkillGitSource, 'path' | 'base'> | undefined
    try {
      signal?.throwIfAborted()
      await mkdir(dirname(root), { recursive: true })
      if (value.kind === 'local') await copySafe(resolve(value.path), root)
      else if (value.kind === 'zip') {
        const bytes = Buffer.from(value.data, 'base64')
        if (bytes.length > ARCHIVE_MAX_BYTES) throw Error('SKILL_ARCHIVE_TOO_LARGE')
        await extractLocalZip(bytes, root)
      } else {
        const url = new URL(value.url)
        if (url.password || (url.protocol === 'https:' && url.username)) throw Error('SKILL_GIT_CREDENTIAL_URL_REJECTED')
        if (!['https:', 'ssh:', 'file:'].includes(url.protocol)) throw Error('SKILL_GIT_PROTOCOL_REJECTED')
        await gitClone(value.url, value.branch, root)
        source = { kind: 'git', url: value.url, ...(value.branch ? { branch: value.branch } : {}), commit: await gitHead(root) }
        await rm(join(root, '.git'), { recursive: true, force: true })
      }
      signal?.throwIfAborted()
      const candidates: SkillDirectoryCandidate[] = []
      const errors: string[] = []
      const discover = async (path: string): Promise<void> => {
        signal?.throwIfAborted()
        if ((await stat(join(path, 'SKILL.md')).catch(() => undefined))?.isFile()) {
          try {
            const definition = await this.validateDirectory(path, root)
            candidates.push({ name: definition.name, description: definition.description, path: relative(root, path).replaceAll(sep, '/') || '.' })
          } catch (error) {
            errors.push(`${relative(root, path) || '.'}: ${message(error)}`)
          }
          return
        }
        for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory() && !entry.name.startsWith('.')) await discover(join(path, entry.name))
      }
      await discover(root)
      if (!candidates.length) throw Error(`SKILL_DIRECTORY_INVALID: ${errors.join('; ') || 'SKILL.md not found'}`)
      this.acquisitions.set(token, { root, candidates, source })
      return { token, candidates, errors }
    } catch (error) {
      await rm(root, { recursive: true, force: true })
      throw error
    }
  }

  async cancel(input: unknown): Promise<void> {
    const { token } = z.object({ token: z.uuid() }).strict().parse(input)
    const acquired = this.acquisitions.get(token)
    this.acquisitions.delete(token)
    if (acquired) await rm(acquired.root, { recursive: true, force: true })
  }

  import(input: unknown): Promise<UserAgentView> {
    const value = z
      .object({ id: z.string().min(1), token: z.uuid(), path: z.string(), replace: z.boolean().optional() })
      .strict()
      .parse(input)
    return this.serialize(async () => {
      const source = this.acquisitions.get(value.token)
      const candidate = source?.candidates.find(row => row.path === value.path)
      if (!source || !candidate) throw Error('SKILL_IMPORT_SELECTION_STALE')
      const agent = await this.getAgent(value.id)
      if (agent.skills.some(row => row.name === candidate.name) && !value.replace) throw Error('SKILL_NAME_EXISTS')
      const id = randomUUID()
      const snapshot = await this.snapshot(await readTree(source.root), value.path)
      const bundle = snapshot.bundle
      const definition = await this.validateRoot(snapshot.root, candidate.name, join(bundle, 'tree'))
      const skill: UserAgentSkill = {
        kind: 'personal',
        name: definition.name,
        description: definition.description,
        content: definition.content,
        enabled: true,
        directory: { id, ...snapshot, ...(source.source ? { source: { ...source.source, path: value.path, base: snapshot } } : {}) }
      }
      const skills = [...agent.skills.filter(row => row.name !== skill.name), skill]
      await this.preserveWork(agent.skills, skills)
      return this.save(value.id, skills, agent.revision)
    })
  }

  async migrate(skills: UserAgentSkill[], previous: UserAgentSkill[] = [], sourceRoot?: string): Promise<UserAgentSkill[]> {
    return Promise.all(
      skills.map(async skill => {
        if (skill.directory) {
          const old = previous.find(row => row.name === skill.name)
          if (!old || (old.content === skill.content && (old.kind !== 'personal' || skill.kind !== 'personal' || old.description === skill.description))) return skill
          const tree = await readTree(join(skill.directory.bundle, 'tree'))
          const path = skill.directory.entry === '.' ? 'SKILL.md' : `${skill.directory.entry}/SKILL.md`
          const original = tree.get(path)
          const text = original?.data.toString('utf8') ?? ''
          const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
          if (!frontmatter) throw Error('SKILL_DIRECTORY_INVALID')
          const metadata = parseDocument(frontmatter[1])
          if (skill.kind === 'personal') metadata.set('description', skill.description)
          tree.set(path, { data: Buffer.from(`---\n${metadata.toString()}---\n${skill.content}`), mode: original!.mode })
          const snapshot = await this.snapshot(tree, skill.directory.entry, dirname(this.ownerBase(skill.directory)))
          const bundle = snapshot.bundle
          const definition = await this.validateRoot(snapshot.root, skill.name, join(bundle, 'tree'))
          const work = join(this.ownerBase(skill.directory), 'work')
          if (await stat(work).catch(() => undefined)) {
            const draft = await readTree(work),
              base = await readTree(join(skill.directory.bundle, 'tree'))
            if ([...new Set([...draft.keys(), ...base.keys()])].some(path => !equalEntry(draft.get(path), base.get(path)))) throw Error('SKILL_EDIT_CONFLICT')
            await rm(work, { recursive: true, force: true })
            await copySafe(join(bundle, 'tree'), work)
            const stateFile = join(dirname(work), 'work-state.json')
            const state = stateSchema.parse(JSON.parse(await readFile(stateFile, 'utf8')))
            await writeFile(stateFile, JSON.stringify({ revision: state.revision + 1, root: snapshot.root }))
          }
          return { ...skill, content: definition.content, directory: { ...skill.directory, ...snapshot, previous: snapshotOf(skill.directory) } }
        }
        const source = skill.kind === 'reference' ? await this.ctx.skills.get(skill.name) : undefined
        if (skill.kind === 'reference' && (!source || source.provider !== skill.provider || (skill.path !== undefined && source.path !== skill.path))) {
          if (!skill.content) return skill
        }
        const oldDirectory = previous.find(row => row.name === skill.name)?.directory
        const id = oldDirectory?.id ?? randomUUID()
        const sourceDirectory = source?.resourceBase?.kind === 'directory' ? source.resourceBase.path : undefined
        const roots = [sourceRoot, await this.sourceRoot?.(skill)]
        const origin = roots.find(root => root && sourceDirectory && inside(resolve(root), resolve(sourceDirectory))) ?? sourceDirectory
        const entry = origin && sourceDirectory ? relative(origin, sourceDirectory).replaceAll(sep, '/') || '.' : '.'
        const tree = origin ? await readTree(origin) : new Map<string, Entry>()
        const path = entry === '.' ? 'SKILL.md' : `${entry}/SKILL.md`
        const content = skill.content ?? source?.content ?? ''
        if (!sourceDirectory || skill.content !== undefined || !tree.has(path)) {
          const existing = source?.path ? await readFile(source.path, 'utf8').catch(() => '') : (tree.get(path)?.data.toString('utf8') ?? '')
          const frontmatter = existing.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0]
          const data = Buffer.from(
            `${frontmatter ?? `---\n${dump({ name: skill.name, description: skill.kind === 'personal' ? skill.description : (source?.description ?? skill.name) })}---\n`}${content}`
          )
          tree.set(path, { data, mode: tree.get(path)?.mode ?? 0o644 })
        }
        const snapshot = await this.snapshot(tree, entry)
        const definition = await this.validateRoot(snapshot.root, skill.name, join(snapshot.bundle, 'tree'))
        return { ...skill, content: definition.content, directory: { id, ...snapshot, ...(oldDirectory ? { previous: snapshotOf(oldDirectory) } : {}) } }
      })
    )
  }

  open(input: unknown): Promise<SkillDirectoryView> {
    const value = targetInput.parse(input)
    return this.serialize(() => this.openTarget(value))
  }

  runEdit<T>(input: unknown, operation: () => Promise<T>, onChanged: (revision: number) => void): Promise<T> {
    const value = versionInput
      .extend({ cwd: z.string().min(1), entry: z.string() })
      .strict()
      .parse(input)
    return this.serialize(async () => {
      const target = await this.target(value)
      await this.check(target, value.revision)
      if (resolve(value.cwd) !== target.cwd || value.entry !== target.directory.entry) throw Error('SKILL_EDIT_TARGET_CHANGED')
      const before = await readTree(target.cwd)
      try {
        return await operation()
      } finally {
        let changed = true
        try {
          changed = !equalTrees(before, await readTree(target.cwd))
        } catch {
          changed = true
        }
        if (changed) {
          const revision = target.state.revision + 1
          await writeFile(target.stateFile, JSON.stringify({ revision, root: target.directory.root }))
          onChanged(revision)
        }
      }
    })
  }

  async read(input: unknown): Promise<{ path: string; data: string; encoding: 'utf8' | 'base64'; fileVersion: string }> {
    const value = fileInput.parse(input)
    return this.serialize(async () => {
      const target = await this.target(value)
      const data = await readFile(await this.filePath(target.cwd, value.path))
      const binary = isBinary(data)
      return { path: value.path, data: data.toString(binary ? 'base64' : 'utf8'), encoding: binary ? 'base64' : 'utf8', fileVersion: digest(data) }
    })
  }

  write(input: unknown): Promise<SkillDirectoryView> {
    const value = versionInput
      .extend({ path: z.string().min(1), data: z.string().max(ARCHIVE_MAX_ENTRY_BYTES * 2), encoding: z.enum(['utf8', 'base64']), fileVersion: z.union([fileVersion, z.null()]) })
      .strict()
      .parse(input)
    return this.serialize(async () => {
      const target = await this.target(value)
      await this.check(target, value.revision)
      const path = await this.filePath(target.cwd, value.path, true)
      const existing = await readFile(path).catch(error => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      })
      if ((existing ? digest(existing) : null) !== value.fileVersion) throw Error('SKILL_EDIT_CONFLICT')
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      const mode = (await stat(path).catch(() => undefined))?.mode
      const bytes = Buffer.from(value.data, value.encoding)
      if (bytes.length > ARCHIVE_MAX_ENTRY_BYTES) throw Error('SKILL_FILE_TOO_LARGE')
      await writeFile(temporary, bytes, { mode: mode ?? 0o600 })
      await rename(temporary, path)
      await this.advance(target)
      return this.openTarget(value)
    })
  }

  rename(input: unknown): Promise<SkillDirectoryView> {
    const value = versionInput
      .extend({ path: z.string().min(1), to: z.string().min(1), fileVersion })
      .strict()
      .parse(input)
    return this.serialize(async () => {
      const target = await this.target(value)
      await this.check(target, value.revision)
      const from = await this.filePath(target.cwd, value.path)
      if (!(await stat(from)).isFile()) throw Error('SKILL_FILE_REQUIRED')
      if (digest(await readFile(from)) !== value.fileVersion) throw Error('SKILL_EDIT_CONFLICT')
      const to = await this.filePath(target.cwd, value.to, true)
      if (await stat(to).catch(() => undefined)) throw Error('SKILL_FILE_EXISTS')
      await mkdir(dirname(to), { recursive: true })
      await rename(from, to)
      await this.advance(target)
      return this.openTarget(value)
    })
  }

  delete(input: unknown): Promise<SkillDirectoryView> {
    const value = versionInput
      .extend({ path: z.string().min(1), fileVersion })
      .strict()
      .parse(input)
    return this.serialize(async () => {
      const target = await this.target(value)
      await this.check(target, value.revision)
      const path = await this.filePath(target.cwd, value.path)
      if (!(await stat(path)).isFile()) throw Error('SKILL_FILE_REQUIRED')
      if (digest(await readFile(path)) !== value.fileVersion) throw Error('SKILL_EDIT_CONFLICT')
      await rm(path)
      await this.advance(target)
      return this.openTarget(value)
    })
  }

  apply(input: unknown): Promise<SkillDirectoryView> {
    const value = versionInput.parse(input)
    return this.serialize(async () => {
      const target = await this.target(value)
      await this.check(target, value.revision)
      const snapshot = await this.snapshot(await readTree(target.cwd), target.directory.entry, dirname(this.ownerBase(target.directory)))
      const bundle = snapshot.bundle
      const definition = await this.validateRoot(snapshot.root, value.name, join(bundle, 'tree'))
      const skill = {
        ...target.skill,
        content: definition.content,
        ...(target.skill.kind === 'personal' ? { description: definition.description } : {}),
        directory: { ...target.directory, ...snapshot, previous: snapshotOf(target.directory) }
      }
      const saved = await this.save(
        value.id,
        target.agent.skills.map(row => (row.name === value.name ? skill : row)),
        target.agent.revision
      )
      if (saved.publication === 'failed') throw Error(saved.error ?? 'SKILL_PUBLICATION_FAILED')
      await this.advance({ ...target, directory: skill.directory })
      return this.openTarget(value)
    })
  }

  reset(input: unknown): Promise<SkillDirectoryView> {
    const value = versionInput.parse(input)
    return this.serialize(async () => {
      const target = await this.target(value)
      await this.check(target, value.revision, true)
      await rm(target.cwd, { recursive: true, force: true })
      await copySafe(join(target.directory.bundle, 'tree'), target.cwd)
      await this.advance(target)
      return this.openTarget(value)
    })
  }

  restore(input: unknown): Promise<SkillDirectoryView> {
    const value = versionInput.parse(input)
    return this.serialize(async () => {
      const target = await this.target(value)
      await this.check(target, value.revision)
      if (!target.directory.previous) throw Error('SKILL_PREVIOUS_VERSION_MISSING')
      const snapshot = target.directory.previous
      const definition = await this.validateRoot(snapshot.root, value.name, join(snapshot.bundle, 'tree'))
      const skill = {
        ...target.skill,
        content: definition.content,
        ...(target.skill.kind === 'personal' ? { description: definition.description } : {}),
        directory: { ...target.directory, ...snapshot, previous: snapshotOf(target.directory) }
      }
      const saved = await this.save(
        value.id,
        target.agent.skills.map(row => (row.name === value.name ? skill : row)),
        target.agent.revision
      )
      if (saved.publication === 'failed') throw Error(saved.error ?? 'SKILL_PUBLICATION_FAILED')
      await rm(target.cwd, { recursive: true, force: true })
      await copySafe(join(snapshot.bundle, 'tree'), target.cwd)
      await this.advance({ ...target, directory: skill.directory })
      return this.openTarget(value)
    })
  }

  sourcePreview(input: unknown): Promise<SkillDirectorySourcePreview> {
    const value = targetInput.parse(input)
    return this.serialize(async () => {
      const target = await this.target(value)
      const source = target.directory.source
      if (!source) throw Error('SKILL_SOURCE_NOT_CONFIGURED')
      for (const [token, plan] of this.sourcePlans)
        if (plan.id === value.id && plan.name === value.name) {
          this.sourcePlans.delete(token)
          await rm(plan.upstream.bundle, { recursive: true, force: true })
        }
      const acquired = await this.acquire({ kind: 'git', url: source.url, ...(source.branch ? { branch: source.branch } : {}) })
      const staged = this.acquisitions.get(acquired.token)!
      const bundle = join(this.ownerBase(target.directory), 'versions', randomUUID())
      try {
        if (!staged.candidates.some(row => row.path === source.path && row.name === value.name) || !staged.source) throw Error('SKILL_SOURCE_ENTRY_MISSING')
        await copySafe(staged.root, join(bundle, 'tree'))
        const upstream = snapshotFor(bundle, source.path)
        await this.validateRoot(upstream.root, value.name, join(bundle, 'tree'))
        const [base, local, next, work] = await Promise.all([
          readTree(join(source.base.bundle, 'tree')),
          readTree(join(target.directory.bundle, 'tree')),
          readTree(join(bundle, 'tree')),
          readTree(target.cwd)
        ])
        const entries = [...new Set([...base.keys(), ...local.keys(), ...next.keys()])]
          .sort()
          .map(path => sourceSyncEntry(`file:${path}`, serializeFile(base.get(path)), serializeFile(local.get(path)), serializeFile(next.get(path))))
        const token = randomUUID()
        const updatedSource = { ...source, commit: staged.source.commit, base: upstream }
        this.sourcePlans.set(token, { ...value, agentRevision: target.agent.revision, workRevision: target.state.revision, work, upstream, source: updatedSource, entries })
        return {
          token,
          ...value,
          changed: entries.some(row => row.upstreamChanged) || updatedSource.commit !== source.commit,
          commit: updatedSource.commit,
          conflicts: entries.filter(row => row.conflict).map(({ key, base, local, upstream }) => ({ key, base, local, upstream }))
        }
      } catch (error) {
        await rm(bundle, { recursive: true, force: true })
        throw error
      } finally {
        await this.cancel({ token: acquired.token })
      }
    })
  }

  sourceCommit(input: unknown): Promise<SkillDirectoryView> {
    const value = z.object({ token: z.uuid(), resolutions: sourceResolutions }).strict().parse(input)
    return this.serialize(async () => {
      const plan = this.sourcePlans.get(value.token)
      if (!plan) throw Error('SKILL_SOURCE_PREVIEW_EXPIRED')
      const target = await this.target({ id: plan.id, name: plan.name })
      if (target.agent.revision !== plan.agentRevision || target.state.revision !== plan.workRevision || !equalTrees(await readTree(target.cwd), plan.work))
        throw Error('SKILL_SOURCE_PREVIEW_STALE')
      const files: Tree = new Map()
      for (const row of plan.entries) {
        const resolved = resolveSourceEntry(row, value.resolutions[row.key], raw => {
          if (raw === null) return null
          const file = z
            .object({ data: z.string().max(ARCHIVE_MAX_ENTRY_BYTES * 2), encoding: z.enum(['utf8', 'base64']), executable: z.boolean() })
            .strict()
            .parse(raw)
          const bytes = Buffer.from(file.data, file.encoding)
          if (bytes.length > ARCHIVE_MAX_ENTRY_BYTES) throw Error('SKILL_FILE_TOO_LARGE')
          return { data: bytes.toString('base64'), mode: file.executable ? 0o755 : 0o644 }
        })
        const entry = z
          .object({ data: z.string(), mode: z.number().int().min(0).max(0o777) })
          .nullable()
          .parse(resolved)
        if (entry) files.set(row.key.slice(5), { data: Buffer.from(entry.data, 'base64'), mode: entry.mode })
      }
      const local = await readTree(join(target.directory.bundle, 'tree'))
      const changed = !equalTrees(local, files)
      if (!changed && target.directory.source?.commit === plan.source.commit && !plan.entries.some(row => row.upstreamChanged)) {
        this.sourcePlans.delete(value.token)
        await rm(plan.upstream.bundle, { recursive: true, force: true })
        return this.openTarget({ id: plan.id, name: plan.name })
      }
      const snapshot = changed ? await this.snapshot(files, target.directory.entry, dirname(this.ownerBase(target.directory))) : snapshotOf(target.directory)
      const definition = await this.validateRoot(snapshot.root, plan.name, join(snapshot.bundle, 'tree'))
      const source = { ...plan.source, base: await this.snapshot(await readTree(join(plan.upstream.bundle, 'tree')), plan.source.path, dirname(this.ownerBase(target.directory))) }
      const directory = { ...target.directory, ...snapshot, source, ...(changed ? { previous: snapshotOf(target.directory) } : {}) }
      const skill = { ...target.skill, content: definition.content, ...(target.skill.kind === 'personal' ? { description: definition.description } : {}), directory }
      const skills = target.agent.skills.map(row => (row.name === plan.name ? skill : row))
      await this.preserveWork(target.agent.skills, skills)
      const saved = await this.save(plan.id, skills, target.agent.revision)
      if (saved.publication === 'failed') throw Error(saved.error ?? 'SKILL_PUBLICATION_FAILED')
      this.sourcePlans.delete(value.token)
      await rm(plan.upstream.bundle, { recursive: true, force: true })
      if (changed) {
        await rm(target.cwd, { recursive: true, force: true })
        await writeTree(files, target.cwd)
        await this.advance({ ...target, directory })
      }
      return this.openTarget({ id: plan.id, name: plan.name })
    })
  }

  sourceCancel(input: unknown): Promise<void> {
    const { token } = z.object({ token: z.uuid() }).strict().parse(input)
    return this.serialize(async () => {
      const plan = this.sourcePlans.get(token)
      if (!plan) return
      this.sourcePlans.delete(token)
      await rm(plan.upstream.bundle, { recursive: true, force: true })
    })
  }

  async preserveWork(previous: UserAgentSkill[], next: UserAgentSkill[]): Promise<void> {
    for (const skill of previous) {
      if (!skill.directory || next.find(row => row.name === skill.name)?.directory?.root === skill.directory.root) continue
      const work = join(this.ownerBase(skill.directory), 'work')
      if (!(await stat(work).catch(() => undefined))) continue
      const [local, published] = await Promise.all([readTree(work), readTree(join(skill.directory.bundle, 'tree'))])
      if ([...new Set([...local.keys(), ...published.keys()])].some(path => !equalEntry(local.get(path), published.get(path)))) throw Error('SKILL_EDIT_CONFLICT')
    }
  }

  async clone(skills: UserAgentSkill[]): Promise<UserAgentSkill[]> {
    return Promise.all(
      skills.map(async skill => {
        if (!skill.directory) return (await this.migrate([skill]))[0]
        const id = randomUUID()
        const snapshot = await this.snapshot(await readTree(join(skill.directory.bundle, 'tree')), skill.directory.entry)
        return { ...skill, directory: { id, ...snapshot, ...(skill.directory.source ? { source: skill.directory.source } : {}) } }
      })
    )
  }

  async comparison(skill: UserAgentSkill | null): Promise<unknown> {
    if (!skill) return null
    const { directory, ...metadata } = skill
    if (!directory) return metadata
    return { ...metadata, files: await skillDirectoryFiles(join(directory.bundle, 'tree')) }
  }

  private ownerBase(directory: NonNullable<UserAgentSkill['directory']>): string {
    if (!dirname(directory.bundle).endsWith(`${sep}snapshots`)) return dirname(dirname(directory.bundle))
    if (!/^[a-zA-Z0-9_-]+$/.test(directory.id)) throw Error('SKILL_DIRECTORY_OWNER_MISMATCH')
    return join(dirname(dirname(directory.bundle)), directory.id)
  }

  private async snapshot(tree: Tree, entry: string, store = this.store): Promise<SkillDirectorySnapshot> {
    const key = treeDigest(tree)
    const bundle = join(store, 'snapshots', key)
    const verify = async () => {
      if (!(await lstat(bundle)).isDirectory() || !(await lstat(join(bundle, 'tree'))).isDirectory()) throw Error('SKILL_PATH_ESCAPE')
      if (key !== treeDigest(await readTree(join(bundle, 'tree')))) throw Error('SKILL_SNAPSHOT_CORRUPTED')
    }
    try {
      await verify()
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      const staging = join(store, `.staging-${randomUUID()}`)
      try {
        await writeTree(tree, join(staging, 'tree'))
        await mkdir(dirname(bundle), { recursive: true })
        try {
          await rename(staging, bundle)
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && ['EEXIST', 'ENOTEMPTY'].includes(String(error.code)))) throw error
        }
        await verify()
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    }
    return snapshotFor(bundle, entry)
  }

  private async target(value: z.infer<typeof targetInput>) {
    let agent = await this.getAgent(value.id)
    let skill = agent.skills.find(row => row.name === value.name)
    if (!skill) throw Error('AGENT_SKILL_NOT_FOUND')
    if (!skill.directory) {
      agent = await this.save(value.id, await this.migrate(agent.skills), agent.revision)
      skill = agent.skills.find(row => row.name === value.name)!
    }
    if (!skill.directory) throw Error('AGENT_SKILL_SOURCE_MISSING')
    const directory = skill.directory
    const base = this.ownerBase(directory)
    if (!inside(resolve(dirname(this.store)), resolve(directory.bundle)) || dirname(base).endsWith('versions') || !base.endsWith(`${sep}${directory.id}`))
      throw Error('SKILL_DIRECTORY_OWNER_MISMATCH')
    await mkdir(base, { recursive: true })
    const cwd = join(base, 'work')
    const stateFile = join(base, 'work-state.json')
    let state: z.infer<typeof stateSchema>
    try {
      state = stateSchema.parse(JSON.parse(await readFile(stateFile, 'utf8')))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      await copySafe(join(directory.bundle, 'tree'), cwd)
      state = { revision: 0, root: directory.root }
      await writeFile(stateFile, JSON.stringify(state))
    }
    return { agent, skill, directory, cwd, stateFile, state }
  }

  private async openTarget(value: z.infer<typeof targetInput>): Promise<SkillDirectoryView> {
    const target = await this.target(value)
    const current = await readTree(target.cwd)
    const published = await readTree(join(target.directory.bundle, 'tree'))
    return {
      directoryId: target.directory.id,
      name: value.name,
      cwd: target.cwd,
      entry: target.directory.entry,
      revision: target.state.revision,
      files: [...current].map(([path, entry]) => ({ path, size: entry.data.length, binary: isBinary(entry.data), executable: (entry.mode & 0o111) !== 0 })),
      ...(target.directory.source
        ? {
            source: {
              kind: target.directory.source.kind,
              url: target.directory.source.url,
              commit: target.directory.source.commit,
              ...(target.directory.source.branch ? { branch: target.directory.source.branch } : {})
            }
          }
        : {}),
      changes: [...new Set([...current.keys(), ...published.keys()])].sort().flatMap(path => {
        const local = current.get(path),
          base = published.get(path)
        return equalEntry(local, base) ? [] : [{ path, kind: !local ? ('deleted' as const) : !base ? ('added' as const) : ('modified' as const) }]
      })
    }
  }

  private async check(target: Awaited<ReturnType<SkillDirectories['target']>>, revision: number, reset = false): Promise<void> {
    if (revision !== target.state.revision || (!reset && target.state.root !== target.directory.root)) throw Error('SKILL_EDIT_CONFLICT')
    await readTree(target.cwd)
  }

  private async advance(target: Awaited<ReturnType<SkillDirectories['target']>>): Promise<void> {
    const revision = target.state.revision + 1
    await copySafe(target.cwd, join(this.ownerBase(target.directory), 'draft-history', String(revision)))
    await writeFile(target.stateFile, JSON.stringify({ revision, root: target.directory.root }))
  }

  private async filePath(root: string, path: string, missing = false): Promise<string> {
    if (path.includes('\\') || path.includes('\0') || isAbsolute(path)) throw Error('SKILL_PATH_ESCAPE')
    const target = resolve(root, path)
    if (target === root || !inside(root, target)) throw Error('SKILL_PATH_ESCAPE')
    let parent = target
    while (true) {
      try {
        if (!inside(await realpath(root), await realpath(parent))) throw Error('SKILL_PATH_ESCAPE')
        break
      } catch (error) {
        if (!(missing && error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        parent = dirname(parent)
      }
    }
    return target
  }

  private async validateDirectory(directory: string, boundary: string): Promise<SkillDefinition> {
    const bundle = join(this.store, 'validation', randomUUID())
    try {
      await copySafe(boundary, join(bundle, 'tree'))
      const entry = relative(boundary, directory)
      const snapshot = snapshotFor(bundle, entry)
      return await this.validateRoot(snapshot.root, undefined, join(bundle, 'tree'), join(bundle, 'tree', entry, 'SKILL.md'))
    } finally {
      await rm(bundle, { recursive: true, force: true })
    }
  }

  private async validateRoot(root: string, name?: string, boundary = root, selectedPath?: string): Promise<SkillDefinition> {
    await readTree(root)
    const controller = new AbortController()
    const provider = new FileSystemSkillProvider(
      new Context(),
      { signal: controller.signal, invalidate() {} },
      { includeDefaultRoots: false, customSkillDirs: [root], watch: false }
    )
    try {
      const result = await provider.list({})
      const candidates = Array.isArray(result) ? result : result.candidates
      const candidate = selectedPath ? candidates.find(row => row.path === selectedPath) : name ? candidates.find(row => row.name === name) : candidates[0]
      if (!candidate || (!name && !selectedPath && candidates.length !== 1))
        throw Error('SKILL_DIRECTORY_INVALID: SKILL.md name, description or YAML metadata rejected by official filesystem provider')
      const definition = await provider.get(candidate, {})
      if (!definition) throw Error('SKILL_DIRECTORY_INVALID: SKILL.md cannot be loaded')
      await assertLocalDependencies(boundary, definition)
      return definition
    } finally {
      controller.abort()
      await provider.dispose()
    }
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action)
    this.pending = result.catch(() => {})
    return result
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
export async function skillDirectoryFiles(root: string) {
  const files = await readTree(root)
  return [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, entry]) => ({ path, data: entry.data.toString('base64'), executable: entry.mode & 0o111 }))
}
async function readTree(root: string): Promise<Tree> {
  const files: Tree = new Map()
  const base = await realpath(root)
  let bytes = 0
  let entries = 0
  const visit = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (++entries > ARCHIVE_MAX_ENTRIES) throw Error('SKILL_TOO_MANY_FILES')
      if (entry.name === '.git') continue
      const target = join(path, entry.name)
      const actual = await realpath(target)
      if (!inside(base, actual)) throw Error(`SKILL_PATH_ESCAPE: ${relative(root, target)}`)
      if (entry.isSymbolicLink()) throw Error(`SKILL_SYMLINK_UNSUPPORTED: ${relative(root, target)}`)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) {
        const info = await lstat(target)
        bytes += info.size
        if (info.size > ARCHIVE_MAX_ENTRY_BYTES || bytes > ARCHIVE_MAX_EXTRACTED_BYTES) throw Error('SKILL_FILES_TOO_LARGE')
        files.set(relative(root, target).replaceAll(sep, '/'), { data: await readFile(target), mode: info.mode & 0o777 })
      } else throw Error('SKILL_FILE_TYPE_UNSUPPORTED')
    }
  }
  await visit(root)
  return files
}
async function copySafe(from: string, to: string): Promise<void> {
  await writeTree(await readTree(from), to)
}
async function writeTree(tree: Tree, to: string): Promise<void> {
  await mkdir(to, { recursive: true })
  for (const [path, entry] of tree) {
    const target = resolve(to, path)
    if (!inside(resolve(to), target)) throw Error('SKILL_PATH_ESCAPE')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entry.data, { mode: entry.mode })
    await chmod(target, entry.mode)
  }
}
function serializeFile(entry?: Entry): { data: string; mode: number } | null {
  return entry ? { data: entry.data.toString('base64'), mode: entry.mode } : null
}
function equalTrees(a: Tree, b: Tree): boolean {
  return [...new Set([...a.keys(), ...b.keys()])].every(path => equalEntry(a.get(path), b.get(path)))
}
async function assertLocalDependencies(root: string, definition: SkillDefinition): Promise<void> {
  if (definition.resourceBase?.kind !== 'directory') return
  for (const match of definition.content.matchAll(/(?:\]\(|[`"'\s])((?:\.\.\/|\.\/|references\/|scripts\/|assets\/|templates\/)[^\s)`"'<>]+)/g)) {
    const path = match[1].replace(/[.,;:]$/, '')
    const target = resolve(definition.resourceBase.path, path)
    if (!inside(root, target)) throw Error(`SKILL_DEPENDENCY_OUTSIDE_ROOT: ${path}`)
    if (!(await stat(target).catch(() => undefined))) throw Error(`SKILL_DEPENDENCY_MISSING: ${path}`)
  }
}

function isBinary(data: Buffer): boolean {
  return data.includes(0) || !Buffer.from(data.toString('utf8')).equals(data)
}
function equalEntry(a: Entry | undefined, b: Entry | undefined): boolean {
  return a === undefined || b === undefined ? a === b : a.data.equals(b.data) && (a.mode & 0o111) === (b.mode & 0o111)
}

function snapshotFor(bundle: string, entry: string): SkillDirectorySnapshot {
  return { bundle, entry, root: dirname(join(bundle, 'tree', entry)) }
}
function snapshotOf(value: SkillDirectorySnapshot): SkillDirectorySnapshot {
  return { root: value.root, bundle: value.bundle, entry: value.entry }
}

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function treeDigest(tree: Tree): string {
  const hash = createHash('sha256')
  for (const [path, file] of [...tree].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(JSON.stringify([path, file.mode & 0o777, file.data.length]))
    hash.update(file.data)
  }
  return hash.digest('hex')
}
