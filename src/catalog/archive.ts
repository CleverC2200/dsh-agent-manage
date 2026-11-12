import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdir, open, readdir, readFile, readlink, rename, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { Unzip, UnzipInflate, type FlateError } from 'fflate'

const run = promisify(execFile)

export const ARCHIVE_MAX_BYTES = 256 * 1024 * 1024

export const ARCHIVE_MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024

export const ARCHIVE_MAX_ENTRIES = 20_000

export const ARCHIVE_MAX_ENTRY_BYTES = 128 * 1024 * 1024

export const DEFAULT_ARCHIVE_TIMEOUT_MS = 180_000

export interface ArchiveOptions {
  githubToken?: string

  sha256?: string

  timeoutMs?: number

  allowHttp?: boolean

  format?: ArchiveFormat
}

export interface ArchiveInstallResult {
  sha256: string
}

export type ArchiveFormat = 'zip' | 'tar' | 'targz'

export function archiveFormatOf(url: string): ArchiveFormat | undefined {
  const clean = url.trim().toLowerCase()
  if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/zipball\/[^?#]+$/.test(clean)) return 'zip'
  if (clean.endsWith('.zip')) return 'zip'
  if (clean.endsWith('.tar.gz') || clean.endsWith('.tgz')) return 'targz'
  if (clean.endsWith('.tar')) return 'tar'
  return undefined
}

export async function downloadArchive(url: string, tempFile: string, options: ArchiveOptions = {}): Promise<string> {
  const trimmed = url.trim()
  if (options.allowHttp !== true && !trimmed.startsWith('https://')) {
    throw new Error(`archive source requires an https:// URL: ${trimmed}`)
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_ARCHIVE_TIMEOUT_MS
  const initial = new URL(trimmed)
  if (initial.username || initial.password) throw new Error('archive URL cannot contain credentials')
  let target = initial
  let response: Response | undefined
  const signal = AbortSignal.timeout(timeoutMs)
  for (let redirects = 0; redirects < 5; redirects++) {
    response = await fetch(target, {
      signal,
      redirect: 'manual',
      headers:
        redirects === 0 && initial.origin === 'https://api.github.com' && options.githubToken !== undefined
          ? { Authorization: `Bearer ${options.githubToken}`, Accept: 'application/vnd.github+json' }
          : {}
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (location === null) throw new Error('archive redirect is missing a location')
    target = new URL(location, target)
    if ((target.protocol !== 'https:' && !(options.allowHttp === true && target.protocol === 'http:')) || target.username || target.password)
      throw new Error('archive redirect rejected')
    await response.body?.cancel()
    response = undefined
  }
  if (response === undefined) throw new Error('archive redirect limit exceeded')
  if (!response.ok) throw new Error(`archive download failed: HTTP ${response.status} for ${trimmed}`)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > ARCHIVE_MAX_BYTES) {
    throw new Error(`archive exceeds the ${ARCHIVE_MAX_BYTES} byte limit: ${declared}`)
  }
  const body = response.body
  if (body === null) throw new Error(`archive download failed: empty response body for ${trimmed}`)
  const hash = createHash('sha256')
  const handle = await open(tempFile, 'w')
  try {
    let size = 0
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > ARCHIVE_MAX_BYTES) {
        void reader.cancel()
        throw new Error(`archive exceeds the ${ARCHIVE_MAX_BYTES} byte limit`)
      }
      hash.update(value)
      await handle.write(value)
    }
  } finally {
    await handle.close()
  }
  const sha256 = hash.digest('hex')
  if (options.sha256 !== undefined && options.sha256 !== '' && options.sha256.toLowerCase() !== sha256) {
    throw new Error(`archive sha256 mismatch: expected ${options.sha256}, got ${sha256}`)
  }
  return sha256
}

export async function archiveInstall(url: string, dest: string, options: ArchiveOptions = {}): Promise<ArchiveInstallResult> {
  const format = options.format ?? archiveFormatOf(url)
  if (format === undefined) throw new Error(`unsupported archive format (expected .zip, .tar.gz, .tgz, or .tar): ${url}`)
  const parent = resolve(dest, '..')
  await mkdir(parent, { recursive: true })
  const stamp = `${process.pid}.${Date.now()}`
  const tempFile = join(parent, `.${stamp}.download`)
  const extractDir = join(parent, `.${stamp}.extract`)
  try {
    const sha256 = await downloadArchive(url, tempFile, options)
    await mkdir(extractDir, { recursive: true })
    if (format === 'zip') {
      await extractZip(tempFile, extractDir)
    } else {
      await extractTar(tempFile, extractDir, format)
    }
    await assertNoEscapingSymlinks(extractDir)
    const root = await unwrapSingleRoot(extractDir)
    await rm(dest, { recursive: true, force: true })
    try {
      await rename(root, dest)
    } catch {
      await copyTree(root, dest)
    }
    return { sha256 }
  } finally {
    await rm(tempFile, { force: true })
    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function extractZip(archiveFile: string, dest: string): Promise<void> {
  const compressed = await readFile(archiveFile)
  let totalBytes = 0
  let entryCount = 0
  let failure: Error | undefined

  const fail = (error: Error): void => {
    failure ??= error
  }
  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  const entries: Array<{ target: string; chunks: Buffer[] }> = []
  unzip.onfile = file => {
    if (failure !== undefined) return
    entryCount += 1
    if (entryCount > ARCHIVE_MAX_ENTRIES) {
      fail(new Error(`archive exceeds the ${ARCHIVE_MAX_ENTRIES} entry limit`))
      return
    }
    const normalized = file.name.replace(/\\/g, '/')
    if (normalized === '' || normalized.endsWith('/')) return
    try {
      assertSafeEntryName(normalized)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const target = join(dest, normalized)
    if (target !== dest && !target.startsWith(`${dest}${sep}`)) {
      fail(new Error(`zip entry escapes the extraction root: ${file.name}`))
      return
    }
    let entryBytes = 0
    const chunks: Buffer[] = []
    file.ondata = (error: FlateError | null, data: Uint8Array, final: boolean): void => {
      if (error !== null) {
        fail(error)
        return
      }
      entryBytes += data.byteLength
      totalBytes += data.byteLength
      if (entryBytes > ARCHIVE_MAX_ENTRY_BYTES) {
        fail(new Error(`archive entry "${file.name}" exceeds the ${ARCHIVE_MAX_ENTRY_BYTES} byte per-entry limit`))
        return
      }
      if (totalBytes > ARCHIVE_MAX_EXTRACTED_BYTES) {
        fail(new Error(`archive exceeds the ${ARCHIVE_MAX_EXTRACTED_BYTES} byte extracted-size limit`))
        return
      }
      chunks.push(Buffer.from(data))
      if (final) entries.push({ target, chunks })
    }
    file.start()
  }

  const view = new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength)
  const slice = 64 * 1024
  for (let offset = 0; offset < view.length && failure === undefined; offset += slice) {
    unzip.push(view.subarray(offset, Math.min(offset + slice, view.length)), offset + slice >= view.length)
  }
  if (failure !== undefined) throw failure
  for (const { target, chunks } of entries) await writeZipEntry(target, chunks)
}

async function writeZipEntry(target: string, chunks: Buffer[]): Promise<void> {
  await mkdir(resolve(target, '..'), { recursive: true })
  const handle = await open(target, 'w')
  try {
    for (const chunk of chunks) await handle.write(chunk)
  } finally {
    await handle.close()
  }
}

function assertSafeEntryName(name: string): void {
  if (name.startsWith('/') || name === '..' || name.startsWith('../') || name.includes('/../')) {
    throw new Error(`archive entry escapes the extraction root: ${name}`)
  }
}

async function extractTar(archiveFile: string, dest: string, format: ArchiveFormat): Promise<void> {
  const args = format === 'targz' ? ['-xzf', archiveFile] : ['-xf', archiveFile]
  args.push('--no-same-owner')
  await run('tar', args, { cwd: dest, timeout: 120_000 })
  await assertBoundedTree(dest)
}

async function assertBoundedTree(root: string): Promise<void> {
  const stack: string[] = [root]
  let entriesSeen = 0
  let totalBytes = 0
  while (stack.length > 0) {
    const dir = stack.pop()!
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of dirents) {
      const path = join(dir, entry.name)
      entriesSeen += 1
      if (entriesSeen > ARCHIVE_MAX_ENTRIES) {
        throw new Error(`archive exceeds the ${ARCHIVE_MAX_ENTRIES} entry limit`)
      }
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(path)
        continue
      }
      let size = 0
      try {
        size = (await stat(path)).size
      } catch {
        continue
      }
      totalBytes += size
      if (size > ARCHIVE_MAX_ENTRY_BYTES) {
        throw new Error(`archive entry exceeds the ${ARCHIVE_MAX_ENTRY_BYTES} byte per-entry limit: ${entry.name}`)
      }
      if (totalBytes > ARCHIVE_MAX_EXTRACTED_BYTES) {
        throw new Error(`archive exceeds the ${ARCHIVE_MAX_EXTRACTED_BYTES} byte extracted-size limit`)
      }
    }
  }
}

async function assertNoEscapingSymlinks(root: string): Promise<void> {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await readlink(path, 'utf8').catch(() => '')
        const resolved = resolve(dir, target)
        if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
          throw new Error(`archive contains a symlink escaping the extraction root: ${entry.name} -> ${target}`)
        }
        continue
      }
      if (entry.isDirectory()) stack.push(path)
    }
  }
}

export const assertNoEscapingSymlinksForTest = assertNoEscapingSymlinks

async function unwrapSingleRoot(extractDir: string): Promise<string> {
  const entries = await readdir(extractDir, { withFileTypes: true })
  if (entries.length === 1 && entries[0]!.isDirectory()) return join(extractDir, entries[0]!.name)
  return extractDir
}

async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await copyTree(source, target)
    else if (entry.isFile()) {
      const handle = await open(target, 'w')
      try {
        await handle.write(await readFile(source))
      } finally {
        await handle.close()
      }
    }
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function extractLocalZip(bytes: Uint8Array, dest: string): Promise<void> {
  if (bytes.byteLength > ARCHIVE_MAX_BYTES) throw Error('SKILL_ARCHIVE_TOO_LARGE')
  await mkdir(dest, { recursive: true })
  const temporary = `${dest}.zip`
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.write(bytes)
    } finally {
      await handle.close()
    }
    await extractZip(temporary, dest)
    await restoreZipModes(Buffer.from(bytes), dest)
    await assertNoEscapingSymlinks(dest)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function restoreZipModes(bytes: Buffer, dest: string): Promise<void> {
  let end = bytes.length - 22
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end -= 1
  if (end < Math.max(0, bytes.length - 65557)) throw Error('INVALID_ZIP_DIRECTORY')
  let offset = bytes.readUInt32LE(end + 16)
  const count = bytes.readUInt16LE(end + 10)
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw Error('INVALID_ZIP_DIRECTORY')
    const length = bytes.readUInt16LE(offset + 28)
    const name = bytes
      .subarray(offset + 46, offset + 46 + length)
      .toString('utf8')
      .replaceAll('\\', '/')
    assertSafeEntryName(name)
    const mode = bytes.readUInt32LE(offset + 38) >>> 16
    if ((mode & 0o170000) === 0o120000) throw Error('SKILL_ZIP_SYMLINK_UNSUPPORTED')
    if (bytes[offset + 5] === 3 && (mode & 0o170000) === 0o100000) await chmod(join(dest, name), mode & 0o777)
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
  }
}
