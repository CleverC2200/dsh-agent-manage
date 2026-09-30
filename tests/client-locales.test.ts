import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.js'

describe('Agent Plugins Market client compatibility', () => {
  it('keeps Chinese and English dictionaries in lockstep', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of Object.keys(zh)) {
      expect(en[key as keyof typeof en]).not.toBe('')
      expect(zh[key as keyof typeof zh]).not.toBe('')
    }
  })
})
