/** Fixed package resources and original Consumer declarations used by the sales family. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BusinessResourceDefinition } from '../src/runtime/business-resources.js'
import type { BusinessPresetHarnessInput } from './base-inventory-harness.js'
import { profileFor } from 'preset-integration-gea/host/prompt-policy'
import { workbenchContract } from 'preset-integration-gea/capability/contract'

export const salesRoles = [
  { id: 'gea-html-inventory-apsplan', name: '产销协同Agent', consumer: 'aps', persona: '你负责产销协同的预测、计划、生产、库存与履约分析', skill: 'inventory-apsplan' },
  { id: 'gea-readonly', name: '销售计划Agent', consumer: 'sales_forecast', persona: '你负责销售计划的提报情况、版本明细、需求预测和审批依据分析', skill: undefined }
] as const

export async function salesRoleInput(id: string): Promise<BusinessPresetHarnessInput> {
  const profile = profileFor(id)!
  const metadata = { id, label: profile.label, presetName: profile.presetName, description: profile.description, profile }
  if (id === 'gea-readonly')
    return {
      resource: { ...metadata, root: resolve(process.env.DSH_GEA_CHECKOUT ?? '../dsh-gea-plugin'), prompt: 'presets/prompt-policy.json', profileKey: id },
      contract: workbenchContract({ surface: 'gea-workbench', pageIds: ['gea-workbench'] }),
      externalResponse: async url =>
        url.pathname === '/sales-plan/plans'
          ? Response.json({ success: true, result: { records: [{ id: 'offline-plan', periodId: 'offline-period', orderType: 'M', qty: 42 }], total: 1 } })
          : undefined
    }
  const root = resolve(import.meta.dirname, '../business-resources/inventory-apsplan')
  const analysis: BusinessResourceDefinition = {
    id: 'aps-analysis-skills',
    label: 'APS analysis',
    root: resolve(import.meta.dirname, '../business-resources/aps-analysis'),
    profile: { label: 'APS analysis', consumerCode: 'aps', skills: ['sales-forecast-result-analysis', 'sales-ops-problem-analysis'] },
    skillFiles: { 'sales-forecast-result-analysis': 'sales-forecast-result-analysis.skill.md', 'sales-ops-problem-analysis': 'sales-ops-problem-analysis.skill.md' }
  }
  return {
    resource: { ...metadata, root, prompt: 'prompt.json', capability: 'capability.json', skillFiles: { 'inventory-apsplan': 'skills/aps/SKILL.md' } },
    contract: JSON.parse(await readFile(resolve(root, 'capability.json'), 'utf8')),
    additionalResources: [analysis]
  }
}
