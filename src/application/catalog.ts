import { RuntimeManagement, type RuntimeHost } from './runtime-management.js'
import { mkdir, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { repoName } from '../catalog/manifests.js'
import { canonicalGitUrl } from '../catalog/scan-resolvers.js'
import { discoverSourceListWithNotes } from '../catalog/source-catalog.js'
import { discoverSuitesInSource } from '../catalog/suite-scanner.js'
import { archiveInstall } from '../catalog/archive.js'
import { gitClone, gitCurrentBranch, gitHead, gitRemoteUrl, gitRemove, gitSetRemoteUrl, gitSync, type GitOptions } from '../catalog/git.js'
import { loadUserMcpSuite } from '../runtime/mcp-direct-config.js'
import { loadSuiteOverrides } from '../runtime/mcp-overrides.js'
import { readLocalePreference } from '../runtime/host-locale.js'
import { applyLspOverrides } from '../runtime/server-config.js'
import { githubCloneUrl, resolveRegion, type DownloadRegionSetting } from '../runtime/regions.js'
import type { OverviewPayload, SkillContent, SourceOverview, SuiteDetail } from '../contracts/market.js'
import { buildSuiteDetail, readSkillContent } from './details.js'
import {
  deriveSourceIdCandidates,
  expandHome,
  isDirectory,
  pathExists,
  qualifiedSuiteId,
  resolveProjectRoot,
  sanitizeId,
  sourceCheckoutDir,
  sourcesDir,
  STATE_FILE_NAME
} from '../catalog/paths.js'
import { loadState, saveState, EMPTY_STATE } from '../model/state.js'
import {
  effectiveSurfaces,
  SUITE_SURFACE_KEYS,
  type InstalledEntry,
  type SourceKind,
  type SourceRef,
  type Suite,
  type SuiteDimension,
  type SuiteState,
  type SuiteSurfaceKey,
  type SurfaceOverrides,
  resolveSourceKind
} from '../model/types.js'

export interface CatalogGitOptions extends GitOptions {
  fallbackTarball?: boolean

  allowHttpArchives?: boolean
}

export interface CatalogOptions {
  userRoot: string
  dataRoot: string
  runtime?: RuntimeHost
  onChanged: () => void | Promise<void>

  git?: CatalogGitOptions

  projectSnapshotTtlMs?: number

  userSnapshotTtlMs?: number
}

export interface CatalogSnapshot {
  revision: number
  sources: SourceRef[]
  suites: Suite[]
  enabledSuites: Suite[]

  scanNotes?: Record<string, string[]>
}

export class Catalog {
  private state: SuiteState = EMPTY_STATE
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly statePath: string
  private readonly headCache = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private userSnapshot: CatalogSnapshot | undefined
  private userSnapshotExpiresAt = 0
  private userSnapshotPromise: Promise<CatalogSnapshot> | undefined

  private readonly scanCache = new Map<string, { at: number; discovered: Suite[]; scanNotes: Record<string, string[]> }>()
  private scanGeneration = 0
  private readonly scanPromises = new Map<string, Promise<{ suites: Suite[]; scanNotes: Record<string, string[]> }>>()
  private static readonly SCAN_CACHE_TTL_MS = 30_000
  private static readonly SCAN_CACHE_MAX_ENTRIES = 8

  private readonly userSnapshotTtlMs: number

  private readonly projectSnapshots = new Map<string, { snapshot: CatalogSnapshot; expiresAt: number }>()
  private readonly projectSnapshotPromises = new Map<string, Promise<CatalogSnapshot>>()
  private readonly projectSnapshotTtlMs: number
  readonly runtime: RuntimeManagement

  private downloadRegionProvider: () => Promise<DownloadRegionSetting> = async () => 'auto'
  private scanProjectLayouts = true

  async setScanProjectLayouts(enabled: boolean): Promise<void> {
    if (this.scanProjectLayouts === enabled) return
    this.scanProjectLayouts = enabled
    await this.notifyChanged()
  }

  constructor(private readonly options: CatalogOptions) {
    this.runtime = new RuntimeManagement(
      options.dataRoot,
      {
        suites: async () => (await this.readUserCatalog()).suites,
        enabledSuites: () => this.enabledUserSuites(),
        resolveSuite: (sourceId, suiteId) => this.resolveRuntimeSuite(sourceId, suiteId),
        change: operation =>
          this.enqueue(async () => {
            const result = await operation()
            await this.notifyChanged(true)
            return result
          }),
        downloadRegion: () => this.downloadRegionProvider()
      },
      options.runtime
    )
    this.statePath = join(options.userRoot, STATE_FILE_NAME)
    this.projectSnapshotTtlMs = options.projectSnapshotTtlMs ?? 5_000
    this.userSnapshotTtlMs = options.userSnapshotTtlMs ?? Catalog.SCAN_CACHE_TTL_MS
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setDownloadRegionProvider(provider: () => Promise<DownloadRegionSetting>): void {
    this.downloadRegionProvider = provider
  }

  private async resolveRuntimeSuite(sourceId: string, suiteId: string): Promise<Suite> {
    const source = this.state.sources.find(entry => entry.id === sourceId)
    if (source === undefined) throw new Error(`unknown source "${sourceId}"`)
    const checkout = this.sourceCheckoutPath(source)
    if (!(await isDirectory(checkout))) await this.acquire(source)
    const suites = await discoverSuitesInSource(checkout, sourceId, 'user', source.url)
    const suite = suites.find(entry => entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    return suite
  }

  async load(): Promise<void> {
    this.state = await loadState(this.statePath)
    this.invalidateScans()
    this.invalidateSnapshot(false)
  }

  get sources(): SourceRef[] {
    return this.state.sources
  }

  async readSourceSnapshot(sourceId: string, suiteId: string): Promise<{ source: SourceRef; suite: Suite; lockCommit?: string; generation: number }> {
    return this.enqueue(async () => {
      const source = this.state.sources.find(entry => entry.id === sourceId)
      if (!source) throw Error('AGENT_SOURCE_NOT_FOUND')
      const checkout = this.sourceCheckoutPath(source)
      const before = await tryHead(checkout)
      const suite = (await discoverSuitesInSource(checkout, sourceId, 'user', source.url)).find(entry => entry.id === suiteId)
      if (!suite) throw Error('AGENT_SOURCE_SUITE_NOT_FOUND')
      const after = await tryHead(checkout)
      if (before !== after) throw Error('AGENT_SOURCE_PREVIEW_STALE')
      return { source: { ...source }, suite, lockCommit: after ?? this.headCache.get(sourceId), generation: this.scanGeneration }
    })
  }

  get userRoot(): string {
    return this.options.userRoot
  }

  async readUserCatalog(): Promise<CatalogSnapshot> {
    if (this.userSnapshotTtlMs <= 0) return this.buildSnapshot(this.state, 'user', this.options.userRoot)
    if (this.userSnapshot !== undefined && Date.now() < this.userSnapshotExpiresAt) return this.userSnapshot
    if (this.userSnapshotPromise !== undefined) return this.userSnapshotPromise
    const revision = this.revision
    const generation = this.scanGeneration
    const promise = this.buildSnapshot(this.state, 'user', this.options.userRoot)
      .then(snapshot => {
        if (revision === this.revision && generation === this.scanGeneration) {
          this.userSnapshot = snapshot
          this.userSnapshotExpiresAt = Date.now() + this.userSnapshotTtlMs
        }
        return snapshot
      })
      .finally(() => {
        if (this.userSnapshotPromise === promise) this.userSnapshotPromise = undefined
      })
    this.userSnapshotPromise = promise
    return promise
  }

  async readInstalledSuites(sourceId?: string): Promise<Suite[]> {
    const state = this.state
    const installedSources = new Set(Object.keys(state.installed).map(key => key.slice(0, key.indexOf('/'))))
    const sources = state.sources.filter(source => installedSources.has(source.id) && (sourceId === undefined || source.id === sourceId))
    if (sources.length === 0) return []
    const snapshot = await this.buildSnapshot({ ...state, sources }, 'user', this.options.userRoot)
    return snapshot.suites.filter(suite => suite.remote === undefined && state.installed[installKey(suite.sourceId, suite.id)] !== undefined)
  }

  async readProjectCatalog(cwd: string): Promise<CatalogSnapshot> {
    const projectRoot = await resolveProjectRoot(cwd)
    if (this.projectSnapshotTtlMs <= 0) return this.buildProjectSnapshot(projectRoot)
    const cached = this.projectSnapshots.get(projectRoot)
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.snapshot
    const inFlight = this.projectSnapshotPromises.get(projectRoot)
    if (inFlight !== undefined) return inFlight
    const revision = this.revision
    const generation = this.scanGeneration
    const promise = this.buildProjectSnapshot(projectRoot)
      .then(snapshot => {
        if (revision === this.revision && generation === this.scanGeneration) {
          this.projectSnapshots.set(projectRoot, { snapshot, expiresAt: Date.now() + this.projectSnapshotTtlMs })
        }
        return snapshot
      })
      .finally(() => {
        if (this.projectSnapshotPromises.get(projectRoot) === promise) this.projectSnapshotPromises.delete(projectRoot)
      })
    this.projectSnapshotPromises.set(projectRoot, promise)
    return promise
  }

  private async buildProjectSnapshot(projectRoot: string): Promise<CatalogSnapshot> {
    const state = await loadState(join(projectRoot, STATE_FILE_NAME))

    return this.buildSnapshot(state, 'project', projectRoot, this.projectSnapshotTtlMs <= 0)
  }

  async suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail> {
    const snapshot = await this.readUserCatalog()
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    const suiteKey = qualifiedSuiteId(sourceId, suiteId)
    return buildSuiteDetail(suite, this.state.installed[installKey(sourceId, suiteId)], this.runtime.mcpDiagnostics, await loadSuiteOverrides(this.options.dataRoot, suiteKey))
  }

  async skillContent(sourceId: string, suiteId: string, skillName: string): Promise<SkillContent> {
    const snapshot = await this.readUserCatalog()
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    return readSkillContent(suite, skillName)
  }

  async overview(): Promise<OverviewPayload> {
    const snapshot = await this.readUserCatalog()
    const sourceRows: SourceOverview[] = []
    for (const source of snapshot.sources) {
      const checkout = this.sourceCheckoutPath(source)
      const kind = resolveSourceKind(source)
      let cloned = false
      let lockCommit: string | undefined
      let error: string | undefined
      if (kind === 'local') {
        cloned = await isDirectory(checkout)
        if (!cloned) error = `local source directory ${checkout} is missing`
      } else if (kind === 'archive') {
        cloned = await isDirectory(checkout)
        lockCommit = this.headCache.get(source.id)
      } else {
        const cachedHead = this.headCache.get(source.id)
        if (cachedHead !== undefined && (await isDirectory(checkout))) {
          cloned = true
          lockCommit = cachedHead
        } else {
          try {
            lockCommit = await gitHead(checkout)
            cloned = true
            this.headCache.set(source.id, lockCommit)
          } catch {}
        }
      }
      const sourceSuites = snapshot.suites.filter(suite => suite.sourceId === source.id)
      const scanNotes = snapshot.scanNotes?.[source.id]
      sourceRows.push({
        id: source.id,
        url: source.url,
        ...(source.branch === undefined ? {} : { branch: source.branch }),
        ...(source.local === true ? { local: true } : {}),
        kind,
        ...(source.adopted === true ? { adopted: true } : {}),
        cloned,
        ...(lockCommit === undefined ? {} : { lockCommit }),
        ...(error === undefined ? {} : { error }),
        ...(scanNotes === undefined ? {} : { scanNotes }),
        suiteIds: sourceSuites.map(suite => suite.id)
      })
    }
    const installed = new Set(Object.keys(this.state.installed))
    const cards = snapshot.suites.map(suite => ({
      sourceId: suite.sourceId,
      suiteId: suite.id,
      name: suite.manifest.name,
      version: suite.manifest.version,
      description: suite.manifest.description,
      keywords: suite.manifest.keywords ?? [],
      surfaces: suite.surfaces,
      enabled: suite.enabled,
      installed: installed.has(installKey(suite.sourceId, suite.id)),
      ...(installed.has(installKey(suite.sourceId, suite.id)) ? { surfaceToggles: suite.activeSurfaces } : {}),
      ...(suite.remote === undefined ? {} : { remoteUrl: suite.remote.url }),
      dimension: suite.dimension,
      layout: suite.manifest.layout,
      errors: suite.errors,
      mcpErrors: this.runtime.mcpDiagnostics.filter(diagnostic => diagnostic.suiteId === suite.id).map(diagnostic => `${diagnostic.serverKey}: ${diagnostic.reason}`)
    }))
    return {
      sources: sourceRows,
      suites: cards,
      totals: {
        all: cards.length,
        installed: cards.filter(card => card.installed).length,
        enabled: cards.filter(card => card.enabled).length
      },
      roots: { user: this.options.userRoot, data: this.options.dataRoot },
      unmanaged: await this.unmanagedSources()
    }
  }

  async enabledUserSuites(): Promise<Suite[]> {
    const enabledSources = new Set(
      Object.entries(this.state.installed)
        .filter(([, entry]) => entry.enabled)
        .map(([key]) => key.slice(0, key.indexOf('/')))
    )
    const sources = this.state.sources.filter(source => enabledSources.has(source.id))
    const suites = sources.length === 0 ? [] : (await this.buildSnapshot({ ...this.state, sources }, 'user', this.options.userRoot)).enabledSuites
    const direct = await loadUserMcpSuite(this.options.dataRoot)
    return applyLspOverrides(this.options.dataRoot, Object.keys(direct.mcp!.servers).length === 0 ? suites : [...suites, direct])
  }

  async enabledSuitesForCwd(cwd: string): Promise<{ user: Suite[]; project: Suite[] }> {
    const [user, project] = await Promise.all([this.enabledUserSuites(), this.readProjectCatalog(cwd)])
    return { user, project: project.enabledSuites }
  }

  async suitesForDimension(dimension: SuiteDimension, dimensionRoot: string): Promise<Suite[]> {
    const state = dimension === 'user' && dimensionRoot === this.options.userRoot ? this.state : await loadState(join(dimensionRoot, STATE_FILE_NAME))
    return (await this.buildSnapshot(state, dimension, dimensionRoot)).suites
  }

  async addSource(input: { url: string; branch?: string; local?: boolean; kind?: SourceKind; sha256?: string }): Promise<SourceRef> {
    return this.enqueue(async () => {
      const kind = input.local === true ? ('local' as const) : resolveSourceKind({ url: input.url, kind: input.kind })
      if (kind === 'git') {
        const adoptable = await this.findAdoptableCheckout(input.url, deriveSourceIdCandidates(input.url))
        if (adoptable !== undefined) {
          const source: SourceRef = {
            id: adoptable,
            url: input.url,
            ...(input.branch === undefined ? {} : { branch: input.branch }),
            kind: 'git',
            adopted: true
          }
          const head = await tryHead(sourceCheckoutDir(this.options.userRoot, adoptable))
          if (head !== undefined) this.headCache.set(source.id, head)
          this.state = { ...this.state, sources: [...this.state.sources, source] }
          await saveState(this.statePath, this.state)
          await this.notifyChanged()
          return source
        }
      }
      const baseId = await this.pickSourceId(deriveSourceIdCandidates(input.url), kind === 'local')
      const source: SourceRef = {
        id: baseId,
        url: input.url,
        ...(input.branch === undefined ? {} : { branch: input.branch }),
        ...(kind === 'local' ? { local: true as const } : { kind }),
        ...(input.kind === 'archive' && input.sha256 !== undefined && input.sha256 !== '' ? { sha256: input.sha256 } : {})
      }
      if (kind !== 'local') this.currentSourceState = { sourceId: baseId, step: kind === 'archive' ? 'downloading' : 'cloning' }
      try {
        let checkout = this.sourceCheckoutPath(source)
        if (kind === 'local') {
          if (!(await isDirectory(checkout))) throw new Error(`local source directory ${checkout} is missing`)
        } else {
          const lock = await this.acquire(source)
          if (lock !== undefined) this.headCache.set(source.id, lock)
          this.currentSourceState = { sourceId: baseId, step: 'reading' }
        }

        const named = [...new Set([sanitizeId(await repoName(checkout)), ...deriveSourceIdCandidates(input.url)])]
        const finalId = await this.pickSourceId(named, kind === 'local', kind === 'local' ? undefined : checkout)
        if (kind !== 'local' && finalId !== baseId) {
          const targetDir = sourceCheckoutDir(this.options.userRoot, finalId)
          await rename(checkout, targetDir)
          checkout = targetDir
        }
        source.id = finalId
        if (resolveSourceKind(source) === 'git') {
          const head = await tryHead(checkout)
          if (head !== undefined) this.headCache.set(source.id, head)
        }
        this.state = { ...this.state, sources: [...this.state.sources, source] }
        await saveState(this.statePath, this.state)
        await this.notifyChanged()
        return source
      } finally {
        this.currentSourceState = undefined
      }
    })
  }

  private async findAdoptableCheckout(url: string, candidates: string[]): Promise<string | undefined> {
    const registered = new Set(this.state.sources.map(source => source.id))
    for (const candidate of candidates) {
      if (registered.has(candidate)) continue
      const dir = sourceCheckoutDir(this.options.userRoot, candidate)
      if (!(await isDirectory(dir))) continue
      let origin: string | undefined
      try {
        origin = await gitRemoteUrl(dir)
      } catch {
        continue
      }
      if (origin !== '' && canonicalGitUrl(origin) === canonicalGitUrl(url)) return candidate
    }
    return undefined
  }

  async adoptSource(id: string): Promise<SourceRef> {
    return this.enqueue(async () => {
      if (this.state.sources.some(source => source.id === id)) throw new Error(`source "${id}" is already registered`)

      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id.includes('..')) {
        throw new Error(`invalid checkout id "${id}" — use letters, digits, dots, dashes, or underscores`)
      }
      const dir = sourceCheckoutDir(this.options.userRoot, id)
      if (!(await isDirectory(dir))) throw new Error(`no checkout directory at ${dir}`)
      let source: SourceRef
      try {
        const origin = await gitRemoteUrl(dir)
        source = { id, url: origin, kind: 'git', adopted: true }
        const head = await tryHead(dir)
        if (head !== undefined) this.headCache.set(id, head)
      } catch {
        source = { id, url: dir, local: true, adopted: true }
      }
      this.state = { ...this.state, sources: [...this.state.sources, source] }
      await saveState(this.statePath, this.state)
      await this.notifyChanged()
      return source
    })
  }

  async unmanagedSources(): Promise<Array<{ id: string; url?: string }>> {
    const checkoutRoot = sourcesDir(this.options.userRoot)
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(checkoutRoot, { withFileTypes: true })
    } catch {
      return []
    }
    const registered = new Set(this.state.sources.map(source => source.id))
    const unmanaged: Array<{ id: string; url?: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || registered.has(entry.name)) continue
      const dir = join(checkoutRoot, entry.name)
      try {
        unmanaged.push({ id: entry.name, url: await gitRemoteUrl(dir) })
      } catch {
        unmanaged.push({ id: entry.name })
      }
    }
    return unmanaged
  }

  private currentSourceState: { sourceId: string; step: string } | undefined

  sourceProgress(): { active: boolean; sourceId: string; step: string } {
    const state = this.currentSourceState
    return state === undefined ? { active: false, sourceId: '', step: '' } : { active: true, sourceId: state.sourceId, step: state.step }
  }

  private async pickSourceId(candidates: string[], skipDisk: boolean, ownedCheckout?: string): Promise<string> {
    const free = async (id: string): Promise<boolean> => {
      if (this.state.sources.some(source => source.id === id)) return false
      if (skipDisk) return true
      const dir = sourceCheckoutDir(this.options.userRoot, id)
      return dir === ownedCheckout || !(await pathExists(dir))
    }
    for (const candidate of candidates) {
      if (await free(candidate)) return candidate
    }
    for (let suffix = 2; ; suffix++) {
      const candidate = `${candidates[0]}-${suffix}`
      if (await free(candidate)) return candidate
    }
  }

  async updateSource(sourceId: string, patch: { url?: string; branch?: string; local?: boolean; kind?: SourceKind; sha256?: string }): Promise<void> {
    return this.enqueue(async () => {
      const index = this.state.sources.findIndex(source => source.id === sourceId)
      if (index === -1) throw new Error(`unknown source "${sourceId}"`)
      const current = this.state.sources[index]!
      const nextLocal = patch.local !== undefined ? patch.local : current.local === true

      const nextKind: SourceKind | undefined = nextLocal ? undefined : (patch.kind ?? current.kind)
      const next: SourceRef = {
        id: sourceId,
        url: patch.url ?? current.url,
        ...(patch.branch !== undefined ? { branch: patch.branch } : current.branch === undefined ? {} : { branch: current.branch }),
        ...(nextLocal ? { local: true } : {}),
        ...(nextKind === undefined ? {} : { kind: nextKind }),
        ...(patch.sha256 !== undefined ? (patch.sha256 === '' ? {} : { sha256: patch.sha256 }) : current.sha256 === undefined ? {} : { sha256: current.sha256 }),
        ...(current.adopted === true ? { adopted: true } : {})
      }
      const urlChanged = patch.url !== undefined && patch.url !== current.url

      if (urlChanged && current.local !== true && current.adopted !== true) {
        this.headCache.delete(sourceId)
        await gitRemove(sourceCheckoutDir(this.options.userRoot, sourceId))
      }
      this.state = { ...this.state, sources: this.state.sources.map((source, i) => (i === index ? next : source)) }
      await saveState(this.statePath, this.state)
      await this.notifyChanged()
    })
  }

  async removeSource(sourceId: string, deleteCheckout = false): Promise<void> {
    return this.enqueue(async () => {
      const source = this.state.sources.find(entry => entry.id === sourceId)
      this.state = {
        ...this.state,
        sources: this.state.sources.filter(entry => entry.id !== sourceId),
        installed: Object.fromEntries(Object.entries(this.state.installed).filter(([key]) => !key.startsWith(`${sourceId}/`)))
      }
      await saveState(this.statePath, this.state)
      this.headCache.delete(sourceId)

      const externalLocal = source?.local === true && source.url !== sourceCheckoutDir(this.options.userRoot, sourceId)
      if (!externalLocal && deleteCheckout) await gitRemove(sourceCheckoutDir(this.options.userRoot, sourceId))
      await this.notifyChanged()
    })
  }

  async refreshSource(sourceId?: string): Promise<void> {
    return this.enqueue(async () => {
      const targets = sourceId === undefined ? this.state.sources : this.state.sources.filter(source => source.id === sourceId)
      for (const source of targets) {
        const kind = resolveSourceKind(source)
        if (kind === 'local') {
          if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
          continue
        }
        const checkout = sourceCheckoutDir(this.options.userRoot, source.id)
        this.headCache.delete(source.id)
        if (kind === 'archive') {
          const lock = await this.acquire(source)
          if (lock !== undefined) this.headCache.set(source.id, lock)
          continue
        }

        if (source.adopted === true) {
          try {
            this.headCache.set(source.id, await gitHead(checkout))
          } catch {}
          continue
        }
        try {
          await gitHead(checkout)
        } catch {
          const lock = await this.acquire(source)
          if (lock !== undefined) {
            this.headCache.set(source.id, lock)
          } else {
            try {
              this.headCache.set(source.id, await gitHead(checkout))
            } catch {}
          }
          continue
        }

        const branch = source.branch ?? (await gitCurrentBranch(checkout).catch(() => undefined))

        if (source.kind === 'git' || (source.kind === undefined && source.local !== true)) {
          try {
            const region = resolveRegion(await this.downloadRegionProvider(), await readLocalePreference())
            const routed = githubCloneUrl(region, source.url)
            const origin = await gitRemoteUrl(checkout)
            if (origin !== routed && (origin === source.url || origin === githubCloneUrl('china', source.url))) {
              await gitSetRemoteUrl(checkout, routed)
            }
          } catch {}
        }
        await gitSync(checkout, branch, this.options.git ?? {})
        try {
          this.headCache.set(source.id, await gitHead(checkout))
        } catch {}
      }
      await this.notifyChanged()
    })
  }

  async install(sourceId: string, suiteId: string, options: { surfaces?: SurfaceOverrides; configurationOnly?: true } = {}): Promise<void> {
    return this.enqueue(async () => {
      const source = this.state.sources.find(entry => entry.id === sourceId)
      if (source === undefined) throw new Error(`unknown source "${sourceId}"`)
      const checkout = this.sourceCheckoutPath(source)
      let freshLock: string | undefined
      if (!(await isDirectory(checkout))) freshLock = await this.acquire(source)
      const suites = await discoverSuitesInSource(checkout, sourceId, 'user', source.url)
      const suite = suites.find(entry => entry.id === suiteId)
      if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
      if (suite.remote !== undefined) throw new Error(`suite "${suiteId}" is a remote reference (${suite.remote.url}); add its repository as a source before installing`)

      const lockCommit = (await tryHead(checkout)) ?? freshLock ?? this.headCache.get(sourceId)
      await this.setInstalled(sourceId, suiteId, {
        enabled: true,
        installedAt: new Date().toISOString(),
        lockCommit,
        ...(options.surfaces ? { surfaces: options.surfaces } : {}),
        ...(options.configurationOnly ? { configurationOnly: true as const } : {})
      })
      await this.notifyChanged(true)
    })
  }

  async uninstall(sourceId: string, suiteId: string): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      if (this.state.installed[key] === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      const rest = Object.fromEntries(Object.entries(this.state.installed).filter(([entryKey]) => entryKey !== key))
      this.state = { ...this.state, installed: rest }
      await saveState(this.statePath, this.state)
      await this.notifyChanged(true)
    })
  }

  async setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      const entry = this.state.installed[key]
      if (entry === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      await this.setInstalled(sourceId, suiteId, { ...entry, enabled })
      await this.notifyChanged(true)
    })
  }

  async setSurface(sourceId: string, suiteId: string, surface: SuiteSurfaceKey, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      const entry = this.state.installed[key]
      if (entry === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      if (!SUITE_SURFACE_KEYS.includes(surface as SuiteSurfaceKey)) throw new Error(`surface "${surface}" is not toggleable`)
      const surfaces: SurfaceOverrides = { ...(entry.surfaces ?? {}), [surface]: enabled }
      await this.setInstalled(sourceId, suiteId, { ...entry, surfaces })
      await this.notifyChanged(true)
    })
  }

  async mergeSources(sources: SourceRef[]): Promise<void> {
    const existing = new Set(this.state.sources.map(source => source.id))
    const additions = sources.filter(source => !existing.has(source.id))
    if (additions.length === 0) return
    this.state = { ...this.state, sources: [...this.state.sources, ...additions] }
    await saveState(this.statePath, this.state)

    this.invalidateScans()
    this.invalidateSnapshot(true)
  }

  async changePanelResources<T>(change: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const result = await change()
      await this.notifyChanged()
      return result
    })
  }

  private async setInstalled(sourceId: string, suiteId: string, entry: InstalledEntry): Promise<void> {
    this.state = { ...this.state, installed: { ...this.state.installed, [installKey(sourceId, suiteId)]: entry } }
    await saveState(this.statePath, this.state)
  }

  private async acquire(source: SourceRef): Promise<string | undefined> {
    const kind = resolveSourceKind(source)
    if (kind === 'local') {
      if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
      return undefined
    }
    const checkout = sourceCheckoutDir(this.options.userRoot, source.id)
    await mkdir(sourcesDir(this.options.userRoot), { recursive: true })
    if (kind === 'archive') {
      const { sha256 } = await archiveInstall(source.url, checkout, {
        ...(process.env['DSH_AGENT_MANAGE_GITHUB_TOKEN'] === undefined ? {} : { githubToken: process.env['DSH_AGENT_MANAGE_GITHUB_TOKEN'] }),
        ...(source.sha256 === undefined ? {} : { sha256: source.sha256 }),
        ...(this.options.git?.timeoutMs === undefined ? {} : { timeoutMs: this.options.git.timeoutMs }),
        ...(this.options.git?.allowHttpArchives === true ? { allowHttp: true } : {})
      })
      return sha256
    }
    try {
      const region = resolveRegion(await this.downloadRegionProvider(), await readLocalePreference())
      await gitClone(githubCloneUrl(region, source.url), source.branch, checkout, this.options.git ?? {})
      return undefined
    } catch (error) {
      if (this.options.git?.fallbackTarball !== true) throw error
      const tarballUrl = codeloadTarballUrl(source.url, source.branch)
      if (tarballUrl === undefined) throw error

      const { sha256 } = await archiveInstall(tarballUrl, checkout, {
        ...(this.options.git?.timeoutMs === undefined ? {} : { timeoutMs: this.options.git.timeoutMs }),
        format: 'targz'
      })
      return sha256
    }
  }

  private sourceCheckoutPath(source: SourceRef): string {
    return source.local === true ? expandHome(source.url) : sourceCheckoutDir(this.options.userRoot, source.id)
  }

  private async buildSnapshot(state: SuiteState, dimension: SuiteDimension, dimensionRoot: string, skipScanCache = false): Promise<CatalogSnapshot> {
    const fingerprint = JSON.stringify([dimension, dimensionRoot, state.sources, this.scanProjectLayouts])
    const cached = this.scanCache.get(fingerprint)

    const scanCacheTtl = dimension === 'user' ? Math.min(this.userSnapshotTtlMs, Catalog.SCAN_CACHE_TTL_MS) : Catalog.SCAN_CACHE_TTL_MS
    const cacheFresh = !skipScanCache && cached !== undefined && Date.now() - cached.at < scanCacheTtl
    let discovered: Suite[]
    let scanNotes: Record<string, string[]>
    if (cacheFresh && cached !== undefined) {
      discovered = cached.discovered
      scanNotes = cached.scanNotes
    } else {
      const generation = this.scanGeneration
      let pending = this.scanPromises.get(fingerprint)
      if (pending === undefined) {
        pending = discoverSourceListWithNotes(state.sources, dimension, dimensionRoot, this.scanProjectLayouts)
        this.scanPromises.set(fingerprint, pending)
      }
      let result: Awaited<typeof pending>
      try {
        result = await pending
      } finally {
        if (this.scanPromises.get(fingerprint) === pending) this.scanPromises.delete(fingerprint)
      }
      discovered = result.suites
      scanNotes = result.scanNotes

      if (generation === this.scanGeneration) {
        if (this.scanCache.size >= Catalog.SCAN_CACHE_MAX_ENTRIES) this.scanCache.clear()
        this.scanCache.set(fingerprint, { at: Date.now(), discovered, scanNotes })
      }
    }
    const suites = discovered.map(suite => {
      const installed = state.installed[installKey(suite.sourceId, suite.id)]

      const enabled = suite.manifest.layout === 'project-native' || installed?.enabled === true
      return {
        ...suite,
        ...(installed?.configurationOnly ? { configurationOnly: true as const } : {}),
        enabled,
        activeSurfaces: {
          ...effectiveSurfaces(installed?.surfaces),
          ...(suite.manifest.layout === 'project-native' ? suite.activeSurfaces : {}),
          ...(dimension === 'project' ? { lsp: false } : {})
        },
        ...(installed?.lockCommit === undefined ? {} : { lockCommit: installed.lockCommit }),
        ...(installed?.installedAt === undefined ? {} : { installedAt: installed.installedAt })
      }
    })
    return {
      revision: this.revision,
      sources: [...state.sources],
      suites,
      enabledSuites: suites.filter(suite => suite.enabled),
      ...(Object.keys(scanNotes).length > 0 ? { scanNotes } : {})
    }
  }

  private invalidateSnapshot(increment: boolean): void {
    if (increment) this.revision++
    this.userSnapshot = undefined
    this.userSnapshotExpiresAt = 0
    this.userSnapshotPromise = undefined
    this.projectSnapshots.clear()
    this.projectSnapshotPromises.clear()
  }

  private invalidateScans(): void {
    this.scanGeneration++
    this.scanCache.clear()
    this.scanPromises.clear()
  }

  private async notifyChanged(keepScanCache = false): Promise<void> {
    if (!keepScanCache) this.invalidateScans()
    this.invalidateSnapshot(true)
    await this.options.onChanged()
    await this.runtime.reconcile()
    for (const listener of this.listeners) listener()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.catch(() => {})
    return result
  }
}

function installKey(sourceId: string, suiteId: string): string {
  return `${sourceId}/${suiteId}`
}

async function tryHead(dir: string): Promise<string | undefined> {
  try {
    return await gitHead(dir)
  } catch {
    return undefined
  }
}

export function codeloadTarballUrl(url: string, branch: string | undefined): string | undefined {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (match === null) return undefined
  const [, owner, repo] = match
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${branch === undefined ? 'HEAD' : `refs/heads/${branch}`}`
}
