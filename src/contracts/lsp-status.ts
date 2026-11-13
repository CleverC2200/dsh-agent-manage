export type LspStatusKind = 'plugin' | 'direct'

export type LspStatusState = 'mounted' | 'starting' | 'host-missing' | 'failed' | 'conflict' | 'disabled'

export interface LspStatusEntry {
  id: string

  serverKey: string

  suiteId: string

  suiteName: string

  sourceId: string

  kind: LspStatusKind

  command: string

  args: string[]

  extensions: Record<string, string>

  state: LspStatusState

  reason?: string

  retryable?: boolean
}

export interface LspStatusPayload {
  entries: LspStatusEntry[]
  observedAt: string
  totals: { all: number; mounted: number; failed: number; blocked: number; disabled: number }

  hostMissing: boolean
}
