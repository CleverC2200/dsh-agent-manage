import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { UserAgents } from './user-agents.js'

export interface UserAgentCubeDeclaration {
  id: string
  sourceRef: string
  generation: string
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    userAgentCube: UserAgentCubeDeclaration
    userAgents: UserAgents
  }
}
/** Core owns this service's isolated revision and inherits it into child Agents. */
export function apply(ctx: Context, config: UserAgentCubeDeclaration): void {
  ctx.provide('userAgentCube', Object.freeze({ ...config }))
}
