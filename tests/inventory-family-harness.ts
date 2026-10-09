/** Actual package resources; role expectations remain independent of the GEA policy. */
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { profileFor } from 'preset-integration-gea/host/prompt-policy'
import { baseInventoryHarness } from './base-inventory-harness.js'
import { inventoryRoles } from './inventory-family-cases.js'
export { inventoryRoles } from './inventory-family-cases.js'

export async function inventoryRoleInput(role: (typeof inventoryRoles)[number]) {
  const preset = `gea-html-${role.id}`
  const profile = profileFor(preset)!
  const root = resolve(import.meta.dirname, '../business-resources', role.id)
  const resource = {
    id: preset,
    label: profile.label,
    presetName: profile.presetName,
    description: profile.description,
    root,
    prompt: 'prompt.json',
    capability: 'capability.json',
    profile,
    skillFiles: { [role.id]: `skills/${role.skillDirectory}/SKILL.md` }
  }
  const contract = JSON.parse(await readFile(resolve(root, 'capability.json'), 'utf8'))
  return { resource, contract }
}

export async function inventoryFamilyHarness(role: (typeof inventoryRoles)[number], input: { sessionId?: string; cwd?: string; seed?: readonly unknown[] } = {}) {
  const { resource, contract } = await inventoryRoleInput(role)
  return { ...(await baseInventoryHarness({ ...input, resource, contract, sessionId: input.sessionId ?? role.id })), resource }
}
