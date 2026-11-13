export type SourceKind = 'git' | 'local' | 'archive'

export interface SourceRef {
  id: string

  url: string

  branch?: string

  local?: boolean

  kind?: SourceKind

  sha256?: string

  adopted?: boolean
}

const ARCHIVE_URL_PATTERN = /\.(zip|tgz|tar\.gz|tar)$/i

export function isArchiveUrl(url: string): boolean {
  return ARCHIVE_URL_PATTERN.test(url.trim())
}

export function resolveSourceKind(source: Pick<SourceRef, 'url' | 'local' | 'kind'>): SourceKind {
  if (source.local === true || source.kind === 'local') return 'local'
  if (source.kind === 'git' || source.kind === 'archive') return source.kind
  return isArchiveUrl(source.url) ? 'archive' : 'git'
}

export type SuiteLayoutKind = import('./layouts.js').ManifestKind | 'skill-collection' | 'remote' | 'project-native'

export interface SuiteManifest {
  components?: SuiteComponents
  skillInstructions?: string
  startupSkill?: string
  systemPrompt?: string
  systemPromptPath?: string
  layout: SuiteLayoutKind

  path: string

  id: string
  name: string
  version?: string
  description?: string
  author?: string
  keywords?: string[]

  schemaVersion?: string
}

export interface SuiteComponents {
  skills?: unknown
  commands?: unknown
  agents?: unknown
  hooks?: unknown
  mcpServers?: unknown
  lspServers?: unknown
}

export interface SuiteMarkdownResource {
  name: string
  file: string

  content?: string
}

export interface SuiteSkill {
  name: string

  directory: string

  file: string

  description: string

  whenToUse?: string

  invocation: { modelInvocable: boolean; userInvocable: boolean }
}

export interface SuiteSurfaceCounts {
  skills: number
  mcp: number
  hooks: number
  commands: number
  agents: number
  lsp: number
}

export interface McpServerPolicy {
  enabledTools?: string[]
  disabledTools?: string[]
  startupTimeoutMs?: number
  toolCallTimeoutMs?: number
}

export interface McpServerStdio extends McpServerPolicy {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface McpServerStreamableHttp extends McpServerPolicy {
  type: 'streamable-http'
  url: string
  headers?: Record<string, string>

  auth?: { enabled: boolean; scope?: string }
}

export interface McpServerSse extends McpServerPolicy {
  type: 'sse'
  url: string
  headers?: Record<string, string>

  auth?: { enabled: boolean; scope?: string }
}

export type McpServer = McpServerStdio | McpServerStreamableHttp | McpServerSse

export interface McpSuiteConfig {
  root?: string

  serverRoots?: Record<string, string>
  schema: string
  servers: Record<string, McpServer>
}

export interface LspServerSpec {
  key: string

  command: string

  args: string[]

  extensionToLanguage: Record<string, string>

  env?: Record<string, string>

  initializationOptions?: unknown

  configuration?: unknown
}

export interface LspSuiteConfig {
  servers: Record<string, LspServerSpec>
}

export type SuiteDimension = 'user' | 'project'

export interface Suite {
  configurationOnly?: true
  resources?: { commands: SuiteMarkdownResource[]; agents: SuiteMarkdownResource[] }
  systemPrompt?: string

  hooks?: ProjectHooks
  sourceId: string
  id: string
  root: string
  manifest: SuiteManifest
  skills: SuiteSkill[]

  mcp?: McpSuiteConfig

  lsp?: LspSuiteConfig
  surfaces: SuiteSurfaceCounts
  dimension: SuiteDimension
  enabled: boolean

  activeSurfaces?: Record<SuiteSurfaceKey, boolean>
  lockCommit?: string
  installedAt?: string

  remote?: { url: string }

  errors: string[]
}

export interface ProjectHooks {
  projectRoot: string
  events: Record<string, Array<{ matcher?: string; hooks: Array<{ type: 'command'; command: string; timeout?: number }> }>>
}

export type SuiteSurfaceKey = 'skills' | 'mcp' | 'hooks' | 'commands' | 'agents' | 'lsp'

export type SurfaceOverrides = Partial<Record<SuiteSurfaceKey, boolean>>

export const SUITE_SURFACE_KEYS: readonly SuiteSurfaceKey[] = ['skills', 'mcp', 'hooks', 'commands', 'agents', 'lsp']

export function effectiveSurfaces(overrides: SurfaceOverrides | undefined): Record<SuiteSurfaceKey, boolean> {
  return {
    skills: overrides?.skills !== false,
    mcp: overrides?.mcp !== false,
    hooks: overrides?.hooks !== false,
    commands: overrides?.commands !== false,
    agents: overrides?.agents !== false,
    lsp: overrides?.lsp !== false
  }
}

export interface InstalledEntry {
  configurationOnly?: true
  enabled: boolean
  lockCommit?: string
  installedAt: string

  surfaces?: SurfaceOverrides
}

export interface SuiteState {
  version: 1
  sources: SourceRef[]
  installed: Record<string, InstalledEntry>
}

export type { OverviewPayload, SourceOverview, SuiteOverviewCard } from '../contracts/market.js'
