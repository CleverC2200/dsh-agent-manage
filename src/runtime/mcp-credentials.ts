import type { Context } from '@deepseek-ai/cordis'
import type { McpCredentialResolver } from './mcp-config.js'

interface CredentialService {
  resolve(ref: string): Promise<{ value: string; source?: string } | undefined>
}

interface OptionalCredentialContext {
  get?(name: string): unknown
}

export function mcpCredentialResolver(ctx: Context): McpCredentialResolver {
  const host = ctx as unknown as OptionalCredentialContext
  const service = host.get?.('credentials') as CredentialService | undefined
  if (typeof service?.resolve === 'function') {
    return {
      resolve: ref => service.resolve(ref)
    }
  }
  return {
    async resolve(ref) {
      const value = process.env[ref]
      return value === undefined || value === '' ? undefined : { value, source: 'env' }
    }
  }
}
