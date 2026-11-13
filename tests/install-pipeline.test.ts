import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures', 'v1-suite')

let tmpRoot: string
let userRoot: string
let dataRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join('/tmp', 'dsh-agent-pipeline-'))
  userRoot = await mkdtemp(join(tmpRoot, 'user'))
  dataRoot = join(tmpRoot, 'data')
  await mkdir(join(userRoot, '.sources'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('full install pipeline: addSource → install → setEnabled → enabledUserSuites', () => {
  it('discovers, installs, enables, and lists a suite from a local source', async () => {
    const catalog = new Catalog({ userRoot, dataRoot, onChanged: () => {} })
    await catalog.load()

    const source = await catalog.addSource({ url: fixture, local: true })
    expect(source.id).toBeTruthy()
    expect(source.local).toBe(true)

    let snapshot = await catalog.readUserCatalog()
    expect(snapshot.sources.map(s => s.id)).toContain(source.id)
    const discoveredSuite = snapshot.suites.find(s => s.sourceId === source.id)
    expect(discoveredSuite).toBeDefined()
    expect(discoveredSuite!.manifest.name).toBe('v1-suite')

    expect(await catalog.enabledUserSuites()).toEqual([])

    await catalog.install(source.id, discoveredSuite!.id)
    snapshot = await catalog.readUserCatalog()
    const installed = snapshot.suites.find(s => s.sourceId === source.id && s.id === discoveredSuite!.id)
    expect(installed).toBeDefined()
    expect(snapshot.enabledSuites.find(s => s.sourceId === source.id && s.id === discoveredSuite!.id)).toBeDefined()

    const enabled = await catalog.enabledUserSuites()
    expect(enabled.map(s => `${s.sourceId}/${s.id}`)).toContain(`${source.id}/${discoveredSuite!.id}`)

    await catalog.setEnabled(source.id, discoveredSuite!.id, false)
    const disabled = await catalog.enabledUserSuites()
    expect(disabled.map(s => `${s.sourceId}/${s.id}`)).not.toContain(`${source.id}/${discoveredSuite!.id}`)
    const stillInstalled = (await catalog.readUserCatalog()).suites.find(s => s.sourceId === source.id && s.id === discoveredSuite!.id)
    expect(stillInstalled).toBeDefined()

    await catalog.uninstall(source.id, discoveredSuite!.id)
    const afterUninstall = await catalog.readUserCatalog()
    expect(afterUninstall.enabledSuites.map(s => `${s.sourceId}/${s.id}`)).not.toContain(`${source.id}/${discoveredSuite!.id}`)
    expect(await catalog.enabledUserSuites()).toEqual([])

    expect(afterUninstall.suites.find(s => s.sourceId === source.id && s.id === discoveredSuite!.id)).toBeDefined()
  })

  it('persists state across Catalog instances (state.json round-trips through reload)', async () => {
    const suiteId = 'v1-suite'

    const first = new Catalog({ userRoot, dataRoot, onChanged: () => {} })
    await first.load()
    const source = await first.addSource({ url: fixture, local: true })
    await first.install(source.id, suiteId)
    await first.setEnabled(source.id, suiteId, true)
    const enabledBefore = await first.enabledUserSuites()
    expect(enabledBefore.length).toBe(1)

    const reloaded = new Catalog({ userRoot, dataRoot, onChanged: () => {} })
    await reloaded.load()
    const snapshot = await reloaded.readUserCatalog()
    expect(snapshot.sources.map(s => s.id)).toContain(source.id)
    expect(snapshot.enabledSuites.map(s => `${s.sourceId}/${s.id}`)).toContain(`${source.id}/${suiteId}`)
    expect((await reloaded.enabledUserSuites()).length).toBe(1)

    await reloaded.removeSource(source.id)
    const afterRemove = await reloaded.readUserCatalog()
    expect(afterRemove.sources.map(s => s.id)).not.toContain(source.id)
    expect(afterRemove.enabledSuites).toEqual([])
  })
})
