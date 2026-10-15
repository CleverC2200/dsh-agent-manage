/** 文件作用：把启用套件里的命令 Markdown 挂载为宿主斜杠命令，并负责增量对账。 */
/**
 * Claude Code command compatibility: `commands/*.md` of enabled suites
 * register as dsh slash commands.
 *
 * A CC command is a prompt template the model executes (its body carries
 * `$ARGUMENTS` and execution rules), so the handler maps it onto the
 * harness's follow-up mechanism: the template with `$ARGUMENTS` substituted
 * becomes one durable user-role follow-up message on the receiving agent.
 * Registrations reconcile on every enable/disable/install/uninstall; a
 * broken command file or an unavailable `ctx.commands` is contained per
 * command and reported as a diagnostic.
 */
import type { Context } from '@deepseek-ai/cordis'
import { parse as parseYaml } from 'yaml'
import { stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from './user-store.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import type { Suite, SuiteMarkdownResource } from '../model/types.js'
import { defaultMarkdownResources, resourceText, resourceCommandName } from '../catalog/component-files.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'

export interface CommandMountDiagnostic {
  suiteId: string
  command: string
  reason: string
}

interface CommandSpec {
  name: string
  description: string
  body: string
  hint?: string
}

interface CommandsHost {
  commands?: {
    register(definition: {
      name: string
      description: string
      input?: { hint: string }
      handler(invocation: { agent: unknown; rawInput: string }): { kind: 'success'; text: string } | { kind: 'error'; text: string }
    }): () => void
  }
}

interface InboxAgent {
  followup(message: { content: Array<{ type: string; text: string }>; source: unknown }): void
}

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

export class CommandMountRegistry {
  private readonly fingerprints = new Map<string, string>()
  private readonly live = new Map<string, () => void>()

  /** 绑定宿主命令面和翻译器，后续 reconcile 在此上下文注册命令。 */
  constructor(
    private readonly ctx: Context,
    private readonly t: HostTranslate = bindHostLocale(undefined)
  ) {}

  /** Register/unregister suite commands to match the enabled suites exactly. */
  /** 对账启用套件命令：卸载失效项，逐项读取并注册，单项失败转为诊断。 */
  async reconcile(enabledSuites: Suite[]): Promise<CommandMountDiagnostic[]> {
    const diagnostics: CommandMountDiagnostic[] = []
    const wanted = new Map<string, CommandSpec & { suiteId: string; suiteName: string }>()
    for (const suite of enabledSuites) {
      const specs = suite.activeSurfaces?.commands === false ? [] : await readCommands(suite.root, suite.resources?.commands)
      for (const spec of specs) {
        // The registry key is source-qualified: bare suite ids are unique per
        // source only, so two sources' same-named suites would collide.
        const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
        const key = `${suiteKey}/${spec.name}`
        if (wanted.has(key)) {
          diagnostics.push({ suiteId: suiteKey, command: spec.name, reason: 'duplicate normalized command name' })
          continue
        }
        wanted.set(key, { ...spec, suiteId: suiteKey, suiteName: suite.manifest.name })
      }
    }
    for (const [key, disposer] of [...this.live]) {
      if (!wanted.has(key)) {
        disposer()
        this.live.delete(key)
      }
    }
    const host = this.ctx as unknown as CommandsHost
    if (typeof host.commands?.register !== 'function') {
      if (wanted.size > 0) diagnostics.push({ suiteId: '', command: '', reason: 'ctx.commands is not available in this profile' })
      return diagnostics
    }
    for (const [key, spec] of wanted) {
      const fingerprint = JSON.stringify(spec)
      if (this.live.has(key) && this.fingerprints.get(key) === fingerprint) continue
      this.live.get(key)?.()
      this.live.delete(key)
      this.fingerprints.delete(key)
      try {
        const disposer = host.commands.register({
          name: spec.name,
          description: `[${spec.suiteName}] ${spec.description}`,
          ...(spec.hint === undefined ? {} : { input: { hint: spec.hint } }),
          handler: invocation => {
            const agent = invocation.agent as InboxAgent
            const text = [this.t('commandForwardTitle', { command: spec.name, suite: spec.suiteId }), '', spec.body.replaceAll('$ARGUMENTS', invocation.rawInput.trim())].join('\n')
            agent.followup({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-agent-plugins-market' } })
            return { kind: 'success', text: this.t('commandAcknowledged', { command: spec.name, suite: spec.suiteId }) }
          }
        })
        this.live.set(key, disposer)
        this.fingerprints.set(key, fingerprint)
      } catch (error) {
        diagnostics.push({ suiteId: spec.suiteId, command: spec.name, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    return diagnostics
  }

  /** Dispose every registered command; used at plugin teardown. */
  /** 释放全部活动命令注册，供禁用插件或宿主销毁时调用。 */
  disposeAll(): void {
    for (const disposer of [...this.live.values()]) disposer()
    this.live.clear()
    this.fingerprints.clear()
  }
}

/** Parse `commands/*.md` of one suite root (Claude Code format). */
/** 读取套件命令资源，校验命名/frontmatter，并返回可注册的命令规格。 */
export async function readCommands(root: string, resources?: SuiteMarkdownResource[]): Promise<CommandSpec[]> {
  const entries = resources ?? (await defaultMarkdownResources(root, 'commands'))
  const specs: CommandSpec[] = []
  for (const entry of entries) {
    const name = resourceCommandName(entry.name)
    if (!COMMAND_NAME.test(name)) continue
    let text: string
    try {
      text = await resourceText(entry)
    } catch {
      continue
    }
    try {
      if (parseFrontmatterRecord(text).disabled === true) continue
    } catch {
      continue
    }
    const meta = commandMeta(text)
    const description = meta?.description ?? firstLine(text)
    if (description === undefined) continue
    specs.push({ name, description, hint: meta?.hint, body: stripFrontmatter(text) })
  }
  return specs
}

interface CommandMeta {
  description?: string
  hint?: string
}

/** 从命令 Markdown frontmatter 提取描述和参数提示。 */
function commandMeta(text: string): CommandMeta | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (match === null) return undefined
  try {
    const raw = parseYaml(match[1])
    if (typeof raw !== 'object' || raw === null) return undefined
    const record = raw as Record<string, unknown>
    const meta: CommandMeta = {}
    const description = record['description']
    if (typeof description === 'string' && description.trim() !== '') meta.description = description.trim()
    const hint = record['argument-hint'] ?? record['argumentHint']
    if (typeof hint === 'string' && hint.trim() !== '') meta.hint = hint.trim()
    return meta
  } catch {
    return undefined
  }
}

/** 获取正文首个非空行，作为缺失描述时的稳定回退。 */
function firstLine(text: string): string | undefined {
  const line = text
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '')
  return line
}
