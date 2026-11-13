export const MARKET_API_PREFIX = '/api/agent-plugins/' as const

export const MARKET_ROUTES = {
  modelCatalog: `${MARKET_API_PREFIX}model-catalog`,
  mcpBackend: `${MARKET_API_PREFIX}mcp-backend`
} as const

export interface ServerConfigPayload {
  kind: 'mcp' | 'lsp'
  id: string
  editable: boolean
  config: Record<string, unknown>
}

export interface ModelCatalogPayload {
  providers: Array<{ id: string; name: string }>
  models: Array<{ id: string; name: string }>
  reasoning?: { efforts: Array<{ id: string; name: string; description?: string }>; defaultEffort?: string }
}

export interface McpBackendPayload {
  backend: 'builtin' | 'host'

  hostClient: { available: boolean; version?: string }

  downloadRegion: { setting: 'auto' | 'global' | 'china'; effective: 'global' | 'china' }
}

export interface UnmanagedSource {
  id: string

  url?: string
}

export interface SourceOverview {
  id: string
  url: string
  branch?: string
  local?: boolean

  kind: string

  adopted?: boolean
  cloned: boolean
  lockCommit?: string
  error?: string

  scanNotes?: string[]
  suiteIds: string[]
}

export interface SuiteSurfaceCounts {
  skills: number
  mcp: number
  hooks: number
  commands: number
  agents: number
  lsp: number
}

export interface SuiteSurfaceToggles {
  skills: boolean
  mcp: boolean
  hooks: boolean
  commands: boolean
  agents: boolean
  lsp: boolean
}

export type McpServerOverrideWire = {
  enabled?: boolean
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  args?: string[]
}

export type McpSuiteOverridesWire = Record<string, McpServerOverrideWire>

export interface SuiteOverviewCard {
  sourceId: string
  suiteId: string
  name: string
  version?: string
  description?: string
  keywords: string[]
  surfaces: SuiteSurfaceCounts
  enabled: boolean
  installed: boolean

  surfaceToggles?: SuiteSurfaceToggles
  dimension: string
  layout: string
  remoteUrl?: string
  errors: string[]
  mcpErrors?: string[]
}

export interface OverviewPayload {
  sources: SourceOverview[]
  suites: SuiteOverviewCard[]
  totals: { all: number; installed: number; enabled: number }
  roots: { user: string; data: string }

  unmanaged?: UnmanagedSource[]
}

export interface SourceProgress {
  active: boolean
  sourceId: string
  step: string
}

export interface SuiteSkillMeta {
  name: string
  description: string
  whenToUse?: string
  path: string
}

export interface MarkdownPreview {
  name: string
  description?: string
  content: string
}

export type CommandPreview = MarkdownPreview

export type AgentPreview = MarkdownPreview

export interface LspPreview {
  name: string
  content: string
}

export interface LspServerPreview {
  key: string
  command: string
  args: string[]

  extensions: Record<string, string>
  env?: Record<string, string>
}

export interface LspSurfaceDetail {
  servers: LspServerPreview[]
  raw: LspPreview[]
}

export interface HookPreview {
  event: string
  matcher?: string
  command: string
}

export interface McpServerDetail {
  key: string
  type: string
  command?: string
  url?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  headers?: Record<string, string>

  credentialRefs: string[]
}

export interface SuiteDetail {
  sourceId: string
  suiteId: string
  name: string
  version: string | null
  description: string | null
  author: string | null
  keywords: string[]
  layout: string
  dimension: string
  root: string
  remoteUrl: string | null
  installed: boolean
  enabled: boolean
  surfaceToggles: SuiteSurfaceToggles | null

  mcpOverrides?: McpSuiteOverridesWire
  skills: SuiteSkillMeta[]
  mcpServers: McpServerDetail[]
  hooks: { count: number; entries: HookPreview[] }
  commands: MarkdownPreview[]
  agents: MarkdownPreview[]
  lsp: LspSurfaceDetail
  errors: string[]
  mcpErrors: string[]
}

export interface SkillContent {
  name: string
  description: string
  content: string
  path: string
}

export interface UserPanelEntryWire {
  name: string
  description: string
  disabled: boolean

  origin: 'user' | 'plugin'
  id?: string
  rawText: string

  suiteName?: string
  metadata: Record<string, unknown>
  path: string
  content: string
}

export type UserPanelKind = 'skills' | 'commands' | 'agents'
