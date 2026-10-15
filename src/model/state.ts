/** 文件作用：定义套件来源和安装状态的持久化模型，并提供安全读写所需类型。 */
/**
 * Persisted suite state: configured sources and per-suite install entries.
 *
 * State is a plain JSON file at `<dimensionRoot>/state.json`. The host is the
 * only writer through Catalog's serialized mutations. Saves replace the
 * file atomically through a temporary file and rename.
 *
 * 中文：本文件负责读写 suite 的持久化状态，内容包括已配置源和安装记录。
 * 状态保存在各维度根目录的 `state.json`，磁盘副本是权威数据，并通过临时文件重命名实现原子更新。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SUITE_SURFACE_KEYS, type InstalledEntry, type SourceRef, type SuiteState, type SurfaceOverrides } from './types.js'

export const EMPTY_STATE: SuiteState = { version: 1, sources: [], installed: {} }

/** Parse persisted state; unreadable or wrong-version files yield a contained empty state. 中文：读取并规范化状态文件，缺失、损坏或版本不匹配时安全退回空状态。 */
export async function loadState(statePath: string): Promise<SuiteState> {
  try {
    const text = await readFile(statePath, 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_STATE
    const record = parsed as Record<string, unknown>
    if (record['version'] !== 1) return EMPTY_STATE
    return normalizeState(record)
  } catch {
    return EMPTY_STATE
  }
}

/** 将已初步确认的 JSON 对象转换为可信的 SuiteState，丢弃类型错误的源和安装字段。 */
function normalizeState(record: Record<string, unknown>): SuiteState {
  const sources: SourceRef[] = Array.isArray(record['sources'])
    ? (record['sources'] as unknown[]).flatMap((entry): SourceRef[] => {
        if (typeof entry !== 'object' || entry === null) return []
        const source = entry as Record<string, unknown>
        const id = typeof source['id'] === 'string' ? source['id'] : ''
        const url = typeof source['url'] === 'string' ? source['url'] : ''
        if (id === '' || url === '') return []
        const branch = typeof source['branch'] === 'string' ? source['branch'] : undefined
        const local = source['local'] === true
        const kind = source['kind'] === 'git' || source['kind'] === 'local' || source['kind'] === 'archive' ? source['kind'] : undefined
        const sha256 = typeof source['sha256'] === 'string' && source['sha256'] !== '' ? source['sha256'] : undefined
        const adopted = source['adopted'] === true
        return [
          {
            id,
            url,
            ...(branch === undefined ? {} : { branch }),
            ...(local ? { local: true } : {}),
            ...(kind === undefined ? {} : { kind }),
            ...(sha256 === undefined ? {} : { sha256 }),
            ...(adopted ? { adopted: true } : {})
          }
        ]
      })
    : []
  const installed: Record<string, InstalledEntry> = {}
  if (typeof record['installed'] === 'object' && record['installed'] !== null) {
    for (const [key, value] of Object.entries(record['installed'] as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const entry = value as Record<string, unknown>
      installed[key] = {
        enabled: entry['enabled'] === true,
        lockCommit: typeof entry['lockCommit'] === 'string' ? entry['lockCommit'] : undefined,
        installedAt: typeof entry['installedAt'] === 'string' ? entry['installedAt'] : new Date(0).toISOString(),
        ...parseSurfaceOverrides(entry['surfaces'])
      }
    }
  }
  return { version: 1, sources, installed }
}

/** Parse a persisted `surfaces` override record, keeping only valid boolean keys. 中文：解析单个 suite 的 surface 开关，只保留已知键与布尔值。 */
function parseSurfaceOverrides(raw: unknown): { surfaces?: SurfaceOverrides } {
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const overrides: SurfaceOverrides = {}
  let hasAny = false
  for (const key of SUITE_SURFACE_KEYS) {
    const value = record[key]
    if (typeof value === 'boolean') {
      overrides[key] = value
      hasAny = true
    }
  }
  return hasAny ? { surfaces: overrides } : {}
}

/** Persist state atomically through a sibling-temp rename. 中文：先写同目录临时文件再重命名，避免崩溃时留下半个 JSON。 */
export async function saveState(statePath: string, state: SuiteState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true })
  const temp = `${statePath}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temp, statePath)
}
