/** The browser journey is explicit; ordinary unit runs need no installed Chromium. */
import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'

export default defineConfig({
  ...base,
  test: { ...base.test, hookTimeout: 30_000, include: ['tests/user-agent-journey.browser.ts'], exclude: [] }
})
