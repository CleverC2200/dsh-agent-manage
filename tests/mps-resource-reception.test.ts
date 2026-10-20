import { officialStandardDocument } from './core-preset-harness.js'
import { expect, it } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SkillProvider, SkillProviderControl, SkillLookupOptions } from '@deepseek-ai/dsh-skill'
import { BusinessResources } from '../src/runtime/business-resources.js'

type NativeHost = ConstructorParameters<typeof BusinessResources>[0]
type Preset = Parameters<NativeHost['agentPresets']['register']>[0]
it('selects the received MPS persona and Skill, then withdraws only its installed resource contribution', async () => {
  const index = await mkdtemp(join(tmpdir(), 'mps-reception-'))
  const root = resolve('business-resources/inventory-mps')
  let provider: SkillProvider
  const presets = new Map<string, Preset>()
  const host = {
    skills: {
      registerProvider(create: (control: SkillProviderControl) => SkillProvider) {
        provider = create({ invalidate() {}, signal: new AbortController().signal })
        return () => {}
      },
      async list(options: SkillLookupOptions = {}) {
        return provider.list(options)
      },
      async get(name: string, options: SkillLookupOptions = {}) {
        const candidate = (await provider.list(options)).find(row => row.name === name)
        return candidate ? provider.get(candidate, options) : undefined
      }
    },
    agentPresets: {
      readDocument: officialStandardDocument,
      async register(preset: Preset) {
        presets.set(preset.id, preset)
        return async () => {
          presets.delete(preset.id)
        }
      },
      async resolve(id: string) {
        return { id }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(index, 'selected.json'))
  try {
    const otherRoot = resolve('business-resources/inventory-orderworkbench')
    const otherProfile = JSON.parse(await readFile(join(otherRoot, 'prompt.json'), 'utf8'))
    await resources.register([
      {
        id: 'gea-html-inventory-orderworkbench',
        label: otherProfile.label,
        root: otherRoot,
        prompt: 'prompt.json',
        profile: otherProfile,
        skillFiles: { 'inventory-orderworkbench': 'skills/orderworkbench/SKILL.md' }
      }
    ])
    const profile = JSON.parse(await readFile(join(root, 'prompt.json'), 'utf8'))
    const withdraw = await resources.register([
      { id: 'gea-html-inventory-mps', label: profile.label, root, prompt: 'prompt.json', profile, skillFiles: { 'inventory-mps': 'skills/inventory-mps/SKILL.md' } }
    ])
    const selected = await resources.select('gea-html-inventory-mps', new AbortController().signal)
    expect(selected.profile?.consumerCode).toBe('mps-prototype')
    const persona = (presets.get(selected.preset)!.plugins[0].config as { prefix: string }).prefix
    expect(persona).toContain('第一步需求确认使用本地文件进行隔离核对')
    expect(persona).toContain('CSV核对底稿是实际生成的本地文件，下载不等于业务保存')
    expect(persona).toContain('文件预览不代表数据库同步')
    const candidate = (await provider.list({})).find(row => row.name === 'inventory-mps')
    if (!candidate) throw Error('MPS Skill missing')
    expect(candidate.path).toBe(join(root, 'skills/inventory-mps/SKILL.md'))
    const skill = (await provider.get(candidate, {})).content
    expect(skill).toContain('上下文只覆盖当前挂载步骤')
    expect(skill).toContain('未发送文字')
    expect(skill).toContain('③至⑦仍沿用旧模拟内容')
    expect(skill).toContain('后续月份来源、计划达成率分母与历史参数口径尚未裁决的结果保持空')
    expect(skill).toContain('不沿用旧40/40/20权重')
    expect(skill).toContain('评估月份对应M+1')
    expect(persona).toContain('第二步本月预估发货支持本地输入、测算与人工调整')
    expect(skill).toContain('保留人工负值和负库存')
    await withdraw()
    expect(await provider.get(candidate, {})).toBeUndefined()
    expect((await resources.list()).map(row => row.id)).toEqual(['gea-html-inventory-orderworkbench', 'skill:inventory-orderworkbench'])
    expect((await provider.list({})).map(row => row.name)).toEqual(['inventory-orderworkbench'])
    expect(presets.has('gea-html-inventory-mps')).toBe(false)
    expect(await readFile(join(root, 'prompt.json'), 'utf8')).toContain('主生产计划Agent')
  } finally {
    await resources.dispose()
    await rm(index, { recursive: true, force: true })
  }
})
