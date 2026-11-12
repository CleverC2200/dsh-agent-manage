import { createHash } from 'node:crypto'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'

export const FORECAST_VERSION = 'gea-v2-5.5-decimal-1'
export type ForecastBaseline = Pick<SkillDefinition, 'name' | 'provider' | 'path' | 'resourceBase' | 'content' | 'invocation'>

export function forecastBaselineHash(baseline: ForecastBaseline | undefined): string {
  if (!baseline?.invocation.modelInvocable) throw Error('FORECAST_CAPABILITY_DISABLED: Select an installed, enabled forecast resource / 请选用已安装启用的预测资源。')
  return forecastInputHash({
    name: baseline.name,
    provider: baseline.provider,
    path: baseline.path,
    resourceBase: baseline.resourceBase,
    content: baseline.content,
    invocation: baseline.invocation
  })
}

export function forecastSourceProof(input: unknown, messages: readonly unknown[], baseline: ForecastBaseline | undefined) {
  const inputHash = forecastInputHash(input)
  return {
    inputHash,
    calculatorVersion: FORECAST_VERSION,
    baselineHash: forecastBaselineHash(baseline),
    userInputVerified: hasUserForecastInput(messages, inputHash),
    businessAuthorization: false as const
  }
}

export function forecastInputHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, canonical(child)])
      )
    return item
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}

export function hasUserForecastInput(messages: readonly unknown[], digest: string): boolean {
  for (const message of messages) {
    const value = message as { source?: { kind?: string }; content?: unknown }
    if (value.source?.kind !== 'user' || !Array.isArray(value.content)) continue
    for (const block of value.content) {
      if (block.type !== 'text' || typeof block.text !== 'string' || block.text.length > 8_000_000) continue
      const text = block.text
      let start = -1,
        depth = 0,
        quoted = false,
        escaped = false
      for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (start < 0) {
          if (char === '{') {
            start = i
            depth = 1
          }
          continue
        }
        if (quoted) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') quoted = false
        } else if (char === '"') quoted = true
        else if (char === '{') depth++
        else if (char === '}' && --depth === 0) {
          try {
            const input = JSON.parse(text.slice(start, i + 1))
            if (['provided', 'mock'].includes(input.data_mode) && forecastInputHash(input) === digest) return true
          } catch {}
          start = -1
        }
      }
    }
  }
  return false
}
