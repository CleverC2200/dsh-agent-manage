import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'

export const FEEDBACK_REPO_OWNER = 'CleverC2200'
export const FEEDBACK_REPO_NAME = 'dsh-agent-manage'

export const FEEDBACK_LABEL = 'agent-feedback'

const SUBMIT_COOLDOWN_MS = 60_000

interface ToolsHost {
  tools?: {
    register(definition: unknown): () => void
  }
}

export interface FeedbackOutcome {
  ok: boolean

  location?: string
  reason?: string
}

export interface FeedbackReport {
  title: string
  description: string

  expected?: string

  actual?: string
}

export async function submitFeedback(dataRoot: string, report: FeedbackReport, now = Date.now()): Promise<FeedbackOutcome> {
  const title = report.title.trim()
  if (title === '') return { ok: false, reason: 'title is required' }
  const body = renderFeedbackBody(report)
  const lastAt = await readLastSubmitAt(dataRoot)
  if (now - lastAt < SUBMIT_COOLDOWN_MS) {
    return { ok: false, reason: 'a feedback report was submitted less than a minute ago; wait and try again' }
  }
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN']
  if (token !== undefined && token !== '') {
    try {
      const url = await createIssue(token, title, body)
      await stampSubmitAt(dataRoot, now)
      return { ok: true, location: url }
    } catch (error) {
      const local = await spoolLocally(dataRoot, title, body)
      await stampSubmitAt(dataRoot, now)
      return {
        ok: true,
        location: local,
        reason: `GitHub issue failed (${error instanceof Error ? error.message : String(error)}); saved locally instead`
      }
    }
  }
  const local = await spoolLocally(dataRoot, title, body)
  await stampSubmitAt(dataRoot, now)
  return { ok: true, location: local }
}

async function createIssue(token: string, title: string, body: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${FEEDBACK_REPO_OWNER}/${FEEDBACK_REPO_NAME}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dsh-agent-plugins-market-feedback'
    },
    body: JSON.stringify({ title, body, labels: [FEEDBACK_LABEL] }),
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub API ${response.status}${detail === '' ? '' : `: ${detail.slice(0, 200)}`}`)
  }
  const payload = (await response.json()) as { html_url?: string }
  if (payload.html_url === undefined) throw new Error('GitHub API returned no issue URL')
  return payload.html_url
}

export function renderFeedbackBody(report: FeedbackReport): string {
  const lines = ['## Experience feedback', '', `**Problem:** ${report.description.trim()}`, '']
  if (report.expected?.trim() !== undefined && report.expected.trim() !== '') lines.push(`**Expected:** ${report.expected.trim()}`, '')
  if (report.actual?.trim() !== undefined && report.actual.trim() !== '') lines.push(`**Actual:** ${report.actual.trim()}`, '')
  lines.push('---', `Filed automatically by the dsh-agent-plugins-market \`${FEEDBACK_TOOL_NAME}\` tool.`)
  return lines.join('\n')
}

async function spoolLocally(dataRoot: string, title: string, body: string): Promise<string> {
  const dir = join(dataRoot, 'feedback')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'reports.jsonl')
  const record = JSON.stringify({ at: new Date().toISOString(), title, body })
  await appendFile(file, `${record}\n`, 'utf8')
  return file
}

async function readLastSubmitAt(dataRoot: string): Promise<number> {
  try {
    const raw = await readFile(join(dataRoot, 'feedback', 'last-submit-at'), 'utf8')
    const value = Number.parseInt(raw.trim(), 10)
    return Number.isSafeInteger(value) ? value : 0
  } catch {
    return 0
  }
}

async function stampSubmitAt(dataRoot: string, now: number): Promise<void> {
  const dir = join(dataRoot, 'feedback')
  await mkdir(dir, { recursive: true })

  await writeFile(join(dir, 'last-submit-at'), String(now), 'utf8')
}

export const FEEDBACK_TOOL_NAME = 'report_market_issue' as const

const FEEDBACK_DESCRIPTION =
  'File an experience-feedback issue for dsh-agent-plugins-market (the DeepSeek Harness agent plugin market). ' +
  'Call this ONLY when the human describes a problem caused by the agent plugins market itself — a failed or ' +
  'stuck install/uninstall, a market source that will not scan, wrong market UI behavior, or a runtime injection ' +
  'defect the user attributes to a market suite. Do not call it for problems in other plugins, in the harness, ' +
  "or in the user's own repositories. Compose a specific title; describe what happened, what was expected, and " +
  'the exact error text when one appeared.'

export function mountFeedbackTool(hostCtx: Context, dataRoot: string, t: (key: string, params?: Record<string, string>) => string): (() => void) | undefined {
  const host = hostCtx as unknown as ToolsHost
  if (typeof host.tools?.register !== 'function') return undefined
  return host.tools.register(
    defineTool({
      name: FEEDBACK_TOOL_NAME,
      description: FEEDBACK_DESCRIPTION,
      parameters: {
        title: { type: 'string', required: true, description: 'One-line problem summary for the issue title.' },
        description: { type: 'string', required: true, description: 'What the problem is, with exact error text when one appeared.' },
        expected: { type: 'string', description: 'What the user expected to happen.' },
        actual: { type: 'string', description: 'What actually happened instead.' }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            location: { type: 'string' },
            reason: { type: 'string' }
          }
        },
        render: (_args: unknown, value: FeedbackOutcome) => [{ type: 'text' as const, text: JSON.stringify(value) }]
      },

      async execute(args: unknown) {
        const input = args as { title?: unknown; description?: unknown; expected?: unknown; actual?: unknown }
        const report: FeedbackReport = {
          title: String(input['title'] ?? ''),
          description: String(input['description'] ?? ''),
          ...(typeof input['expected'] === 'string' ? { expected: input['expected'] } : {}),
          ...(typeof input['actual'] === 'string' ? { actual: input['actual'] } : {})
        }
        return await submitFeedback(dataRoot, report)
      },
      presentCall: (args: unknown) => {
        const input = args as { title?: unknown }
        const view: GenericCallView = {
          card: 'generic',
          title: t('feedbackToolCardTitle'),
          kind: 'other',
          ...(typeof input['title'] === 'string' ? { rawInput: input['title'] } : {})
        }
        return view
      }
    })
  )
}
