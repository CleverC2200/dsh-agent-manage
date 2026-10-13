/** CI runs capability files in check:capabilities, preserving the remaining test union here. */
import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'
import { presetLanes } from './scripts/preset-test-lanes.mjs'

export default defineConfig({
  ...base,
  test: { ...base.test, exclude: [...base.test.exclude, ...Object.keys(presetLanes['standard-skill'])] }
})
