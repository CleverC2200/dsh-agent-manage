import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { GeaMcpService } from './gea-mcp.js'

const skillName = 'plan-operations-weekly-report'
const { executeWeekly } = createRequire(import.meta.url)('../../business-resources/inventory-apsplan/skills/plan-operations-weekly-report/scripts/run-weekly.cjs') as {
  executeWeekly(config: unknown, seed: unknown, io: {
    inspect(args: unknown, signal: AbortSignal): Promise<unknown>
    query(args: unknown, signal: AbortSignal): Promise<unknown>
    write(file: string, content: string): Promise<void>
    signal: AbortSignal
  }): Promise<Record<string, number>>
}

export function weeklyReportTool(host: Context) {
  return defineTool({
    name: 'plan_operations_weekly_run',
    description: '执行已核对模型字段的计划运营周报。读取工作区输入目录的 query-config.json 和 report-seed.json，规划查询、保存原始响应、分页、组装并校验报告。返回报告和溯源目录。',
    parameters: { inputDirectory: { type: 'string', required: true, description: '当前工作区内的相对输入目录' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    timeoutMs: 1200000,
    async execute(args, exec) {
      const agent = exec.agent
      const cwd = agent?.session.header.cwd
      if (!agent || !cwd) throw Error('WEEKLY_SESSION_REQUIRED')
      const view = { scope: agent, cwd, signal: exec.signal }
      const skill = await host.skills.get(skillName, view)
      if (!skill?.invocation.modelInvocable) throw Error('WEEKLY_SKILL_DISABLED')
      const input = args.inputDirectory
      if (input !== '.' && !input.split(/[\\/]/).every(part => /^[\p{L}\p{N}_ -]+$/u.test(part))) throw Error('WORKSPACE_INPUT_DIRECTORY_REQUIRED')
      const load = async (name: string) => {
        const target = await host.fs.resolve(input + '/' + name, view)
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await host.fs.readBytes(target, exec.signal, 4 * 1024 * 1024)))
      }
      const config = await load('query-config.json')
      const seed = await load('report-seed.json')
      const directory = 'weekly-report-' + randomUUID()
      const gateway = host.get('geaMcp') as GeaMcpService | undefined
      if (!gateway?.allows(agent.id)) throw Error('WEEKLY_QUERY_UNAVAILABLE')
      const owner = AbortSignal.any([exec.signal, gateway.identitySignal()])
      let sequence = 0
      async function dispatch(name: string, parameters: unknown, signal: AbortSignal) {
        signal = AbortSignal.any([signal, owner])
        signal.throwIfAborted()
        if (!gateway?.allows(agent!.id)) throw Error('WEEKLY_QUERY_UNAVAILABLE')
        const result = await host.tools.execute({
          name, arguments: parameters, agent, signal, parent: exec.token, rootCallId: exec.rootCallId,
          callId: ToolCallId(exec.callId + ':weekly:' + (++sequence))
        })
        if (result.isError) throw Error(name + ': ' + result.content.filter(block => block.type === 'text').map(block => block.text).join(' ').slice(0, 500))
        signal.throwIfAborted()
        return result.value
      }
      const stats = await executeWeekly(config, seed, {
        signal: owner,
        inspect: (parameters, signal) => dispatch('mcp__gea-gateway__inspect_cube_model', parameters, signal),
        query: (parameters, signal) => dispatch('mcp__gea-gateway__query_business_data', parameters, signal),
        write: async (file, content) => {
          await dispatch('write', { file_path: directory + '/' + file, content }, exec.signal)
        }
      })
      return JSON.stringify({ directory, report: directory + '/report.html', ...stats })
    }
  })
}
