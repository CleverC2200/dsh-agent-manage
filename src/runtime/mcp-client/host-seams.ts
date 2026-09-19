/** 文件作用：封装内置 MCP 客户端访问宿主凭据、附件和环境变量的最小接口。 */
/**
 * Local ports of the tiny host seams the self-built MCP client needs.
 *
 * The market plugin must stay self-contained at runtime: it cannot import
 * host-internal packages that are not published at compatible versions, and
 * every one of these seams is a small pure function or constant. Each port
 * below is copied verbatim (semantics, not prose) from the harness source at
 * `0.1.1-rc.2` and carries the upstream reference it came from, so a future
 * host change can be re-diffed against `~/workspace/deepseek-harness`.
 *
 * Anything larger than a handful of lines (the JSON Schema subset validator)
 * lives in its own module.
 *
 * @module runtime/mcp-client/host-seams
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */

// ---- dsh-timeout: MAX_TIMER_DELAY_MS (packages/util/timeout/src/index.ts) ----
// 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。

/**
 * The largest delay `setTimeout` accepts without overflowing to a 1ms clamp
 * (2^31 - 1). Shared guard for reconnect and callback timers.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

// ---- dsh-subprocess: scrubbedParentEnv (packages/subprocess/subprocess/src/index.ts) ----
// 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。

/** `DSH_*` environment namespace owned by the harness. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export const DSH_ENV_PREFIX = 'DSH_' as const

/**
 * Credential-shaped environment names are NOT forwarded to MCP server child
 * processes (the harness's own `DEEPSEEK_API_KEY`/secrets must not leak into a
 * spawned server implicitly). Deliberately supplied env entries survive
 * because the config's explicit env merges after the scrub.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i

/**
 * The ambient parent environment minus credential-shaped names and minus all
 * `DSH_*` names — the canonical base every harness child starts from. `PATH`,
 * `HOME`, locale, and proxy variables survive, so child CLIs run normally;
 * harness identity never leaks implicitly. Both scrubs match case-insensitively:
 * Windows environment names are case-insensitive, so a parent `dsh_*` entry
 * would otherwise survive and read back as `$env:DSH_*` in the child.
 * @returns a fresh environment object safe to hand to a child spawn.
 */
/** 返回剔除敏感父进程变量的子进程环境，避免凭据意外下传。 */
export function scrubbedParentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith(DSH_ENV_PREFIX)) env[key] = value
  }
  return env
}

// ---- dsh-credentials: key grammar (packages/credentials/credentials/src/index.ts) ----
// 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。

/** A credential record key: `<scope>/<id>` with both segments in the grammar below. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
declare const credentialKeyBrand: unique symbol
export type CredentialKey = string & { readonly [credentialKeyBrand]: true }

/** Key segments are lowercase hyphenated identifiers. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
const KEY_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Brand a scope and an id as a {@link CredentialKey}.
 * @param scope - the owning plugin's registered name (here: the `mcp-auth` record scope).
 * @param id - the plugin's own addressing unit (here: the folded serverName).
 * @returns the branded key.
 * @throws TypeError when either segment is not a lowercase hyphenated identifier.
 */
/** 构造宿主凭据服务使用的稳定作用域/标识键。 */
export function credentialKey(scope: string, id: string): CredentialKey {
  for (const segment of [scope, id]) {
    if (!KEY_SEGMENT_PATTERN.test(segment)) {
      throw new TypeError(`credential key segment "${segment}" must match ${String(KEY_SEGMENT_PATTERN)}`)
    }
  }
  return `${scope}/${id}` as CredentialKey
}

/**
 * Structural mirror of the host `CredentialProvider` record surface the OAuth
 * provider needs. Typed structurally because the store arrives via the
 * optional `credentials` service; the OAuth provider narrows at runtime and
 * falls back to memory-only state when the service is absent.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export interface CredentialRecordStore {
  describeRecord(key: CredentialKey): Promise<{ configured: boolean; writable: boolean }>
  readRecord(key: CredentialKey): Promise<unknown>
  modifyRecord(key: CredentialKey, mutate: (current: unknown) => Promise<unknown>): Promise<unknown>
}

// ---- dsh-attachment: image admission error routing (packages/attachment/attachment/src/error.ts) ----
// 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。

/** Caller-correctable attachment failure codes raised while admitting image input. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
const IMAGE_ADMISSION_ERROR_CODES = [
  'TOO_MANY_IMAGES',
  'IMAGES_TOO_LARGE',
  'UNSUPPORTED_IMAGE_TYPE',
  'INVALID_IMAGE_BASE64',
  'INVALID_IMAGE',
  'IMAGE_TYPE_MISMATCH',
  'IMAGE_TOO_LARGE',
  'IMAGE_TOO_MANY_PIXELS',
  'IMAGE_DIMENSION_TOO_LARGE'
] as const

/** Runtime membership for structurally compatible errors crossing package boundaries. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
const IMAGE_ADMISSION_ERROR_CODE_SET: ReadonlySet<string> = new Set(IMAGE_ADMISSION_ERROR_CODES)

/**
 * Distinguish caller-correctable image admission failures from storage faults,
 * so an admission refusal projects text diagnostics while a storage fault is
 * reported as such.
 */
/** 判断附件服务错误是否表示当前模型不接收图片，而非连接故障。 */
export function isImageAdmissionError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string' && IMAGE_ADMISSION_ERROR_CODE_SET.has((error as { code: string }).code)
}

// ---- dsh-attachment: durable image vocabulary (structural mirror) ----
// 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。

/** Raster formats supported by the durable attachment vocabulary. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** One decoded image handed to the host attachment store. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export interface SaveImageAttachment {
  data: Buffer
  mediaType: ImageMediaType
}

/**
 * Structural mirror of the host `AttachmentStore.saveImages` surface. The
 * returned refs are opaque host values that ride inside `ContentBlock`
 * image blocks; typed `unknown` here and narrowed by the model content
 * contract at the projection site.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export interface AttachmentStoreLike {
  saveImages(images: readonly SaveImageAttachment[]): Promise<readonly unknown[]>
}
