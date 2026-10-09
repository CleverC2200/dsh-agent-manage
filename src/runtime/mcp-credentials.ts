/** Resolve MCP `${NAME}` placeholders through the optional DSH credentials seam. */
/** 文件作用：把宿主凭据服务适配为 MCP 占位符解析器，并保留环境变量回退。 */
import type { Context } from '@deepseek-ai/cordis'
import type { McpCredentialResolver } from './mcp-config.js'

interface CredentialService {
  resolve(ref: string): Promise<{ value: string; source?: string } | undefined>
}

interface OptionalCredentialContext {
  get?(name: string): unknown
}

/**
 * Build the resolver used at mount time. Standard DSH profiles provide
 * `ctx.credentials`; minimal profiles retain the historical process-env
 * fallback so MCP mounting remains backwards compatible.
 */
/** 创建 MCP 凭据解析器：优先宿主 credentials，缺失时回退进程环境变量。 */
export function mcpCredentialResolver(ctx: Context): McpCredentialResolver {
  const host = ctx as unknown as OptionalCredentialContext
  const service = host.get?.('credentials') as CredentialService | undefined
  if (typeof service?.resolve === 'function') {
    return {
      resolve: ref => service.resolve(ref)
    }
  }
  return {
    /** 以环境变量作为旧版回退，返回凭据值及其来源，不把缺失转成空字符串。 */
    async resolve(ref) {
      const value = process.env[ref]
      return value === undefined || value === '' ? undefined : { value, source: 'env' }
    }
  }
}
