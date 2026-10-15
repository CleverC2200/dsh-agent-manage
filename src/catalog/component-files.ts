/** 文件作用：解析套件组件声明，统一得到受根目录约束的 Markdown/JSON 资源。 */
/** Resolve declared component files once; all consumers use the same contained resource paths. */
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { SuiteMarkdownResource } from '../model/types.js'
import { PLUGIN_ROOT_VARIABLES } from '../model/layouts.js'

/** 判断组件声明是否为普通对象，排除数组和 null。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reject both lexical and symlink escapes. Optional defaults may be absent without a diagnostic. */
/** 解析组件路径并校验词法路径和真实路径都未离开套件根。 */
export async function componentPath(root: string, value: string, errors: string[], required = true): Promise<string | undefined> {
  const clean = value.replace(/^\$\{([A-Z_]+)\}\//, (match, name: string) => (PLUGIN_ROOT_VARIABLES.has(name) ? './' : match))
  const path = resolve(root, clean)
  const rel = relative(resolve(root), path)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    errors.push(`component path ${value}: escapes the suite root`)
    return undefined
  }
  try {
    const [base, target] = await Promise.all([realpath(root), realpath(path)])
    const actual = relative(base, target)
    if (isAbsolute(actual) || actual === '..' || actual.startsWith(`..${sep}`)) {
      errors.push(`component path ${value}: escapes the suite root through a symlink`)
      return undefined
    }
    return path
  } catch {
    if (required) errors.push(`component path ${value}: missing or unreadable`)
    return undefined
  }
}

/** Commands and agents may declare one file, several files, or recursive directories. */
/** 发现组件声明指向的 Markdown 资源，返回文件路径、正文和规范化名称。 */
export async function discoverMarkdownResources(
  root: string,
  component: 'commands' | 'agents',
  declaration: unknown,
  manifestPath: string,
  errors: string[],
  extensions: readonly string[] = ['.md']
): Promise<SuiteMarkdownResource[]> {
  const resources: SuiteMarkdownResource[] = []
  const seen = new Set<string>()
  /** 中文：按文件和资源名去重后追加组件资源，保持扫描结果稳定。 */
  const add = (resource: SuiteMarkdownResource): void => {
    const identity = `${resource.file}\0${resource.name}`
    if (!seen.has(identity)) {
      seen.add(identity)
      resources.push(resource)
    }
  }
  /** 中文：递归遍历受根目录约束的组件路径，收集符合扩展名的 Markdown 文件。 */
  async function visit(path: string, container: string): Promise<void> {
    const valid = await componentPath(root, relative(root, path), errors)
    if (valid === undefined) return
    const info = await stat(valid)
    if (info.isFile()) {
      if (extensions.includes(extname(path))) add({ name: relative(container, path).replace(/\\/g, '/').slice(0, -extname(path).length), file: path })
      return
    }
    if (!info.isDirectory()) return
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue
      await visit(join(path, entry.name), container)
    }
  }
  const declared = declaration === undefined ? [component] : Array.isArray(declaration) ? declaration : [declaration]
  for (const item of declared) {
    if (typeof item === 'string') {
      const path = await componentPath(root, item, errors, declaration !== undefined)
      if (path === undefined) continue
      const info = await stat(path)
      await visit(path, info.isDirectory() ? path : resolve(path, '..'))
    } else if (component === 'commands' && isRecord(item)) {
      for (const [name, spec] of Object.entries(item)) {
        if (!isRecord(spec) || (typeof spec.source !== 'string' && typeof spec.content !== 'string') || (spec.source !== undefined && spec.content !== undefined)) {
          errors.push(`commands.${name}: requires exactly one source or content`)
          continue
        }
        if (typeof spec.source === 'string') {
          const file = await componentPath(root, spec.source, errors)
          if (file !== undefined) add({ name, file })
        } else {
          const metadata = Object.fromEntries(Object.entries(spec).filter(([key]) => !['source', 'content'].includes(key)))
          // JSON is a YAML subset, preserving command metadata without string-built YAML scalars.
          add({ name, file: manifestPath, content: `---\n${JSON.stringify(metadata)}\n---\n${spec.content as string}` })
        }
      }
    } else {
      errors.push(`${component}: invalid component declaration`)
    }
  }
  return resources
}

export interface ComponentDocument {
  path?: string
  value: Record<string, unknown>
}
/** A malformed declared file invalidates that configuration surface instead of falling back. */
/** 将文件/目录组件声明展开为受控文档列表，非法或越界项进入 errors。 */
export async function componentDocuments(root: string, declaration: unknown, errors: string[], allowDirectory = false): Promise<ComponentDocument[] | undefined> {
  const result: ComponentDocument[] = []
  for (const item of Array.isArray(declaration) ? declaration : [declaration]) {
    if (typeof item === 'string') {
      const path = await componentPath(root, item, errors)
      if (path === undefined) return undefined
      if (allowDirectory && (await stat(path)).isDirectory()) {
        const files = (await readdir(path))
          .filter(file => file.endsWith('.json'))
          .sort()
          .map(file => relative(root, join(path, file)))
        const nested = await componentDocuments(root, files, errors)
        if (nested === undefined) return undefined
        result.push(...nested)
        continue
      }
      try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (!isRecord(value)) {
          errors.push(`${item}: configuration must be an object`)
          return undefined
        }
        result.push({ path, value })
      } catch {
        errors.push(`${item}: invalid JSON configuration`)
        return undefined
      }
    } else if (isRecord(item)) {
      result.push({ value: item })
    } else {
      errors.push('invalid JSON component declaration')
      return undefined
    }
  }
  return result
}

/** 按候选顺序返回第一个存在的组件文件，缺失不视为错误。 */
export async function firstComponentFile(root: string, candidates: readonly string[]): Promise<string | undefined> {
  for (const path of candidates) if ((await stat(join(root, path)).catch(() => undefined))?.isFile()) return path
  return undefined
}

/** Legacy/native suites without catalog resource lists keep their conventional directory behavior. */
/** 读取默认 agents/commands 目录资源，作为未显式声明时的兼容发现。 */
export async function defaultMarkdownResources(root: string, component: 'agents' | 'commands'): Promise<SuiteMarkdownResource[]> {
  return discoverMarkdownResources(root, component, undefined, '', [])
}

/** 读取 Markdown 资源正文，供命令和 Agent 解析器消费。 */
export async function resourceText(resource: SuiteMarkdownResource): Promise<string> {
  return resource.content ?? (await readFile(resource.file, 'utf8'))
}

/** 从资源文件名生成合法命令名，去除扩展名和路径分隔。 */
export function resourceCommandName(name: string): string {
  return name.replaceAll('/', '-').replaceAll('\\', '-').toLowerCase()
}
