import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { SKILL_EDITOR_PRESET, SKILL_EDITOR_ROUTE, type SkillEditorSession } from '../contracts/skill-editor.js'
import { composeStandardPreset } from './standard-preset.js'
import { readJsonRequest, RequestBodyTooLarge } from './request-body.js'
import { isSameOriginRequest } from './request-origin.js'
import type { UserAgents } from './user-agents.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'

const targetSchema = z
  .object({ id: z.string().min(1), name: z.string().min(1), revision: z.number().int().nonnegative(), cwd: z.string().min(1), entry: z.string().min(1) })
  .strict()
type EditTarget = z.infer<typeof targetSchema>
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'skill-directory-editor': { kind: 'skill-directory-editor'; target: EditTarget }
  }
}
const targetContext = (target: EditTarget, t: HostTranslate) =>
  createUserMessage({
    source: { kind: 'skill-directory-editor', target },
    content: [
      {
        type: 'text',
        text: t('skillEditorContext', {
          name: target.name,
          entry: target.entry === '.' ? 'SKILL.md' : `${target.entry}/SKILL.md`,
          cwd: target.cwd,
          revision: String(target.revision)
        })
      }
    ]
  })
const mutationTools = new Set(['write', 'edit', 'bash', 'pwsh'])
async function canonicalFile(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    return join(await canonicalFile(dirname(path)), basename(path))
  }
}

export async function mountSkillEditor(host: Context, agents: UserAgents, t: HostTranslate = bindHostLocale(undefined)): Promise<void> {
  const release = await host.agentPresets.register(
    await composeStandardPreset(
      host.agentPresets,
      {
        id: SKILL_EDITOR_PRESET,
        name: 'Skill editor',
        description: 'Edit and apply one selected personal Skill directory.',
        order: 1000
      },
      {
        personaPrefix:
          "This is a dedicated Skill editing conversation. Work only on its Host-bound Skill workcopy. File writes are drafts until skill_directory_apply succeeds. Apply only after completing the user's explicit modification task. Preserve failures and report unapplied changes accurately."
      }
    )
  )
  host.effect(() => release)
  const bound = new WeakSet<Agent>()
  const bind = (agent: Agent) => {
    if (bound.has(agent)) return
    const context = agent.session
      .snapshotEvents()
      .flatMap(row => (row.type === 'user/message' ? [row.data] : row.type === 'agent/inbox/spliced' ? row.data.inserted : []))
      .findLast(message => message.source.kind === 'skill-directory-editor')
    if (context?.source.kind !== 'skill-directory-editor') return
    let target = targetSchema.parse(context.source.target)
    bound.add(agent)
    agent.ctx.tools.guard(exec => {
      if (exec.agent !== agent) return 'SKILL_EDITOR_SESSION_REQUIRED'
      const policy = host.sandboxPolicy.resolve({ session: agent.session })
      if (policy.workspaceRoot !== target.cwd || policy.mode !== 'workspace-write') return 'SKILL_EDITOR_POLICY_CHANGED'
      if (
        typeof exec.arguments === 'object' &&
        exec.arguments !== null &&
        'sandbox_permissions' in exec.arguments &&
        exec.arguments.sandbox_permissions !== undefined &&
        exec.arguments.sandbox_permissions !== 'workspace-write'
      )
        return 'SKILL_EDITOR_ESCALATION_DENIED'
      return undefined
    })
    agent.ctx.on('tools/execute', async (exec, next) => {
      if (!mutationTools.has(exec.name)) return next()
      return agents.directories.runEdit(
        target,
        async () => {
          if (exec.name === 'write' || exec.name === 'edit') {
            const { file_path } = z.object({ file_path: z.string() }).parse(exec.arguments)
            const root = await realpath(target.cwd)
            const path = relative(root, await canonicalFile(resolve(target.cwd, file_path)))
            if (path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(path)) throw Error('SKILL_EDITOR_PATH_OUTSIDE_WORKCOPY')
          }
          return next()
        },
        revision => {
          target = { ...target, revision }
          agent.inject(targetContext(target, t))
        }
      )
    })
    agent.ctx.tools.register(
      defineTool({
        name: 'skill_directory_apply',
        description:
          "Validate and publish this conversation's Host-bound Skill workcopy after finishing the user's explicit modification task. The target and base version cannot be changed. Failure preserves drafts and the last usable version.",
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute(_args, exec) {
          exec.signal.throwIfAborted()
          const current = await agents.directories.open({ id: target.id, name: target.name })
          if (current.cwd !== target.cwd || current.entry !== target.entry) throw Error('SKILL_EDITOR_TARGET_CHANGED')
          const applied = await agents.directories.apply({ id: target.id, name: target.name, revision: target.revision })
          target = { ...target, revision: applied.revision }
          exec.deferContext(targetContext(target, t))
          return t('skillEditorApplied')
        }
      })
    )
  }
  host.on('agent/created', ({ agent }) => {
    bind(agent)
    return undefined
  })
  for (const agent of host.agents.list()) bind(agent)
  host.effect(() =>
    host.connection.fetch.register({
      path: SKILL_EDITOR_ROUTE,
      methods: ['POST'],
      requestBody: 'streaming',
      fetch: async request => {
        try {
          if (!isSameOriginRequest(request)) return Response.json({ error: 'CROSS_ORIGIN_REQUEST' }, { status: 403 })
          const input = z
            .object({ id: z.string().min(1), name: z.string().min(1), revision: z.number().int().nonnegative() })
            .strict()
            .parse(await readJsonRequest(request))
          const current = await agents.directories.open({ id: input.id, name: input.name })
          if (input.revision !== current.revision) throw Error('SKILL_EDIT_CONFLICT')
          if (host.fs.sandboxMode === undefined) throw Error('SKILL_EDITOR_SANDBOX_REQUIRED')
          const created = await host.sessionController.create({ cwd: current.cwd, agentPreset: SKILL_EDITOR_PRESET })
          const resolved = await host.sessionController.resolveAgent(created.sessionId)
          if ('error' in resolved) throw resolved.error
          const agent = resolved.agent
          agent.inject(targetContext({ ...input, cwd: current.cwd, entry: current.entry }, t))
          agent.session.append('sandbox/mode', { mode: 'workspace-write' })
          bind(agent)
          const entry = current.entry === '.' ? 'SKILL.md' : `${current.entry}/SKILL.md`
          const result: SkillEditorSession = {
            sessionId: created.sessionId,
            preset: SKILL_EDITOR_PRESET,
            cwd: current.cwd,
            draft: t('skillEditorDraft', { name: current.name, cwd: current.cwd, entry })
          }
          return Response.json(result, { headers: { 'cache-control': 'no-store' } })
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof RequestBodyTooLarge ? 413 : 400 })
        }
      }
    })
  )
}
