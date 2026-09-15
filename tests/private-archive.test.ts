import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveFormatOf, downloadArchive } from '../src/catalog/archive.js'
afterEach(() => vi.restoreAllMocks())
it('supports GitHub zipball sources and drops caller credentials before following asset redirects', async () => {
  expect(archiveFormatOf('https://api.github.com/repos/CleverC2200/company-agent-suites/zipball/main')).toBe('zip')
  const root = await mkdtemp(join(tmpdir(), 'private-archive-'))
  const calls: RequestInit[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    calls.push(init ?? {})
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://codeload.github.com/company/suites/zip/main' } }) : new Response('archive bytes')
  })
  try {
    await downloadArchive('https://api.github.com/repos/CleverC2200/company-agent-suites/zipball/main', join(root, 'archive'), { githubToken: 'caller-secret' })
    expect(new Headers(calls[0]?.headers).get('Authorization')).toBe('Bearer caller-secret')
    expect(new Headers(calls[1]?.headers).has('Authorization')).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
