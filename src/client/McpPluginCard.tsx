/**
 * The Agent Plugins Market card on the host's 插件配置 (plugin configuration)
 * tab: the market feature's configuration entry, named after the market
 * itself. Disclosed inside is the MCP enhancement switch — ON (default)
 * mounts suite MCP servers through the market's built-in bridge (OAuth
 * authorization, SSE, browser-leg hold); OFF falls back to the host's
 * `dsh-mcp-client` compatibility client.
 *
 * The switch state is the market's host settings namespace (bound by the
 * client entry), so a flip persists through the host settings document and
 * the node half's namespace watcher remounts the servers. The host client
 * version probe rides the market's own API.
 *
 * 文件作用：渲染宿主“插件配置”页中的 Agent Plugins 配置卡片。
 * 业务职责：展示并持久化 MCP 增强模式、下载区域、项目布局扫描和反馈工具开关，同时用宿主探针解释兼容模式是否可用。
 */
import { createElement as h, useCallback, useEffect, useState, type ReactNode } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpBackendInfo } from './api.js'
import { ToggleSwitch } from './ui/ToggleSwitch.js'
import css from './plugin-settings.module.css'

/** Locale subset the card needs (structural — the host binds the real one). */
/** 中文：卡片只依赖这组翻译键，真实翻译器由宿主入口绑定。 */
type CardTranslate = (key: string, params?: Record<string, unknown>) => string

/** The host's disclosure chevron, matching the native cards' glyph exactly. */
/** 中文：使用宿主原生展开箭头，保持插件配置卡的视觉一致性。 */
const chevronIcon = (primitives as unknown as Record<string, unknown>)['IconChevronDownOutline14'] as
  | ((props: { size?: number }) => ReactNode)
  | undefined

/** The bound settings-namespace face the client entry hands the card. */
/** 中文：这是客户端入口绑定的设置命名空间，卡片不直接读写全局配置文件。 */
export interface McpEnhanceScopeFace {
  /** Whether the enhancement is on; defaults to true before the first answer. */
  /** 中文：增强桥接开关；首次读取前按默认开启展示。 */
  enhanced(): boolean
  /** Whether the host settings document accepts writes. */
  /** 中文：宿主设置是否可写，不可写时所有切换保持禁用。 */
  writable(): boolean
  subscribe(listener: () => void): () => void
  setEnhanced(next: boolean): Promise<void>
  /** The persisted download region; `auto` follows the interface language. */
  /** 中文：持久化下载区域；auto 根据宿主语言解析实际路由。 */
  region(): 'auto' | 'global' | 'china'
  setRegion(next: 'global' | 'china'): Promise<void>
  /** Whether the experience-feedback model tool is registered (default true). */
  /** 中文：反馈工具是否注册，默认开启并由宿主设置持久化。 */
  feedbackEnabled?(): boolean
  scanProjectLayouts?(): boolean
  setScanProjectLayouts?(next: boolean): Promise<void>
  /** Register/unregister the experience-feedback model tool. */
  /** 中文：负责反馈工具注册状态的读写能力。 */
  setFeedbackEnabled?(next: boolean): Promise<void>
}

export interface McpPluginCardProps {
  t: CardTranslate
  scope: McpEnhanceScopeFace
  /** Live host-client probe (availability + version) from the market API. */
  /** 中文：从市场 API 获取宿主 MCP 客户端可用性和版本。 */
  probe: () => Promise<McpBackendInfo>
}

/** 绑定宿主设置命名空间，渲染 MCP 运行模式及相关体验开关。 */
export function McpPluginCard({ t, scope, probe }: McpPluginCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  const [probeInfo, setProbeInfo] = useState<McpBackendInfo | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // 中文：宿主设置变化时递增本地版本号，触发卡片读取最新快照。
  useEffect(() => scope.subscribe(() => setTick(tick => tick + 1)), [scope])

  /** 读取宿主 MCP 客户端能力和下载区域；探针失败只隐藏版本信息。 */
  const refreshProbe = useCallback(async () => {
    try {
      setProbeInfo(await probe())
    } catch {
  // The version line degrades silently; the switch still works.
  // 中文：版本探针失败只降级版本信息，其他配置切换仍保持可用。
    }
  }, [probe])

  useEffect(() => { void refreshProbe() }, [refreshProbe])

  const enhanced = scope.enhanced()
  const writable = scope.writable()
  const regionSetting = scope.region()
  // The highlighted segment is the route clones actually take: the explicit
  // choice, or the language-resolved one while the setting is still auto.
  // 中文：高亮表示下载实际经过的路由；auto 时显示按语言解析出的有效区域。
  const effectiveRegion = regionSetting === 'auto' ? (probeInfo?.downloadRegion.effective ?? 'global') : regionSetting
  // Compat mode requires the host client to resolve; the enhanced (built-in)
  // client is always available because it ships inside this plugin.
  // 中文：兼容模式依赖宿主客户端可解析，内置增强模式随本插件发布始终可用。
  const hostUsable = probeInfo?.hostClient.available === true

  /** 切换 MCP 增强模式，兼容模式不可用时保留当前状态并提示原因。 */
  const onToggle = (): void => {
    if (busy || !writable) return
    const next = !enhanced
    if (!next && !hostUsable) {
      setError(t('mcpBackendHostMissing'))
      return
    }
    setBusy(true)
    setError(undefined)
    void scope.setEnhanced(next).then(() => {
      setBusy(false)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    })
  }

  return h(
    'div',
    {
      className: open ? `${css.pluginCard} ${css.pluginCardOpen}` : css.pluginCard,
      'data-busy': busy ? 'true' : undefined
    },
    h(
      'button',
      {
        type: 'button',
        className: css.pluginCardHeader,
        'aria-expanded': open,
        onClick: () => { setOpen(current => !current) },
      },      h(
        'div',
        { className: css.pluginCardText },
        h('div', { className: css.pluginCardTitle }, t('nav')),
        h('div', { className: css.pluginCardDesc }, t('marketCardDesc'))
      ),
      h(
        'span',
        { className: open ? `${css.pluginChevron} ${css.pluginChevronOpen}` : css.pluginChevron },
        chevronIcon !== undefined ? h(chevronIcon, { size: 14 }) : '▾'
      )
    ),
    open
      ? h(
          'div',
          { className: css.pluginCardBody },
          h(
            'div',
            { className: css.pluginCardRow },
            h(
              'div',
              { className: css.pluginCardText },
              h('div', { className: css.pluginCardRowLabel }, t('mcpCardTitle')),
              h('div', { className: css.pluginCardDesc }, enhanced ? t('mcpCardDescOn') : t('mcpCardDescOff'))
            ),
            h(ToggleSwitch, {
              on: enhanced,
              disabled: busy || !writable,
              title: writable ? undefined : t('mcpCardReadonly'),
              onChange: onToggle
            })
          ),
          error !== undefined
            ? h('div', { className: css.pluginCardError }, error)
            : null,
          h(
            'div',
            { className: css.pluginCardRow },
            h(
              'div',
              { className: css.pluginCardText },
              h('div', { className: css.pluginCardRowLabel }, t('regionLabel')),
              h('div', { className: css.pluginCardDesc }, t('regionHint'))
            ),
            h(
              'div',
              { className: css.regionSeg },
              (['global', 'china'] as const).map(region =>
                h(
                  'button',
                  {
                    key: region,
                    type: 'button',
                    disabled: busy || !writable,
                    className: effectiveRegion === region ? css.regionSegOn : css.regionSegBtn,
                    'aria-pressed': effectiveRegion === region,
                    onClick: () => {
                      if (regionSetting === region) return
                      setBusy(true)
                      setError(undefined)
                      void scope.setRegion(region).then(() => {
                        setBusy(false)
                      }).catch((cause: unknown) => {
                        setError(cause instanceof Error ? cause.message : String(cause))
                        setBusy(false)
                      })
                    }
                  },
                  region === 'global' ? t('regionGlobal') : t('regionChina')
                )
              )
            )
          ),
          scope.scanProjectLayouts !== undefined && scope.setScanProjectLayouts !== undefined
            ? h('div', { className: css.pluginCardRow },
                h('div', { className: css.pluginCardText }, h('div', { className: css.pluginCardRowLabel }, t('projectLayoutsLabel'))),
                h(ToggleSwitch, {
                  on: scope.scanProjectLayouts(),
                  title: t('projectLayoutsLabel'),
                  disabled: busy || !writable,
                  onChange: () => {
                    if (busy || !writable) return
                    setBusy(true)
                    setError(undefined)
                    void scope.setScanProjectLayouts!(!scope.scanProjectLayouts!()).catch((cause: unknown) => {
                      setError(cause instanceof Error ? cause.message : String(cause))
                    }).finally(() => setBusy(false))
                  }
                }))
            : null,
          scope.feedbackEnabled !== undefined && scope.setFeedbackEnabled !== undefined
            ? h(
                'div',
                { className: css.pluginCardRow },
                h(
                  'div',
                  { className: css.pluginCardText },
                  h('div', { className: css.pluginCardRowLabel }, t('feedbackToggleLabel')),
                  h('div', { className: css.pluginCardDesc }, scope.feedbackEnabled() ? t('feedbackToggleDescOn') : t('feedbackToggleDescOff'))
                ),
                h(ToggleSwitch, {
                  on: scope.feedbackEnabled(),
                  disabled: busy || !writable,
                  onChange: () => {
                    if (busy || !writable) return
                    setBusy(true)
                    setError(undefined)
                    void scope.setFeedbackEnabled!(!scope.feedbackEnabled!()).then(() => {
                      setBusy(false)
                    }).catch((cause: unknown) => {
                      setError(cause instanceof Error ? cause.message : String(cause))
                      setBusy(false)
                    })
                  }
                })
              )
            : null
        )
      : null
  )
}
