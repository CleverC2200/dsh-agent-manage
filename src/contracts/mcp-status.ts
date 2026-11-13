export interface McpStatusTool {
  name: string
  description?: string
}

export type McpStatusKind = 'plugin' | 'direct'

export type McpStatusState = 'connected' | 'degraded' | 'failed' | 'needs-credentials' | 'orphaned' | 'disabled' | 'foreign'

export type McpConnectionState = 'connecting' | 'connected' | 'failed' | 'awaiting-authorization' | 'authorization-cancelled' | 'authorization-failed'

export interface McpStatusEntry {
  id: string
  name: string
  kind: McpStatusKind

  managed?: boolean

  canReauthorize?: boolean

  connectionState?: McpConnectionState
  state: McpStatusState
  source?: string
  suiteId?: string
  serverKey?: string
  transport: string
  endpoint?: string
  config?: Record<string, unknown>
  tools: McpStatusTool[]
  reason?: string

  code?: 'unsupported-transport' | 'missing-credential' | 'credential-error' | 'unmount-failed' | 'mount-failed' | 'foreign-mount' | 'duplicate-mount'

  credentialRefs?: string[]

  advertisedTools?: boolean

  retryable?: boolean
}

export interface McpStatusPayload {
  entries: McpStatusEntry[]
  observedAt: string
  totals: { all: number; connected: number; degraded: number; failed: number; needsCredentials: number; orphaned: number; disabled: number; foreign: number }
  directObservationOnly: boolean
}
