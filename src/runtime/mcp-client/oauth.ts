import { createServer, type IncomingMessage, type Server } from 'node:http'
import { type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformation, OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { credentialKey, scrubbedParentEnv, type CredentialKey, type CredentialRecordStore } from './host-seams.js'
import type { OAuthStorageConfig } from './config.js'

const CLIENT_NAME = 'DeepSeek Harness (dsh-agent-plugins-market)'

const CLIENT_SOFTWARE_ID = 'dsh-agent-plugins-market'
const CLIENT_SOFTWARE_VERSION = '0.1.0'

export const MCP_AUTH_RECORD_SCOPE = 'mcp-auth'

const CALLBACK_TIMEOUT_MS = 5 * 60_000

export function mcpAuthRecordKey(serverName: string): CredentialKey {
  const folded = serverName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return credentialKey(MCP_AUTH_RECORD_SCOPE, folded === '' ? 'server' : folded)
}

interface McpAuthRecord {
  kind: 'grant'
  payload: {
    clientInformation?: OAuthClientInformation
    tokens?: OAuthTokens
  }
}

interface ProviderState {
  clientInformation?: OAuthClientInformation
  tokens?: OAuthTokens

  codeVerifier?: string
}

function asMcpAuthRecord(record: unknown): McpAuthRecord['payload'] | undefined {
  if (typeof record !== 'object' || record === null) return undefined
  const candidate = record as { kind?: unknown; payload?: unknown }
  if (candidate.kind !== 'grant' || typeof candidate.payload !== 'object' || candidate.payload === null) return undefined
  const payload = candidate.payload as { clientInformation?: unknown; tokens?: unknown }
  return {
    ...(payload.clientInformation === undefined ? {} : { clientInformation: payload.clientInformation as OAuthClientInformation }),
    ...(payload.tokens === undefined ? {} : { tokens: payload.tokens as OAuthTokens })
  }
}

export class AuthorizationAbortedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthorizationAbortedError'
  }
}

export type AuthorizationState = 'idle' | 'awaiting-authorization' | 'authorization-cancelled' | 'authorization-failed'

class AuthorizationCancelledError extends AuthorizationAbortedError {}

export type BrowserOpener = (authorizationUrl: URL, serverName: string, log: (message: string) => void) => Promise<void>

export const platformBrowserOpener: BrowserOpener = async (authorizationUrl, serverName, log) => {
  const platform = process.platform
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', authorizationUrl.toString()] : [authorizationUrl.toString()]
  const { spawn } = await import('node:child_process')
  const child = spawn(command, args, {
    stdio: 'ignore',
    env: scrubbedParentEnv(),
    detached: platform !== 'win32'
  })
  child.once('error', error => {
    log(`${serverName}: could not open a browser automatically (${String(error)}); open this URL manually: ${authorizationUrl.toString()}`)
  })
  child.once('spawn', () => {
    child.unref()
  })
}

export class LoopbackOAuthClientProvider implements OAuthClientProvider {
  private readonly recordKey: CredentialKey

  private readonly store: CredentialRecordStore | undefined

  private providerState: ProviderState = {}

  private activeTransport: { finishAuth(code: string): Promise<void> } | undefined

  private browserLegSettled: PromiseWithResolvers<boolean> | undefined
  private abandoned: Error | undefined
  private authState: AuthorizationState = 'idle'
  private rejectCallback: ((error: Error) => void) | undefined
  private callbackServer: Server | undefined
  private callbackTimer: NodeJS.Timeout | undefined
  private boundPort: number | undefined

  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly serverName: string,
    private readonly storage: OAuthStorageConfig,
    private readonly scope: string | undefined,
    private readonly log: (message: string) => void,
    store: unknown,
    private readonly opener: BrowserOpener = platformBrowserOpener,
    private readonly onAuthorizationState: (state: AuthorizationState) => void = () => {}
  ) {
    this.recordKey = mcpAuthRecordKey(serverName)
    this.store = typeof (store as Partial<CredentialRecordStore> | undefined)?.modifyRecord === 'function' ? (store as CredentialRecordStore) : undefined
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${this.boundPort ?? this.storage.callbackPort ?? 0}/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],

      token_endpoint_auth_method: 'none',
      ...(this.scope === undefined ? {} : { scope: this.scope }),
      software_id: CLIENT_SOFTWARE_ID,
      software_version: CLIENT_SOFTWARE_VERSION
    }
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const client = (await this.load()).clientInformation
    return typeof client?.issuer === 'string' && client.issuer.length > 0 ? client : undefined
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.mutate(state => {
      state.clientInformation = clientInformation
    })
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const tokens = (await this.load()).tokens
    return typeof tokens?.issuer === 'string' && tokens.issuer.length > 0 ? tokens : undefined
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.mutate(state => {
      state.tokens = tokens

      delete state.codeVerifier
    })
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.abandoned) throw this.abandoned
    const transport = this.activeTransport
    if (transport === undefined) {
      throw new AuthorizationAbortedError(`${this.serverName}: no active transport to complete authorization into`)
    }
    this.browserLegSettled = Promise.withResolvers()
    this.setAuthorizationState('awaiting-authorization')
    let succeeded = false
    try {
      const code = await this.awaitCallback(authorizationUrl)
      await transport.finishAuth(code)
      succeeded = true
      this.setAuthorizationState('idle')
      return
    } catch (error) {
      this.abandoned = error instanceof Error ? error : new AuthorizationAbortedError(`${this.serverName}: authorization failed`)
      this.setAuthorizationState(error instanceof AuthorizationCancelledError ? 'authorization-cancelled' : 'authorization-failed')
      throw error
    } finally {
      this.rejectCallback = undefined
      this.clearCallbackTimer()
      this.callbackServer?.close(() => undefined)
      this.callbackServer = undefined
      this.boundPort = undefined
      this.browserLegSettled?.resolve(succeeded)
      this.browserLegSettled = undefined
    }
  }

  get authorizationState(): AuthorizationState {
    return this.authState
  }

  private setAuthorizationState(state: AuthorizationState): void {
    this.authState = state
    this.onAuthorizationState(state)
  }

  get awaitingBrowser(): boolean {
    return this.browserLegSettled !== undefined
  }

  get browserLeg(): Promise<boolean> | undefined {
    return this.browserLegSettled?.promise
  }

  bindTransport(transport: { finishAuth(code: string): Promise<void> }): void {
    this.activeTransport = transport
  }

  resetCallback(reason: Error = new AuthorizationCancelledError(`${this.serverName}: authorization cancelled`)): void {
    this.abandoned = reason
    this.setAuthorizationState(reason instanceof AuthorizationCancelledError ? 'authorization-cancelled' : 'authorization-failed')
    this.rejectCallback?.(reason)
    this.rejectCallback = undefined
    if (this.callbackTimer !== undefined) {
      clearTimeout(this.callbackTimer)
      this.callbackTimer = undefined
    }
    this.callbackServer?.close(() => undefined)
    this.callbackServer = undefined
    this.boundPort = undefined
  }

  saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.providerState.codeVerifier = codeVerifier
    return Promise.resolve()
  }

  codeVerifier(): Promise<string> {
    const verifier = this.providerState.codeVerifier
    if (verifier === undefined) {
      return Promise.reject(new AuthorizationAbortedError(`${this.serverName}: no PKCE verifier is stored for this authorization attempt`))
    }
    return Promise.resolve(verifier)
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'tokens') {
      await this.mutate(state => {
        delete state.tokens
      })
      return
    }
    if (scope === 'verifier') {
      delete this.providerState.codeVerifier
      return
    }
    await this.mutate(state => {
      if (scope === 'client') delete state.clientInformation
      if (scope === 'all') {
        delete state.tokens
        delete state.clientInformation
      }
    })
  }

  private async load(): Promise<ProviderState> {
    if (this.store === undefined) return this.providerState

    const described = await this.store.describeRecord(this.recordKey)
    if (!described.configured) return this.providerState
    const record = await this.store.readRecord(this.recordKey)
    const payload = asMcpAuthRecord(record)
    if (payload === undefined) {
      this.providerState = { ...(this.providerState.codeVerifier === undefined ? {} : { codeVerifier: this.providerState.codeVerifier }) }
      return this.providerState
    }

    const verifier = this.providerState.codeVerifier
    this.providerState = {
      ...payload,
      ...(verifier === undefined ? {} : { codeVerifier: verifier })
    }
    return this.providerState
  }

  private async mutate(mutator: (state: ProviderState) => void): Promise<void> {
    const run = this.writeChain.then(async () => {
      if (this.abandoned) throw this.abandoned
      await this.load()
      if (this.abandoned) throw this.abandoned
      mutator(this.providerState)
      if (this.store === undefined) return
      const record: McpAuthRecord = {
        kind: 'grant',
        payload: {
          ...(this.providerState.clientInformation === undefined ? {} : { clientInformation: this.providerState.clientInformation }),
          ...(this.providerState.tokens === undefined ? {} : { tokens: this.providerState.tokens })
        }
      }
      await this.store.modifyRecord(this.recordKey, () => {
        if (this.abandoned) throw this.abandoned
        return Promise.resolve(record)
      })
    })

    this.writeChain = run.catch(() => {})
    return run
  }

  private awaitCallback(authorizationUrl: URL): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.rejectCallback = reject
      const server = createServer(request => {
        this.handleCallbackRequest(request, server, resolve, reject)
      })
      server.on('error', error => {
        this.clearCallbackTimer()
        reject(new AuthorizationAbortedError(`${this.serverName}: loopback callback server failed: ${String(error)}`))
      })
      server.listen(this.storage.callbackPort ?? 0, '127.0.0.1', () => {
        const address = server.address()
        if (address === null || typeof address === 'string') {
          server.close(() => undefined)
          reject(new AuthorizationAbortedError(`${this.serverName}: loopback callback server did not bind a TCP port`))
          return
        }
        this.boundPort = address.port
        this.callbackServer = server
        authorizationUrl.searchParams.set('redirect_uri', this.redirectUrl)
        this.log(`${this.serverName}: opening the browser for MCP authorization — approve access in the page that opens`)
        void this.opener(authorizationUrl, this.serverName, this.log).catch(error =>
          this.resetCallback(new AuthorizationAbortedError(`${this.serverName}: could not open authorization browser`, { cause: error }))
        )
        this.callbackTimer = setTimeout(() => {
          this.resetCallback(
            new AuthorizationAbortedError(
              `${this.serverName}: authorization was not completed within ${CALLBACK_TIMEOUT_MS / 60_000} minutes — open the server's page again or retry the mount`
            )
          )
        }, CALLBACK_TIMEOUT_MS)
        this.callbackTimer.unref()
      })
    })
  }

  private handleCallbackRequest(request: IncomingMessage, server: Server, resolve: (code: string) => void, reject: (error: Error) => void): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const oauthError = url.searchParams.get('error')
    const code = url.searchParams.get('code')

    const respond = (status: number, message: string): void => {
      request.resume()
      request.socket.end(
        `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Bad Request'}\r\n` + 'content-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\n' + `${message}\n`
      )
      request.on('close', () => {
        server.close(() => undefined)
      })
    }
    this.clearCallbackTimer()
    this.callbackServer = undefined

    if (oauthError !== null) {
      const description = url.searchParams.get('error_description') ?? ''
      respond(400, `Authorization failed: ${oauthError}${description === '' ? '' : ` — ${description}`}`)
      const message = `${this.serverName}: the authorization server returned "${oauthError}"`
      reject(oauthError === 'access_denied' ? new AuthorizationCancelledError(message) : new AuthorizationAbortedError(message))
      return
    }
    if (code === null || code === '') {
      respond(400, 'Authorization callback arrived without a code.')
      reject(new AuthorizationAbortedError(`${this.serverName}: the authorization callback carried no code`))
      return
    }
    respond(200, 'Authorization received. You can close this page and return to DeepSeek Harness.')
    resolve(code)
  }

  private clearCallbackTimer(): void {
    if (this.callbackTimer !== undefined) {
      clearTimeout(this.callbackTimer)
      this.callbackTimer = undefined
    }
  }
}
