import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { scrubbedParentEnv } from './host-seams.js'
import { type AuthorizationState, LoopbackOAuthClientProvider } from './oauth.js'
import type { Config, SseConfig, StreamableHttpConfig } from './config.js'

function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

type AuthCapableTransport = Transport & { finishAuth(code: string): Promise<void> }

function hasStaticAuthorization(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(key => key.toLowerCase() === 'authorization')
}

function buildOAuthProvider(
  config: StreamableHttpConfig | SseConfig,
  credentials: unknown,
  log: (message: string) => void,
  onAuthorizationState: (state: AuthorizationState) => void
): LoopbackOAuthClientProvider | undefined {
  const auth = config.auth
  if (auth?.enabled === false || hasStaticAuthorization(config.headers)) return undefined
  return new LoopbackOAuthClientProvider(config.serverName, auth?.storage ?? {}, auth?.scope, log, credentials, undefined, onAuthorizationState)
}

export function createTransport(
  config: Config,
  credentials?: unknown,
  log: (message: string) => void = () => {},
  onAuthorizationState: (state: AuthorizationState) => void = () => {}
): { transport: Transport; oauthProvider: LoopbackOAuthClientProvider | undefined } {
  switch (config.transport) {
    case 'stdio':
      return {
        transport: new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: buildChildEnv(config.env),
          cwd: config.cwd
        }),
        oauthProvider: undefined
      }
    case 'streamable-http': {
      const oauthProvider = buildOAuthProvider(config, credentials, log, onAuthorizationState)

      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
        requestInit: { headers: config.headers },
        ...(oauthProvider === undefined ? {} : { authProvider: oauthProvider })
      }) as AuthCapableTransport
      oauthProvider?.bindTransport(transport)
      return { transport, oauthProvider }
    }
    case 'sse': {
      const oauthProvider = buildOAuthProvider(config, credentials, log, onAuthorizationState)

      const transport = new SSEClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
        ...(oauthProvider === undefined ? {} : { authProvider: oauthProvider })
      }) as AuthCapableTransport
      oauthProvider?.bindTransport(transport)
      return { transport, oauthProvider }
    }
  }
}
