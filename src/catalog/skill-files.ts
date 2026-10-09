import { open } from 'node:fs/promises'
/** Read only the frontmatter bytes; discovery never expands instruction bodies. */
export async function readSkillHeader(file: string, signal?: AbortSignal): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const bytes: number[] = []
    const byte = Buffer.alloc(1)
    let lines = 0
    let line = ''
    while (bytes.length < 65536) {
      signal?.throwIfAborted()
      if ((await handle.read(byte, 0, 1, null)).bytesRead === 0) break
      bytes.push(byte[0])
      line += String.fromCharCode(byte[0])
      if (lines === 0) {
        const prefix = Buffer.from(bytes).toString('utf8')
        if (bytes.length === 3 && prefix !== '---' && prefix !== '\uFEFF') return ''
        if (bytes.length === 6 && bytes[0] === 0xef && prefix !== '\uFEFF---') return ''
        if (((bytes.length === 4 && bytes[0] !== 0xef) || (bytes.length === 7 && bytes[0] === 0xef)) && byte[0] !== 10 && byte[0] !== 13) return ''
      }
      if (byte[0] === 10) {
        if (
          lines === 0 &&
          Buffer.from(bytes)
            .toString('utf8')
            .replace(/^\uFEFF/, '')
            .trim() !== '---'
        )
          return ''
        if (lines > 0 && /^---[ \t]*(?:\r?\n|$)/.test(line)) return Buffer.from(bytes).toString('utf8')
        lines++
        line = ''
      }
    }
    if (lines === 0) return ''
    if (/^---[ \t]*(?:\r?\n|$)/.test(line)) return Buffer.from(bytes).toString('utf8')
    throw Error('INVALID_SKILL_FRONTMATTER')
  } finally {
    await handle.close()
  }
}
