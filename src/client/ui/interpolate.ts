/** Locale parameter interpolation shared by the market client surfaces. */
/** 文件作用：为宿主翻译函数补充 `{name}` 参数插值，并保留未知占位符以便诊断。 */

/**
 * Replace `{name}` placeholders with their parameter values.
 *
 * Kept local because hosts whose bound translator ignores params still return
 * the raw template; unknown placeholders pass through untouched.
 *
 * @param text - Localized template containing `{name}` placeholders.
 * @param params - Values keyed by placeholder name.
 * @returns The template with every known placeholder substituted.
 *
 * 中文：将翻译模板中的已知占位符替换为参数值，未知占位符保持原样，便于发现缺失参数。
 */
export function interpolate(text: string, params: Record<string, unknown>): string {
  /** 替换已提供参数，未识别的占位符原样返回。 */
  // 中文：只替换参数表中存在的键，其他占位符继续保留。
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match))
}
