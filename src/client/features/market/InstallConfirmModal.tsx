/** Pre-install confirmation modal: concise surface counts plus a risk notice. 中文：安装前集中展示能力数量与可执行风险。 */
/** 文件作用：安装前确认弹窗；把套件来源、版本、能力数量和可执行风险汇总给用户确认。 */
import { createElement as h, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SuiteCardData } from '../../api.js'
import type { Translate } from '../../index.js'
import css from '../../market.module.css'

export interface InstallConfirmState {
  suite: SuiteCardData
  /** Locked source commit shown in the confirm dialog; undefined for local sources. */
  /** 中文：远端数据源显示锁定提交号，本地数据源没有不可变提交号。 */
  lockCommit?: string
  /** True when the source is a local working tree (no immutable commit). */
  /** 中文：标记当前来源是否为本地工作树。 */
  localSource?: boolean
}

export interface InstallConfirmModalProps {
  t: Translate
  state: InstallConfirmState
  busy: boolean
  onClose: () => void
  onConfirm: () => Promise<boolean>
}

/** Surface count tags shown on the card; keys mirror SuiteCard's tag list. */
/** 中文：能力标签键与 SuiteCard 保持一致，用于显示非零能力数量。 */
const SURFACE_TAGS: Array<{ key: 'skills' | 'mcp' | 'hooks' | 'commands' | 'agents' | 'lsp'; labelKey: 'surfaceSkills' | 'surfaceMcp' | 'surfaceHooks' | 'surfaceCommands' | 'surfaceAgents' | 'surfaceLsp' }> = [
  { key: 'skills', labelKey: 'surfaceSkills' },
  { key: 'mcp', labelKey: 'surfaceMcp' },
  { key: 'hooks', labelKey: 'surfaceHooks' },
  { key: 'commands', labelKey: 'surfaceCommands' },
  { key: 'agents', labelKey: 'surfaceAgents' },
  { key: 'lsp', labelKey: 'surfaceLsp' }
]

/** 根据套件安装状态展示确认信息，并把确认/取消动作回传给市场页。 */
export function InstallConfirmModal(props: InstallConfirmModalProps): ReactNode {
  const { t, state, busy } = props
  const surfaces = state.suite.surfaces
  const tags = SURFACE_TAGS.filter(tag => surfaces[tag.key] > 0)
  const executable = surfaces.mcp > 0 || surfaces.hooks > 0

  return h(Modal, {
    open: true,
    onClose: props.onClose,
    title: t('installConfirmTitle'),
    description: t('installConfirmDesc'),
    closeLabel: t('cancel'),
    className: css.editorDialog,
    footer: h(
      'div',
      { className: css.modalFooter },
      h(Button, { variant: 'ghost', disabled: busy, onClick: props.onClose }, t('cancel')),
      h(
        Button,
        {
          variant: 'primary',
          disabled: busy,
          onClick: () => {
            // 中文：确认按钮只触发父级异步安装，具体忙碌和关闭状态由父级控制。
            void props.onConfirm()
          }
        },
        t('installConfirmAction')
      )
    ),
    children: h(
      'div',
      { className: css.installConfirmBody },
      h('div', { className: css.installConfirmSuite }, `${state.suite.sourceId} / ${state.suite.name}`),
      state.suite.version === undefined ? null : h('div', { className: css.installConfirmMeta }, `${t('version')}: v${state.suite.version}`),
      state.lockCommit === undefined
        ? null
        : h('div', { className: css.installConfirmCommit }, `${t('installConfirmSource')}: ${state.lockCommit.slice(0, 12)}`),
      state.lockCommit === undefined && state.localSource === true
        ? h('div', { className: css.installConfirmCommit }, `${t('installConfirmSource')}: ${t('installConfirmLocalTree')}`)
        : null,
      tags.length === 0
        ? h('div', { className: css.installConfirmMeta }, t('installConfirmNoSurfaces'))
        : h(
            'div',
            { className: css.installConfirmTags },
            tags.map(tag => h('span', { key: tag.key, className: css.tag }, `${t(tag.labelKey)} ${surfaces[tag.key]}`))
          ),
      executable ? h('div', { className: css.installConfirmWarn }, t('installConfirmExecutable')) : null
    )
  })
}
