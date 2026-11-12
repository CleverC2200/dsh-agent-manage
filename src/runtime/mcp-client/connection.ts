import type { McpConnectionState } from '../../contracts/mcp-status.js'
import type { LoopbackOAuthClientProvider, AuthorizationState } from './oauth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { MAX_TIMER_DELAY_MS } from './host-seams.js'
import { createTransport } from './transport.js'
import { syncTools } from './tools.js'
import type { ToolBridgeOptions, ToolDisposers, ToolHost } from './tools.js'
import type { Config } from './config.js'

export interface ReconnectConfig {
  enabled?: boolean

  initialDelayMs?: number

  maxDelayMs?: number

  maxAttempts?: number
}

export const RECONNECT_DEFAULTS: Required<ReconnectConfig> = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10
})

const GENERATION_CLOSE_TIMEOUT_MS = 5_000

export type ResolvedReconnectPolicy = Readonly<Required<ReconnectConfig>>

export function resolveReconnectPolicy(config: ReconnectConfig | undefined, path: string): ResolvedReconnectPolicy {
  if (config !== undefined) {
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(RECONNECT_DEFAULTS, key)) throw new Error(`${path}.${key} is not a reconnect option`)
    }
  }
  const enabled = config?.enabled ?? RECONNECT_DEFAULTS.enabled
  const initialDelayMs = config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs
  const maxDelayMs = config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs
  const maxAttempts = config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`${path}.maxAttempts must be a positive integer`)
  }
  return Object.freeze({ enabled, initialDelayMs, maxDelayMs, maxAttempts })
}

export interface ConnectionOutcome {
  error?: unknown
}

export interface ConnectionHandle {
  ready: Promise<ConnectionOutcome>
  state(): McpConnectionState
  cancelAuthorization(): void

  dispose(): Promise<void>
}

export function startConnection(host: ToolHost, config: Config, policy: ResolvedReconnectPolicy, credentials?: unknown): ConnectionHandle {
  const label = `mcp-client(${config.serverName})`
  const opts: ToolBridgeOptions = {
    registrationFailure: 'contain',
    serverName: config.serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    ...(config.enabledTools === undefined ? {} : { enabledTools: config.enabledTools }),
    ...(config.disabledTools === undefined ? {} : { disabledTools: config.disabledTools }),
    ...(config.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: config.startupTimeoutMs })
  }

  const startupOpts: ToolBridgeOptions = config.failOnStartupError ? { ...opts, registrationFailure: 'throw' } : opts

  let disposed = false
  let authorizationState: AuthorizationState = 'idle'
  let authorizing: LoopbackOAuthClientProvider | undefined
  const authorizationStarted = Promise.withResolvers<ConnectionOutcome>()

  let client: Client | undefined

  let clientClosed: Promise<void> | undefined

  let disposers: ToolDisposers = new Map()
  let reconnectTimer: NodeJS.Timeout | undefined

  let failedAttempts = 0

  let connectedAt: number | undefined

  let firstAttemptError: unknown

  const isCurrent = (generation: Client): boolean => !disposed && client === generation

  let syncChain: Promise<void> = Promise.resolve()

  function enqueueSync(generation: Client, syncOpts: ToolBridgeOptions = opts): Promise<void> {
    const run = syncChain.then(async () => {
      if (!isCurrent(generation)) return
      disposers = await syncTools(generation, host, syncOpts, disposers)
    })

    syncChain = run.catch(() => {})
    return run
  }

  function generationDown(generation: Client): void {
    if (!isCurrent(generation)) return
    client = undefined
    clientClosed = undefined
    scheduleReconnect()
  }

  function waitForClose(closed: Promise<void>): Promise<boolean> {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        resolve(false)
      }, GENERATION_CLOSE_TIMEOUT_MS)
      timeout.unref()
      void closed.then(() => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
  }

  function scheduleReconnect(): void {
    if (authorizationState === 'authorization-cancelled' || authorizationState === 'authorization-failed') return
    const lostEstablishedConnection = connectedAt !== undefined
    if (!policy.enabled) {
      const message = lostEstablishedConnection
        ? 'connection lost and reconnect is disabled — registered tools will fail until an HMR reload or Host restart'
        : 'connection failed and reconnect is disabled — no tools were registered; reload the plugin or restart the Host to connect'
      host.logger.error(`${label}: ${message}`)
      return
    }

    if (connectedAt !== undefined && Date.now() - connectedAt >= policy.maxDelayMs) failedAttempts = 0
    connectedAt = undefined
    failedAttempts += 1
    if (failedAttempts > policy.maxAttempts) {
      syncChain = syncChain.then(() => {
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
      })
      host.logger.error(
        `${label}: giving up after ${policy.maxAttempts} consecutive failed reconnect attempts — tools unregistered; reload the plugin or restart the Host to reconnect`
      )
      return
    }
    const delayMs = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (failedAttempts - 1))
    const action = lostEstablishedConnection ? 'connection lost; reconnecting' : 'connection failed; retrying'
    host.logger.warn(`${label}: ${action} in ${delayMs}ms (attempt ${failedAttempts}/${policy.maxAttempts})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      settling = connectGeneration(false)
    }, delayMs)

    reconnectTimer.unref()
  }

  async function connectGeneration(startup: boolean): Promise<void> {
    const generation = new Client({ name: 'dsh-agent-plugins-market', version: '0.1.0' }, { capabilities: {} })
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    let attemptSettled = false
    let closeObserved = false

    const hasClosed = (): boolean => closeObserved
    client = generation
    clientClosed = closed.promise
    generation.onclose = () => {
      closeObserved = true
      closed.resolve()

      if (attemptSettled) generationDown(generation)
    }

    generation.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      if (!isCurrent(generation)) return
      host.logger.info(`${label}: tool list changed, re-syncing`)
      try {
        await enqueueSync(generation)
      } catch (error) {
        if (!disposed) host.logger.error(`${label}: tool re-sync failed: ${String(error)}`)
      }
    })
    const { transport, oauthProvider } = createTransport(
      config,
      credentials,
      message => host.logger.info(message),
      state => {
        if (!isCurrent(generation)) return
        authorizationState = state
        if (state === 'awaiting-authorization') authorizationStarted.resolve({})
      }
    )
    authorizing = oauthProvider
    try {
      if (config.startupTimeoutMs === undefined) await generation.connect(transport)
      else await generation.connect(transport, { timeout: config.startupTimeoutMs })
      if (hasClosed()) {
        attemptSettled = true
        generationDown(generation)
        return
      }
      await enqueueSync(generation, startup ? startupOpts : opts)
    } catch (error) {
      if (firstAttemptError === undefined) firstAttemptError = error

      if (isCurrent(generation)) host.logger.warn(`${label}: connection attempt failed: ${String(error)}`)

      const leg = oauthProvider?.browserLeg
      if (leg !== undefined) {
        host.logger.warn(`${label}: waiting for browser authorization (up to 5 minutes) — approve access in the page that opened`)
        const legSettled = await leg
        attemptSettled = true
        if (!isCurrent(generation)) return
        if (hasClosed()) {
          generationDown(generation)
          return
        }
        if (!legSettled) {
          generationDown(generation)
          return
        }

        try {
          await enqueueSync(generation, startup ? startupOpts : opts)
        } catch (syncError) {
          if (isCurrent(generation)) host.logger.warn(`${label}: tool sync after authorization failed: ${String(syncError)}`)
          try {
            await generation.close()
          } catch {}
          const quiescedSync = hasClosed() || (await waitForClose(closed.promise))
          if (!quiescedSync) {
            client = undefined
            clientClosed = undefined
            host.logger.error(`${label}: failed generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms — reconnect stopped to avoid overlapping server processes`)
            return
          }
          generationDown(generation)
          return
        }
        if (hasClosed()) {
          generationDown(generation)
          return
        }
        if (!isCurrent(generation)) return
        connectedAt = Date.now()
        if (failedAttempts > 0) host.logger.info(`${label}: authorized and re-synced tools (attempt ${failedAttempts}/${policy.maxAttempts})`)
        return
      }
      try {
        await generation.close()
      } catch {}
      const quiesced = hasClosed() || (await waitForClose(closed.promise))
      attemptSettled = true
      if (!isCurrent(generation)) return
      if (!quiesced) {
        client = undefined
        clientClosed = undefined
        host.logger.error(
          `${label}: failed generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`
        )
        return
      }
      generationDown(generation)
      return
    }
    attemptSettled = true
    if (hasClosed()) {
      generationDown(generation)
      return
    }
    if (!isCurrent(generation)) return
    connectedAt = Date.now()
    if (failedAttempts > 0) host.logger.info(`${label}: reconnected and re-synced tools (attempt ${failedAttempts}/${policy.maxAttempts})`)
  }

  let settling = connectGeneration(true)

  const ready: Promise<ConnectionOutcome> = Promise.race([
    authorizationStarted.promise,
    settling.then(() => {
      if (client !== undefined) return {}

      return { error: firstAttemptError ?? new Error(`${label}: initial connection failed`) }
    })
  ])

  return {
    ready,
    cancelAuthorization: () => authorizing?.resetCallback(),
    state: () =>
      authorizationState !== 'idle'
        ? authorizationState
        : connectedAt !== undefined && client !== undefined
          ? 'connected'
          : client !== undefined || reconnectTimer !== undefined
            ? 'connecting'
            : 'failed',

    async dispose(): Promise<void> {
      disposed = true
      authorizing?.resetCallback()
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      const current = client
      const currentClosed = clientClosed
      client = undefined
      clientClosed = undefined
      if (current !== undefined) {
        try {
          await current.close()
        } catch {}
        if (currentClosed !== undefined && !(await waitForClose(currentClosed))) {
          host.logger.error(`${label}: generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms during disposal — server shutdown may be incomplete`)
        }
      }

      await settling
      await syncChain
      for (const dispose of disposers.values()) dispose()
      disposers = new Map()
    }
  }
}
