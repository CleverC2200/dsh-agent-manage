/** 文件作用：解析下载区域设置，并生成 GitHub 全局或中国代理地址。 */
/**
 * Download regions for GitHub acquisition, modeled on dshmarket's regions.js:
 * one setting answers "where are you" instead of a row of mirror toggles.
 *
 * The China route proxies github.com clones through a public prefix proxy —
 * `git clone https://gh-proxy.com/https://github.com/owner/repo` — rather
 * than rewriting the hostname, which is what lets one prefix cover clone,
 * fetch, and release downloads without a mapping table per service. Public
 * proxies come and go, so the route carries an environment escape hatch
 * (`DSH_MARKET_GITHUB_PROXY`), and the region itself is a setting the user
 * can flip at any time; sources already cloned keep their proxied origin and
 * follow it on refresh.
 *
 * @module runtime/regions
 */

/** The persisted setting: `auto` follows the interface language. */
export type DownloadRegionSetting = 'auto' | 'global' | 'china'

/** The route downloads actually take. */
export type EffectiveRegion = 'global' | 'china'

/** The China-route GitHub prefix proxy, no trailing slash. */
const DEFAULT_GITHUB_PROXY = 'https://gh-proxy.com'

/** Narrow an untrusted stored value to a setting; anything else reads as auto. */
/** 将持久化或请求中的未知值收窄为合法区域设置，非法值回退 auto。 */
export function narrowDownloadRegion(value: unknown): DownloadRegionSetting {
  return value === 'global' || value === 'china' ? value : 'auto'
}

/**
 * Resolve the effective region: an explicit choice wins; `auto` follows the
 * interface language — a Chinese-language user defaults to the China route.
 * @param setting - the persisted `downloadRegion` value.
 * @param localePreference - the Host `locale.preference` value, when known.
 */
/** 显式设置优先；auto 根据宿主中文偏好决定 global 或 china 路由。 */
export function resolveRegion(setting: DownloadRegionSetting, localePreference: string | undefined): EffectiveRegion {
  if (setting === 'global' || setting === 'china') return setting
  return localePreference !== undefined && localePreference.toLowerCase().startsWith('zh') ? 'china' : 'global'
}

/**
 * Route a clone URL for the region. Only github.com-family https URLs are
 * proxied — local paths and third-party hosts go through unchanged, as does
 * everything in the global region.
 * @param region - the effective region for this download.
 * @param url - the clone URL.
 * @param env - environment, carrying the `DSH_MARKET_GITHUB_PROXY` escape hatch.
 */
/** 仅代理 github.com HTTPS 克隆地址，其余地址原样返回并支持环境变量覆盖代理。 */
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
