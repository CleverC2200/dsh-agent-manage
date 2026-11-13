import { unitConfig } from './vitest.config.js'
import { presetLanes } from './scripts/preset-test-lanes.mjs'

export default unitConfig(Object.keys(presetLanes['standard-skill']))
