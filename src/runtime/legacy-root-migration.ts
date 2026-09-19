/** 文件作用：迁移旧版本遗留的数据目录，保留冲突文件避免破坏用户数据。 */
/** Compatibility migration for the pre-0.5.4 sibling data directory. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
import { readdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { mergeStorageTree } from './storage-migration.js'

/** Move owned data subtrees without overwriting or deleting conflicting files. */
/** 输入旧数据根与新数据根；输出迁移完成的 Promise，冲突不覆盖且保留现场。 */
export async function migrateLegacyDataRoot(legacyRoot: string, dataRoot: string): Promise<void> {
  const result = { conflicts: [] as string[] }
  for (const subtree of ['data', 'overrides']) await mergeStorageTree(join(legacyRoot, subtree), join(dataRoot, subtree), result)
  if ((await readdir(legacyRoot).catch(() => ['keep'])).length === 0) await rmdir(legacyRoot)
}
