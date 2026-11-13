import z from '@deepseek-ai/schemastery'

const MarketSettingsFields = {
  mcpEnhanced: z.boolean().default(true),

  scanProjectLayouts: z.boolean().default(true),

  downloadRegion: z.union([z.const('auto'), z.const('global'), z.const('china')]).default('auto'),

  feedbackEnabled: z.boolean().default(true)
}

export const MarketSettingsSchema = z.object(MarketSettingsFields)

export const ManageConfigSchema = z.object({
  mcpEnhanced: MarketSettingsFields.mcpEnhanced.volatile(),
  scanProjectLayouts: MarketSettingsFields.scanProjectLayouts.volatile(),
  downloadRegion: MarketSettingsFields.downloadRegion.volatile(),
  feedbackEnabled: MarketSettingsFields.feedbackEnabled.volatile()
})
