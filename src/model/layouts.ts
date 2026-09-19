/** 文件作用：定义各 Agent 生态的插件、marketplace 和项目目录布局常量。 */
/** Ordered layout declarations shared by manifest and project discovery. 中文：本文件集中定义各编码 Agent 生态的插件与项目目录布局，供 manifest 识别和项目原生发现共用。 */
export const PLUGIN_LAYOUTS = [
  { kind: 'agent-plugin-v1', manifest: 'plugin.json', marketplaces: [] },
  { kind: 'universal', manifest: '.plugin/plugin.json', marketplaces: ['.plugin/marketplace.json'] },
  { kind: 'claude-code', manifest: '.claude-plugin/plugin.json', marketplaces: ['.claude-plugin/marketplace.json'] },
  { kind: 'cursor', manifest: '.cursor-plugin/plugin.json', marketplaces: ['.cursor-plugin/marketplace.json'] },
  { kind: 'kimi', manifest: '.kimi-plugin/plugin.json', marketplaces: ['.kimi-plugin/marketplace.json'] },
  { kind: 'codex', manifest: '.codex-plugin/plugin.json', marketplaces: ['.agents/plugins/marketplace.json', '.agents/plugins/api_marketplace.json'] },
  { kind: 'zcode', manifest: '.zcode-plugin/plugin.json', marketplaces: [] },
  { kind: 'qoder', manifest: '.qoder-plugin/plugin.json', marketplaces: ['.qoder-plugin/marketplace.json'] },
  { kind: 'github-copilot', manifest: '.github/plugin/plugin.json', marketplaces: ['.github/plugin/marketplace.json'] }
] as const

export type ManifestKind = (typeof PLUGIN_LAYOUTS)[number]['kind']
/** Kimi Code's primary spelling precedes its compatibility spelling within that dialect. 中文：Kimi 方言中优先使用主文件名，兼容别名只作后备。 */
export const MANIFEST_ALIASES: Partial<Record<ManifestKind, readonly string[]>> = { kimi: ['kimi.plugin.json'] }

/** Equivalent plugin-owned path variables; these never resolve as credentials. 中文：不同生态表示插件根目录和数据目录的等价变量，它们属于路径占位符，不是凭据。 */
export const PLUGIN_ROOT_VARIABLES: ReadonlySet<string> = new Set(['PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT', 'CODEX_PLUGIN_ROOT', 'ZCODE_PLUGIN_ROOT', 'QODER_PLUGIN_ROOT'])
export const PLUGIN_DATA_VARIABLES: ReadonlySet<string> = new Set(['PLUGIN_DATA', 'CLAUDE_PLUGIN_DATA', 'ZCODE_PLUGIN_DATA', 'QODER_PLUGIN_DATA'])

/** Explicit project document formats and portable surfaces; execution stays in the runtime adapters. 中文：声明可识别的项目配置格式和可移植 surface，真正执行仍由 runtime 适配器负责。 */
export type ProjectMcpFormat = 'mcpServers' | 'zcode' | 'codex'
export type ProjectHookFormat = 'claude' | 'zcode'
export interface ProjectLayout {
  dirName: string
  label: string
  subdirs: readonly string[]
  mcpFiles?: readonly string[]
  hookFiles?: readonly string[]
  mcpFormat?: ProjectMcpFormat
  hookFormat?: ProjectHookFormat
}

export const PROJECT_LAYOUTS = [
  {
    dirName: '.claude',
    label: 'Claude Code',
    subdirs: ['skills', 'agents', 'commands'],
    mcpFiles: ['.mcp.json'],
    hookFiles: ['.claude/settings.json', '.claude/settings.local.json']
  },
  { dirName: '.agents', label: 'agents', subdirs: ['skills', 'agents', 'commands'] },
  { dirName: '.codex', label: 'Codex', subdirs: ['skills'], mcpFiles: ['.codex/config.toml'], mcpFormat: 'codex' },
  { dirName: '.cursor', label: 'Cursor', subdirs: ['skills', 'agents', 'commands'], mcpFiles: ['.cursor/mcp.json'] },
  { dirName: '.kimi', label: 'Kimi', subdirs: ['skills'] },
  {
    dirName: '.zcode',
    label: 'ZCode',
    subdirs: ['skills', 'agents', 'commands'],
    mcpFiles: ['zcode.json', '.zcode/config.json'],
    mcpFormat: 'zcode',
    hookFiles: ['zcode.json', '.zcode/config.json'],
    hookFormat: 'zcode'
  },
  {
    dirName: '.qoder',
    label: 'Qoder CLI',
    subdirs: ['skills', 'agents', 'commands'],
    mcpFiles: ['.qoder/settings.json', '.qoder/settings.local.json'],
    hookFiles: ['.qoder/settings.json', '.qoder/settings.local.json']
  },
  { dirName: '.github', label: 'GitHub Copilot', subdirs: ['skills', 'agents'] }
] as const satisfies readonly ProjectLayout[]

/** Marketplace catalogs follow manifest layout order; the shared root catalog is the fallback. 中文：市场目录按 manifest 布局优先级排序，仓库根目录的通用目录作最后兜底。 */
export const MARKETPLACE_PATHS: readonly string[] = [...PLUGIN_LAYOUTS.flatMap(layout => layout.marketplaces), 'marketplace.json']
