/** Actual official settings and selector render the real Host registry projection. */
import { expect, it, onTestFinished } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentPresetSection } from '../../../official-latest-standard/packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx'
import { AgentPresetSeat } from '../../../official-latest-standard/packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx'
import { presetDisplayText, zh } from '../../../official-latest-standard/packages/client/ui-agent-preset/src/client/locales.ts'
import { core } from './official-core-input.js'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'

it('uses the same actual catalog names and descriptions in official settings and every selected new-task chip', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'preset-catalog-display-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  await promisify(execFile)(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.preset-host.config.ts', 'tests/preset-catalog-host.test.ts'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, PRESET_EVIDENCE_DIR: directory },
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024
  })
  const hostReceipt = await readFile(join(directory, 'company-catalog.json'), 'utf8')
  if (process.env.PRESET_EVIDENCE_DIR) await writeFile(join(process.env.PRESET_EVIDENCE_DIR, 'company-catalog.json'), hostReceipt)
  const { catalog, resources } = JSON.parse(hostReceipt) as {
    catalog: AgentPresetRow[]
    resources: { id: string; label: string; description?: string }[]
  }
  const t = (key: keyof typeof zh) => zh[key]
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  onTestFinished(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  const render = async (component: ReturnType<typeof createElement>) => {
    await act(async () => root.render(component))
    return container.innerHTML
  }
  const actions = { load: async () => {}, view: async () => {}, closeView: () => {}, makeDefault: async () => {}, close: () => {} }
  const settings = (developerTools: boolean) =>
    render(
      createElement(AgentPresetSection, {
        ...actions,
        t,
        useDeveloperTools: (select: (value: boolean) => unknown) => select(developerTools),
        useAgentPresetSection: (select: (value: unknown) => unknown) => select({ status: 'ready', error: null, saving: false, rows: catalog, view: null })
      } as never)
    )
  const settingsMarkup = await settings(true)
  const displayed = []
  for (const row of catalog) {
    const display = presetDisplayText(row, t)
    expect(settingsMarkup).toContain(display.name)
    expect(settingsMarkup).toContain(display.description)
    const chip = await render(
      createElement(AgentPresetSeat, {
        key: row.id,
        t,
        load: async () => {},
        select: async () => undefined,
        dismissRefusal: () => {},
        introduced: () => {},
        useDeveloperTools: (select: (value: boolean) => unknown) => select(true),
        useSessionRetainInfo: (select: (value: undefined) => unknown) => select(undefined),
        useAgentPresetSeat: (select: (value: unknown) => unknown) => select({ options: catalog, current: row.id, error: null, busy: false, introduce: false })
      } as never)
    )
    expect(chip).toContain(display.name)
    const button = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await act(async () => button.click())
    const menu = document.querySelector('[role="menu"]')
    expect(menu?.textContent).toContain(display.description)
    const resource = resources.find(resource => resource.id === row.id)
    if (resource) expect(display).toEqual({ name: resource.label, description: resource.description })
    displayed.push({ id: row.id, ...display })
  }
  const codingOff = await settings(false)
  const { version } = JSON.parse(await readFile(join(core, 'package.json'), 'utf8'))
  expect(['0.2.0-rc.2', '0.2.1-alpha.1']).toContain(version)
  const developerToolsOffVisibility = Object.fromEntries(['minimal', 'ptc', 'cordis'].map(id => [id, codingOff.includes(`data-agent-preset-id="${id}"`)]))
  for (const id of ['minimal', 'ptc']) expect(developerToolsOffVisibility[id]).toBe(version === '0.2.0-rc.2')
  expect(developerToolsOffVisibility.cordis).toBe(true)
  if (process.env.PRESET_EVIDENCE_DIR)
    await writeFile(
      join(process.env.PRESET_EVIDENCE_DIR, 'client-catalog-display.json'),
      JSON.stringify(
        {
          displayed,
          officialCoreVersion: version,
          officialSettings: true,
          officialSelector: true,
          sameHostCatalog: true,
          developerToolsOffVisibility,
          codingToolsOffHidesMinimalAndPTC: !developerToolsOffVisibility.minimal && !developerToolsOffVisibility.ptc,
          visualBrowser: 'not-run'
        },
        null,
        2
      ) + '\n'
    )
})
