/** Required capability cases and client-owned Host helpers share one discovery policy. */
export const presetLanes = {
  'standard-skill': {
    'tests/standard-preset.test.ts': true,
    'tests/skill-preset.test.ts': true,
    'tests/manage-cold-boot.test.ts': true,
    'tests/manage-settings.test.ts': true,
    'tests/bundled-sales-skills.test.ts': true,
    'tests/manage-bundle-default.test.ts': true
  },
  client: {
    'tests/standard-preset-draft.test.ts': true,
    'tests/user-agent-retirement-draft.test.ts': true,
    'tests/agent-source-sync-draft.test.ts': true,
    'tests/preset-catalog-client.test.ts': true,
    'tests/skill-preset-client.test.ts': true,
    'tests/base-preset-client.test.ts': true,
    'tests/sales-preset-client.test.ts': true,
    'tests/inventory-family-client.test.ts': true
  },
  gea: {
    'tests/sales-agent-import-gea.test.ts': true,
    'tests/user-agent-cube-gea.test.ts': true,
    'tests/business-admission-gea.test.ts': true,
    'tests/standard-preset-gea.test.ts': true,
    'tests/skill-preset-gea.test.ts': true,
    'tests/sales-preset-gea.test.ts': true,
    'tests/inventory-family-preset.test.ts': true
  }
}

// These execute only inside their owning client test with a request/receipt pair.
export const presetHostOwners = {
  'tests/base-resource-host.test.ts': 'tests/base-preset-client.test.ts',
  'tests/skill-resource-host.test.ts': 'tests/skill-preset-client.test.ts',
  'tests/sales-resource-host.test.ts': 'tests/sales-preset-client.test.ts',
  'tests/inventory-family-host.test.ts': 'tests/inventory-family-client.test.ts',
  'tests/preset-catalog-host.test.ts': 'tests/preset-catalog-client.test.ts'
}

export const presetHostHelpers = Object.keys(presetHostOwners)
