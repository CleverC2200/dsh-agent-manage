import { defineConfig } from 'vitest/config'
import { hostConfig as base } from './vitest.config.js'

export default defineConfig({
  ...base,
  test: { ...base.test, hookTimeout: 30_000, include: ['tests/user-agent-journey.browser.ts'], exclude: [] }
})
