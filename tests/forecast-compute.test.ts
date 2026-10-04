import { expect, it } from 'vitest'
import reference from './fixtures/forecast-v2-reference.json' with { type: 'json' }
import { computeForecast, createForecastTool } from '../src/runtime/forecast-compute.js'
it('preserves the fourteen unchanged suite forecast scenarios and exact decimal results', () => {
  expect(reference.cases).toHaveLength(14)
  for (const fixture of reference.cases) {
    const actual = computeForecast(fixture.input) as { coverage: unknown; rows: Array<Record<string, unknown>>; external_writes: boolean; source_verified_by_calculator: boolean }
    expect(actual.coverage, fixture.name).toEqual(fixture.expected.coverage)
    for (const [index, row] of actual.rows.entries()) {
      const expected = fixture.expected.rows[index]
      expect(row.status, fixture.name).toBe(expected.status)
      for (const key of ['forecast1', 'forecast2', 'recommended_baseline', 'final_forecast', 'amount'] as const) {
        if (expected[key] === null) expect(row[key], fixture.name).toBeNull()
        else expect(Number(row[key]), fixture.name).toBeCloseTo(expected[key], 8)
      }
    }
    expect(actual.external_writes).toBe(false)
    expect(actual.source_verified_by_calculator).toBe(false)
  }
})

it('keeps missing growth unknown, rejects unsafe integer inputs and exact decimal tool numbers', async () => {
  const input = structuredClone(reference.cases[0].input)
  delete input.records[0].target_mom_growth
  const missing = computeForecast(input) as { rows: Array<Record<string, unknown>> }
  expect(missing.rows[0].recommended_baseline).toBeNull()
  expect(missing.rows[0].final_forecast).toBeNull()
  const unsafe = structuredClone(reference.cases[0].input)
  Object.assign(unsafe.records[0], { base_plan_qty: 9007199254740992 })
  expect((computeForecast(unsafe) as { rows: Array<Record<string, unknown>> }).rows[0].status).toBe('blocked')
  const tool = createForecastTool({ get: async () => ({ invocation: { modelInvocable: true } }) } as never)
  await expect(tool.execute(unsafe as never, { signal: new AbortController().signal } as never)).rejects.toThrow(/invalid arguments/)
})
it('calculates only while the baseline Skill is available in the caller workspace and keeps user provenance separate from authorization', async () => {
  let enabled = true
  const tool = createForecastTool({
    get: async (_name: string, view: { cwd: string; signal: AbortSignal }) => {
      expect(view.cwd).toBe('/selected/workspace')
      view.signal.throwIfAborted()
      return enabled ? { invocation: { modelInvocable: true } } : undefined
    }
  } as never)
  const input = structuredClone(reference.cases[0].input)
  for (const row of input.records)
    for (const field of ['base_plan_qty', 'base_actual_to_cutoff_qty', 'prior_base_actual_qty', 'prior_target_actual_qty', 'target_yoy_growth', 'target_mom_growth'] as const)
      Object.assign(row, { [field]: String(row[field]) })
  const agent = {
    session: {
      header: { cwd: '/selected/workspace' },
      snapshotEvents: () => [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: JSON.stringify(input) }] } }]
    }
  }
  const result = JSON.parse(await tool.execute(input as never, { agent, signal: new AbortController().signal } as never))
  expect(result.source.userInputVerified).toBe(true)
  expect(result.source.businessAuthorization).toBe(false)
  expect(result.source_verified_by_calculator).toBe(false)
  expect(result.source.inputHash).toMatch(/^[a-f0-9]{64}$/)
  enabled = false
  await expect(tool.execute(input as never, { agent, signal: new AbortController().signal } as never)).rejects.toThrow(/FORECAST_CAPABILITY_DISABLED/)
})
