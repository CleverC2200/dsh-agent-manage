/** A suite card in the market grid/list. 中文：市场网格或列表中的单个套件卡片。 */
/** 文件作用：渲染一个市场套件卡片，展示来源、布局、能力数量、诊断信息和安装状态操作。 */
import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SuiteCardData } from '../../api.js'
import type { Translate } from '../../index.js'
import { ToggleSwitch } from '../../ui/ToggleSwitch.js'
import css from '../../market.module.css'
import { ResourceCard } from '../../ui/ResourceCard.js'
import { suiteLayoutLabel } from '../../layout-label.js'

export interface SuiteCardProps {
  t: Translate
  suite: SuiteCardData
  busy: boolean
  onOpen: () => void
  onInstall: () => void
  onAddSource: () => void
  onToggle: () => void
  onRefresh: () => void
  onUninstall: () => void
}

/** 将套件数据投影为卡片视图，并区分远端来源、已安装和未安装操作。 */
export function SuiteCard(props: SuiteCardProps): ReactNode {
  const { t, suite, busy } = props
  const tags: Array<[string, number]> = (
    [
      [t('surfaceSkills'), suite.surfaces.skills],
      [t('surfaceMcp'), suite.surfaces.mcp],
      [t('surfaceHooks'), suite.surfaces.hooks],
      [t('surfaceCommands'), suite.surfaces.commands],
      [t('surfaceAgents'), suite.surfaces.agents],
      [t('surfaceLsp'), suite.surfaces.lsp]
    ] as Array<[string, number]>
  ).filter(([, count]) => count > 0)
  const layoutLabel = suiteLayoutLabel(suite.layout, t)
  const isRemote = suite.remoteUrl !== undefined
  const hasTagRow = tags.length > 0 || suite.errors.length > 0 || (suite.mcpErrors?.length ?? 0) > 0
  /** 阻止卡片点击冒泡后执行具体按钮动作，避免打开详情覆盖操作。 */
  const stop = (callback: () => void) => (event: { stopPropagation(): void }) => {
    // 卡片本身可点击打开详情，按钮动作必须先截断冒泡。
    event.stopPropagation()
    callback()
  }
  // Installed cards carry the MCP card's left accent: green = enabled, gray = disabled.
  // 中文：已安装卡片沿用 MCP 状态色，绿色表示启用，灰色表示停用。
  return h(
    ResourceCard,
    { className: css.card, state: suite.installed && suite.enabled ? 'active' : 'disabled', onClick: props.onOpen },
    h(
      'div',
      { className: css.cardTop },
      h(
        'div',
        { className: css.cardTitle },
        h('span', { className: css.cardName }, suite.name),
        suite.version === undefined ? null : h('span', { className: css.version }, `v${suite.version}`)
      ),
      h(
        'div',
        { className: css.cardActions },
        suite.installed
          ? [
              h(
                'button',
                {
                  key: 'refresh',
                  type: 'button',
                  className: css.iconBtn,
                  title: t('refresh'),
                  disabled: busy,
                  onClick: stop(props.onRefresh)
                },
                h(
                  'svg',
                  { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
                  h('path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }),
                  h('path', { d: 'M21 3v5h-5' })
                )
              ),
              h(
                'button',
                {
                  key: 'uninstall',
                  type: 'button',
                  className: `${css.iconBtn} ${css.iconBtnDanger}`,
                  title: t('uninstall'),
                  disabled: busy,
                  onClick: stop(props.onUninstall)
                },
                h(
                  'svg',
                  { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
                  h('path', { d: 'M3 6h18' }),
                  h('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }),
                  h('path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' })
                )
              ),
              // The enable switch reads last, at the card's trailing edge.
              // 中文：启停开关固定放在操作区最右侧，保持卡片动作顺序一致。
              h(ToggleSwitch, {
                key: 'toggle',
                on: suite.enabled,
                disabled: busy,
                title: suite.enabled ? t('disable') : t('enable'),
                onChange: props.onToggle
              })
            ]
          : isRemote
            ? h(
                Button,
                {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busy,
                  title: suite.remoteUrl,
                  onClick: stop(props.onAddSource)
                },
                t('addSource')
              )
            : h(
                Button,
                {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busy,
                  onClick: stop(props.onInstall)
                },
                t('install')
              )
      )
    ),
    h('p', { className: css.desc }, suite.description ?? ''),
    h(
      'div',
      { className: css.meta },
      h('span', { className: css.src }, `${suite.sourceId} · ${isRemote ? t('remoteRef') : suite.dimension === 'user' ? t('dimensionUser') : t('dimensionProject')}`),
      h('span', { className: css.tag }, layoutLabel)
    ),
    hasTagRow
      ? h(
          'div',
          { className: css.tagRow },
          ...tags.map(([label, count]) => h('span', { key: label, className: css.tag }, `${label} ${count}`)),
          suite.errors.length === 0
            ? null
            : h(Tooltip, {
                label: suite.errors.slice(0, 8).join(t('sourceErrorSeparator')),
                children: h('span', { className: css.warnLine }, `⚠ ${t('errors')} ${suite.errors.length}`) as unknown as ReactElement
              }),
          (suite.mcpErrors?.length ?? 0) === 0
            ? null
            : h(Tooltip, {
                label: suite.mcpErrors!.slice(0, 8).join(t('sourceErrorSeparator')),
                children: h('span', { className: css.warnLine }, `⚠ ${t('mcpSection')} ${suite.mcpErrors!.length}`) as unknown as ReactElement
              })
        )
      : null
  )
}
