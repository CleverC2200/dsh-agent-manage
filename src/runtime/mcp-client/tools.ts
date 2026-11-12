import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ListToolsResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonSchemaNode } from './json-schema-subset.js'
import { assertSupportedJsonSchema } from './json-schema-subset.js'
import { isImageAdmissionError, type AttachmentStoreLike, type ImageMediaType, type SaveImageAttachment } from './host-seams.js'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type McpResult<Structured extends JsonValue = JsonValue> = {
  content: JsonValue[]
  structuredContent?: Structured
}

interface ToolExecutionAgent {
  readonly ctx?: Context
  session?: { requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined }
  options?: { provider?: string; model?: string }
}
export interface ToolExecution {
  readonly signal: AbortSignal

  readonly agent?: ToolExecutionAgent
}

export interface ToolExecutionResult {
  readonly value: JsonValue
  readonly content: ContentBlock[]
  readonly isError: boolean
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: JsonSchemaNode

    render(args: unknown, value: JsonValue): ContentBlock[]
  }

  execute(args: unknown, exec: ToolExecution): Promise<unknown>

  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
}

export interface ToolHost {
  readonly logger: { error(message: string): void; warn(message: string): void; info(message: string): void }
  readonly tools: { register(definition: ToolDefinition): () => void }

  getService?(name: 'attachments' | 'llm'): unknown
  executionScope?(agent: ToolExecutionAgent | undefined, serverName: string): { signal: AbortSignal; validate(): void } | undefined
}

export interface ToolBridgeOptions {
  enabledTools?: string[]
  disabledTools?: string[]
  startupTimeoutMs?: number

  registrationFailure: 'contain' | 'throw'
  serverName: string
  toolCallTimeoutMs: number
}

function scopedExecution(host: ToolHost, exec: ToolExecution, serverName: string) {
  const scope = host.executionScope?.(exec.agent, serverName)
  const signal = scope ? AbortSignal.any([exec.signal, scope.signal]) : exec.signal
  const validate = () => {
    signal.throwIfAborted()
    scope?.validate()
  }
  validate()
  return { signal, validate }
}

export type ToolDisposers = Map<string, () => void>

const MAX_PUBLIC_NAME_LENGTH = 64

const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

const HASH_LENGTH = 12

const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const RawCallToolResultSchema = z.record(z.string(), z.unknown())

function listToolsUncached(client: Client, cursor?: string, timeout?: number) {
  const request = { method: 'tools/list' as const, ...(cursor === undefined ? {} : { params: { cursor } }) }
  return timeout === undefined ? client.request(request, ListToolsResultSchema) : client.request(request, ListToolsResultSchema, { timeout })
}

function callToolUncached(client: Client, rawName: string, args: Record<string, unknown>, exec: ToolExecution, opts: ToolBridgeOptions) {
  return client.request({ method: 'tools/call', params: { name: rawName, arguments: args } }, RawCallToolResultSchema, {
    signal: exec.signal,
    timeout: opts.toolCallTimeoutMs
  })
}

export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

export async function syncTools(client: Client, host: ToolHost, opts: ToolBridgeOptions, previous: ToolDisposers): Promise<ToolDisposers> {
  const definitions = new Map<string, ToolDefinition>()
  let cursor: string | undefined
  do {
    const response = await listToolsUncached(client, cursor, opts.startupTimeoutMs)
    for (const tool of response.tools) {
      if ((opts.enabledTools !== undefined && !opts.enabledTools.includes(tool.name)) || opts.disabledTools?.includes(tool.name)) continue
      const publicName = publicToolName(opts.serverName, tool.name)
      if (definitions.has(publicName)) {
        throw new Error(`mcp-client(${opts.serverName}): server listed tool "${tool.name}" more than once — invalid tool list`)
      }
      definitions.set(
        publicName,
        createDefinition(
          client,
          host,
          publicName,
          tool.name,
          tool.description ?? '',
          tool.inputSchema,
          supportedOutputSchema(tool.outputSchema),
          tool.execution?.taskSupport === 'required',
          opts
        )
      )
    }
    cursor = response.nextCursor
  } while (cursor)

  if (client.getServerCapabilities?.()?.resources) {
    const rawName = 'dsh_read_resource'
    const name = publicToolName(opts.serverName, rawName)
    if (definitions.has(name)) throw new Error('MCP_RESOURCE_TOOL_NAME_CONFLICT')
    definitions.set(name, {
      name,
      description:
        'Read a resource URI returned by this MCP server (including resource_link results). Pass the exact URI; do not fetch it as an HTTP URL. / 读取本 MCP 服务返回的资源链接正文，传入完整 URI。',
      parameters: { type: 'object', properties: { uri: { type: 'string', minLength: 1 } }, required: ['uri'], additionalProperties: false },
      output: createOutput(rawName, undefined),

      async execute(args, exec) {
        if (!args || typeof args !== 'object' || !('uri' in args) || typeof args.uri !== 'string' || !args.uri) throw new Error('MCP_RESOURCE_URI_REQUIRED')
        const scope = scopedExecution(host, exec, opts.serverName)
        const response = await client.request({ method: 'resources/read', params: { uri: args.uri } }, ReadResourceResultSchema, {
          signal: scope.signal,
          timeout: opts.toolCallTimeoutMs
        })
        scope.validate()
        return { content: response.contents.map(resource => ({ type: 'resource', resource })) }
      }
    })
  }

  for (const dispose of previous.values()) dispose()
  const disposers: ToolDisposers = new Map()
  try {
    for (const [publicName, definition] of definitions) {
      disposers.set(publicName, host.tools.register(definition))
    }
  } catch (error) {
    for (const dispose of disposers.values()) dispose()
    host.logger.error(`mcp-client(${opts.serverName}): tool registration failed, no tools registered: ${String(error)}`)
    if (opts.registrationFailure === 'throw') throw error
    return new Map()
  }
  return disposers
}

interface McpContentBlock {
  type: string
  text?: string
  mimeType?: string
  data?: string
  name?: string
  uri?: string
  resource?: { text?: string; blob?: string; uri?: string }
}

interface PreparedProjection {
  value: McpResult

  fallback: ContentBlock[]

  content: ContentBlock[]
}

function supportedOutputSchema(candidate: unknown): JsonSchemaNode | undefined {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate
  } catch {
    return undefined
  }
}

function createDefinition(
  client: Client,
  host: ToolHost,
  publicName: string,
  rawName: string,
  description: string,
  parameters: Record<string, unknown>,
  structuredSchema: JsonSchemaNode | undefined,
  taskRequired: boolean,
  opts: ToolBridgeOptions
): ToolDefinition {
  const projections = new WeakMap<ToolExecution, PreparedProjection>()
  return {
    name: publicName,
    description,
    parameters,
    output: createOutput(rawName, structuredSchema),
    execute: createExecutor(client, host, rawName, taskRequired, opts, projections),

    finalizeContent(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) {
      const projection = projections.get(exec)
      if (projection === undefined) return undefined
      projections.delete(exec)
      if (result.isError) return undefined
      if (!isDeepStrictEqual(result.value, projection.value)) return undefined
      if (!isDeepStrictEqual(result.content, projection.fallback)) return undefined
      return projection.content
    }
  }
}

function createOutput(rawName: string, structuredSchema: JsonSchemaNode | undefined): ToolDefinition['output'] {
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        structuredContent: structuredSchema ?? {}
      },
      required: structuredSchema === undefined ? ['content'] : ['content', 'structuredContent'],
      additionalProperties: false
    },

    render(_args: unknown, value: JsonValue) {
      const result = value as unknown as McpResult
      return [{ type: 'text', text: extractText(result.content, rawName) }]
    }
  }
}

function createExecutor(
  client: Client,
  host: ToolHost,
  rawName: string,
  taskRequired: boolean,
  opts: ToolBridgeOptions,
  projections: WeakMap<ToolExecution, PreparedProjection>
): ToolDefinition['execute'] {
  return async (args: unknown, exec: ToolExecution) => {
    if (taskRequired) {
      throw new Error(`Tool "${rawName}" requires task-based execution, which this bridge does not support`)
    }

    const argsObj = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
    const scope = scopedExecution(host, exec, opts.serverName)
    const invocation = { ...exec, signal: scope.signal }
    const result = await callToolUncached(client, rawName, argsObj, invocation, opts)
    scope.validate()

    if (!Array.isArray(result.content)) {
      const rendered: unknown = 'toolResult' in result ? JSON.stringify(result.toolResult) : '(no output)'
      const text = typeof rendered === 'string' ? rendered : '(no output)'
      if (result.isError === true) throw new Error(text)
      return {
        content: [{ type: 'text', text }],
        ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent as JsonValue } : {})
      }
    }

    const content = result.content as unknown as JsonValue[]
    const text = extractText(content, rawName)

    if (result.isError === true) {
      throw new Error(text)
    }

    const value: McpResult = {
      content,
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent as JsonValue } : {})
    }
    if (containsImage(content)) {
      const fallback: ContentBlock[] = [{ type: 'text', text: extractText(content, rawName) }]
      const projected = await prepareImageProjection(host, invocation, content, rawName)
      scope.validate()
      projections.set(exec, { value, fallback, content: projected })
    }
    return value
  }
}

function containsImage(content: JsonValue[]): boolean {
  return content.some(value => isRecord(value) && value.type === 'image')
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isImageMediaType(value: string): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.includes(value as ImageMediaType)
}

function decodeImage(block: McpContentBlock): SaveImageAttachment {
  if (block.mimeType === undefined || !isImageMediaType(block.mimeType)) {
    throw new Error('the declared media type is not PNG, JPEG, WebP, or GIF')
  }
  if (block.data === undefined || !CANONICAL_BASE64.test(block.data)) {
    throw new Error('the image data is not canonical base64')
  }
  const data = Buffer.from(block.data, 'base64')
  if (data.toString('base64') !== block.data) {
    throw new Error('the image data is not canonical base64')
  }
  return { data, mediaType: block.mimeType }
}

interface LlmServiceLike {
  resolveModelInfo(provider: string, model: string, signal: AbortSignal): Promise<{ inputModalities?: string[] } | undefined>
}

async function resolveImageAdmission(host: ToolHost, exec: ToolExecution): Promise<AttachmentStoreLike> {
  const attachments = host.getService?.('attachments') as AttachmentStoreLike | undefined
  if (attachments === undefined || typeof attachments.saveImages !== 'function') {
    throw new Error('no attachment store is mounted')
  }
  const routed = exec.agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? exec.agent?.options?.provider
  const model = routed?.model ?? exec.agent?.options?.model
  const llm = host.getService?.('llm') as LlmServiceLike | undefined
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('the current model route could not be resolved')
  }
  let info: Awaited<ReturnType<LlmServiceLike['resolveModelInfo']>>
  try {
    info = await llm.resolveModelInfo(provider, model, exec.signal)
  } catch {
    throw new Error('the current model route could not be verified')
  }
  if (info?.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error(`model "${model}" does not declare image input`)
  }
  if (exec.signal.aborted) throw new Error('the tool call was canceled before image storage')
  return attachments
}

function imageDiagnostic(block: McpContentBlock, reason: string): string {
  return `[image unavailable: ${block.mimeType ?? 'unknown media type'}; ${reason}; raw image data remains available to programmatic callers]`
}

async function prepareImageProjection(host: ToolHost, exec: ToolExecution, content: JsonValue[], toolName: string): Promise<ContentBlock[]> {
  const decoded: SaveImageAttachment[] = []
  const validationErrors = new Map<number, string>()
  const imageIndexes: number[] = []
  for (const [index, value] of content.entries()) {
    if (!isRecord(value) || value.type !== 'image') continue
    imageIndexes.push(index)
    try {
      decoded.push(decodeImage(value as unknown as McpContentBlock))
    } catch (error: unknown) {
      validationErrors.set(index, (error as Error).message)
    }
  }
  if (validationErrors.size > 0) {
    return projectContent(content, toolName, (block, index) => ({
      type: 'text',
      text: imageDiagnostic(block, validationErrors.get(index) ?? 'another image in the same result was invalid')
    }))
  }

  let attachments: AttachmentStoreLike
  try {
    attachments = await resolveImageAdmission(host, exec)
  } catch (error: unknown) {
    const reason = (error as Error).message
    return projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) }))
  }

  try {
    const refs = await attachments.saveImages(decoded)
    const byIndex = new Map(imageIndexes.map((index, offset) => [index, refs[offset]] as const))
    return projectContent(
      content,
      toolName,
      (_block, index) =>
        ({
          type: 'image',
          attachment: byIndex.get(index)
        }) as ContentBlock
    )
  } catch (error: unknown) {
    const reason = isImageAdmissionError(error) ? `image admission rejected the result: ${(error as Error).message}` : 'durable image storage rejected the result'
    return projectContent(content, toolName, block => ({
      type: 'text',
      text: imageDiagnostic(block, reason)
    }))
  }
}

function extractText(mcpContent: JsonValue[], toolName: string): string {
  const content = projectContent(mcpContent, toolName)

  return content.map(block => (block as Extract<ContentBlock, { type: 'text' }>).text).join('\n')
}

function projectContent(
  mcpContent: JsonValue[],
  toolName: string,
  image: (block: McpContentBlock, index: number) => ContentBlock = block => ({
    type: 'text',
    text: imageDiagnostic(block, 'this result was not admitted to durable model context')
  })
): ContentBlock[] {
  const projected: ContentBlock[] = []
  const text: string[] = []

  const flushText = (): void => {
    if (text.length === 0) return
    projected.push({ type: 'text', text: text.splice(0).join('\n') })
  }

  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value)) {
      text.push('[unsupported MCP content block: expected an object]')
      continue
    }
    const block = value as unknown as McpContentBlock
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) text.push(block.text)
        break
      case 'image':
        flushText()
        projected.push(image(block, index))
        break
      case 'resource_link':
        if (block.name === undefined || block.uri === undefined) {
          text.push('[resource link unavailable: the MCP block is missing its name or URI]')
        } else {
          text.push(`Resource link: ${block.name} (${block.uri})`)
        }
        break
      case 'audio':
        text.push(`[audio result unsupported: ${block.mimeType ?? 'unknown media type'}; raw audio data remains available to programmatic callers]`)
        break
      case 'resource':
        text.push(
          typeof block.resource?.text === 'string' ? block.resource.text : '[binary resource: no text content; raw resource data remains available to programmatic callers]'
        )
        break
      default:
        text.push(`[unsupported MCP content type: ${block.type}]`)
    }
  }
  flushText()
  return projected.length > 0 ? projected : [{ type: 'text', text: `(${toolName} returned no model-visible content)` }]
}
