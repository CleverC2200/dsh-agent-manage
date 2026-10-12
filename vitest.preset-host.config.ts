/** Client child processes run the actual Host assertions with request/receipt inputs. */
import { defineConfig } from 'vitest/config'
import integration from './vitest.preset-integration.config.js'
import { presetHostHelpers } from './scripts/preset-test-lanes.mjs'

export default defineConfig({
  ...integration,
  test: { ...integration.test, include: presetHostHelpers }
})
