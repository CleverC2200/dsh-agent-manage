export type DownloadRegionSetting = 'auto' | 'global' | 'china'

export type EffectiveRegion = 'global' | 'china'

const DEFAULT_GITHUB_PROXY = 'https://gh-proxy.com'

export function narrowDownloadRegion(value: unknown): DownloadRegionSetting {
  return value === 'global' || value === 'china' ? value : 'auto'
}

export function resolveRegion(setting: DownloadRegionSetting, localePreference: string | undefined): EffectiveRegion {
  if (setting === 'global' || setting === 'china') return setting
  return localePreference !== undefined && localePreference.toLowerCase().startsWith('zh') ? 'china' : 'global'
}

export function githubCloneUrl(region: EffectiveRegion, url: string, env: NodeJS.ProcessEnv = process.env): string {
  if (region !== 'china') return url
  let host: string | undefined
  try {
    host = new URL(url).hostname
  } catch {
    return url
  }
  if (host !== 'github.com' && host !== 'www.github.com') return url
  const override = env['DSH_MARKET_GITHUB_PROXY']
  const proxy = override !== undefined && override.trim() !== '' ? override.trim().replace(/\/+$/, '') : DEFAULT_GITHUB_PROXY
  return `${proxy}/${url}`
}
