import z from '@deepseek-ai/schemastery'

/** Schema of the market settings namespace: the MCP enhancement switch, the download region, and the feedback tool switch. */
const MarketSettingsFields = {
  /** ON (default) = the built-in bridge with OAuth and SSE; OFF = host client compat mode. */
  mcpEnhanced: z.boolean().default(true),
  /** Read native Agent layouts under the project root; default preserves existing discovery. */
  scanProjectLayouts: z.boolean().default(true),
  /** Download region for GitHub acquisition; `auto` follows the interface language. */
  downloadRegion: z.union([z.const('auto'), z.const('global'), z.const('china')]).default('auto'),
  /** ON (default) = the `report_market_issue` model tool is registered; OFF = unregistered. */
  feedbackEnabled: z.boolean().default(true)
}

export const MarketSettingsSchema = z.object(MarketSettingsFields)

/** Reuse the same field rules as live Loader Config without changing plain validation. */
export const ManageConfigSchema = z.object({
  mcpEnhanced: MarketSettingsFields.mcpEnhanced.volatile(),
  scanProjectLayouts: MarketSettingsFields.scanProjectLayouts.volatile(),
  downloadRegion: MarketSettingsFields.downloadRegion.volatile(),
  feedbackEnabled: MarketSettingsFields.feedbackEnabled.volatile()
})
