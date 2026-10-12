import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submitFeedback, FEEDBACK_TOOL_NAME, renderFeedbackBody } from '../src/runtime/feedback-tool.js'

const originalTokens = { GITHUB_TOKEN: process.env['GITHUB_TOKEN'], GH_TOKEN: process.env['GH_TOKEN'] }

describe('experience feedback tool', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', undefined)
    vi.stubEnv('GH_TOKEN', undefined)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('EXTERNAL_FEEDBACK_DISABLED_IN_TEST')))
  })
  afterEach(() => {
    const blockedFetch = fetch
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    expect(blockedFetch).not.toHaveBeenCalled()
    for (const key of ['GITHUB_TOKEN', 'GH_TOKEN'] as const) expect(process.env[key] === originalTokens[key]).toBe(true)
  })
  it('spools reports locally when no GitHub token is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    try {
      const outcome = await submitFeedback(
        root,
        {
          title: 'Install fails for archive sources',
          description: 'The install button errors with "invalid override payload".',
          expected: 'The suite installs.',
          actual: 'The request fails.'
        },
        1_000_000
      )
      expect(outcome.ok).toBe(true)
      expect(outcome.location).toContain('reports.jsonl')
      const raw = await readFile(join(root, 'feedback', 'reports.jsonl'), 'utf8')
      const record = JSON.parse(raw.trim()) as { title: string; body: string }
      expect(record.title).toBe('Install fails for archive sources')
      expect(record.body).toContain('invalid override payload')
      expect(record.body).toContain('**Expected:** The suite installs.')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enforces the burst cooldown between submissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    try {
      const first = await submitFeedback(root, { title: 'a', description: 'b' }, 2_000_000)
      expect(first.ok).toBe(true)
      const second = await submitFeedback(root, { title: 'c', description: 'd' }, 2_000_000 + 1_000)
      expect(second.ok).toBe(false)
      expect(second.reason).toContain('less than a minute')
      // After the cooldown window the submission goes through again.
      const third = await submitFeedback(root, { title: 'e', description: 'f' }, 2_000_000 + 61_000)
      expect(third.ok).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a blank title without creating feedback files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    try {
      expect(await submitFeedback(root, { title: ' \t\n ', description: 'y' })).toEqual({ ok: false, reason: 'title is required' })
      await expect(readFile(join(root, 'feedback', 'reports.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(root, 'feedback', 'last-submit-at'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('renders a deterministic body', () => {
    expect(renderFeedbackBody({ title: 'x', description: 'y', actual: 'z' })).toContain('**Actual:** z')
  })

  it('exposes a stable tool name', () => {
    expect(FEEDBACK_TOOL_NAME).toBe('report_market_issue')
  })
})
