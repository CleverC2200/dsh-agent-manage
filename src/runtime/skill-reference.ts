/** Read only linked references of Skills visible in the current caller workspace. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolve } from 'node:path'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-fs'

/** The existing Manage resource runtime owns this read-only tool; visibility comes from the official Skill registry. */
export function mountSkillReferenceReader(host: Context): void {
  host.effect(() =>
    host.tools.register(
      defineTool({
        name: 'skill_reference_read',
        description:
          '读取当前 Skill 正文明确列出的本地参考文件。skill 使用目录中的完整技能名，path 原样使用 Markdown 链接或行内代码中的相对文件路径（如 rules.md、rules/metric-catalog.md）。跨 Skill 的文件先加载所属 Skill，再使用它的完整技能名读取。这不是 MCP 资源读取工具；不接受 file://、HTTP 或 data-artifact URI。',
        parameters: {
          skill: { type: 'string', required: true },
          path: { type: 'string', required: true },
          offset: { type: 'integer', description: '起始行，默认 1。' },
          limit: { type: 'integer', description: '行数，默认 200，最多 500。' }
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }]
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          const offset = args.offset ?? 1,
            limit = args.limit ?? 200
          if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500)
            throw new Error('参考文件 offset 必须为正整数，limit 必须为 1–500。')
          const view = {
            cwd: exec.agent?.session.header.cwd,
            scope: exec.agent,
            signal: exec.signal
          }
          const skill = await host.skills.get(args.skill, view)
          if (!skill?.invocation.modelInvocable) {
            const available = (await host.skills.list(view)).filter(item => item.invocation.modelInvocable).map(item => item.name)
            throw new Error(`该 Skill 当前不可用。当前可用技能：${available.join('、') || '无'}。使用完整技能名与正文明确链接的参考路径。`)
          }
          if (skill.resourceBase?.kind !== 'directory') throw new Error('该 Skill 没有本地参考目录，请使用正文提供的资源读取方式。')
          const links = [...skill.content.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)].map(match => match[1]!.split('#')[0])
          const codePaths = [...skill.content.matchAll(/(?<!`)`([^`\r\n]+)`(?!`)/g)]
            .map(match => match[1]!)
            .filter(path => /^(?![a-z][a-z\d+.-]*:|[\\/])[^\\\s]+\.[a-z\d]+(?:#[^\s]*)?$/i.test(path))
            .map(path => path.split('#')[0])
          if (!args.path || /^[a-z][a-z\d+.-]*:|^[\\/]/i.test(args.path) || ![...links, ...codePaths].includes(args.path))
            throw new Error(
              '只能读取当前 Skill 正文明确列出的 Markdown 链接或行内代码相对文件路径；跨 Skill 文件请先加载所属 Skill，MCP resource_link 请使用对应服务的资源读取工具。'
            )
          const path = host.fs.processPathFromHostPath(resolve(skill.resourceBase.path, args.path))
          if (path === undefined) throw new Error('当前文件系统无法访问该 Skill 的本地参考文件。')
          const target = await host.fs.resolve(path, { signal: exec.signal })
          const bytes = await host.fs.readBytes(target, exec.signal, 1024 * 1024)
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          if (text.includes('\0')) throw new Error('参考文件必须为 UTF-8 文本。')
          const lines = text.split(/\r?\n/)
          const selected = lines.slice(offset - 1, offset - 1 + limit)
          const content = selected.map((line, index) => `${offset + index}\t${line}`).join('\n')
          if (content.length > 32000) throw new Error('所选参考内容过长，请减少 limit 分段读取。')
          exec.signal.throwIfAborted()
          const current = await host.skills.get(args.skill, view)
          if (
            !current?.invocation.modelInvocable ||
            current.content !== skill.content ||
            current.resourceBase?.kind !== 'directory' ||
            current.resourceBase.path !== skill.resourceBase.path
          )
            throw Error('AGENT_RESOURCE_OWNER_CHANGED')
          exec.signal.throwIfAborted()
          return JSON.stringify({
            path: target.displayPath,
            offset,
            totalLines: lines.length,
            nextOffset: offset - 1 + selected.length < lines.length ? offset + selected.length : null,
            content
          })
        }
      })
    )
  )
}
