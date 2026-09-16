/** Pure capability decision for the legacy page-mode fallback. */
/** 文件作用：判断旧版页面模式是否需要接管市场渲染。 */

/**
 * Use the DOM page fallback only when the host has no settings page and does
 * expose a page shell for the fallback to mount into.
 *
 * @param settingsSurfaceAvailable - whether `settings.section` is live.
 * @param pageShellAvailable - whether the sidebar/conversation shell exists.
 * @returns true when the fallback is the only available market surface.
 * 中文：仅当正式设置面板不可用且旧版页面壳存在时启用回退，避免两个入口同时出现。
 */
/** 根据宿主能力决定是否启用旧版回退，保证新版设置入口与页面入口互斥。 */
export function shouldUseLegacyPageMode(settingsSurfaceAvailable: boolean, pageShellAvailable: boolean): boolean {
  return !settingsSurfaceAvailable && pageShellAvailable
}
