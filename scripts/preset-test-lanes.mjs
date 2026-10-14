/** Required capability cases and client-owned Host helpers share one discovery policy. */
export const presetLanes = {
  'standard-skill': {
    'tests/standard-preset.test.ts': 11,
    'tests/skill-preset.test.ts': 5,
    'tests/manage-cold-boot.test.ts': 6,
    'tests/manage-settings.test.ts': 1,
    'tests/bundled-sales-skills.test.ts': 2,
    'tests/manage-bundle-default.test.ts': 1
  },
  client: {
    'tests/standard-preset-draft.test.ts': 1,
    'tests/preset-catalog-client.test.ts': 1,
    'tests/skill-preset-client.test.ts': 1,
    'tests/base-preset-client.test.ts': 1,
    'tests/sales-preset-client.test.ts': 2,
    'tests/inventory-family-client.test.ts': 3
  },
  gea: {
    'tests/business-admission-gea.test.ts': 4,
    'tests/standard-preset-gea.test.ts': 11,
    'tests/skill-preset-gea.test.ts': 1,
    'tests/sales-preset-gea.test.ts': 11,
    'tests/inventory-family-preset.test.ts': 13
  }
}

// These execute only inside their owning client test with a request/receipt pair.
export const presetHostHelpers = [
  'tests/base-resource-host.test.ts',
  'tests/skill-resource-host.test.ts',
  'tests/sales-resource-host.test.ts',
  'tests/inventory-family-host.test.ts',
  'tests/preset-catalog-host.test.ts'
]
