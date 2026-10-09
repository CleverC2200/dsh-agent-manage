/** Source editor modal for adding or editing a catalog source. 中文：新增或编辑市场目录数据源。 */
/** 文件作用：新增或编辑市场数据源；维护 git、压缩包和本地目录三种采集方式的表单草稿。 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SourceOverview } from '../../api.js'
import type { SourceProgressState } from './market-resource.js'
import type { Translate } from '../../index.js'
import css from '../../market.module.css'

export type EditorState = { mode: 'edit'; source: SourceOverview } | { mode: 'add' } | undefined

/** Which acquisition path the editor configures. 中文：表单选择当前数据源的采集路径。 */
/** 中文：表单支持 git、压缩包 URL 和本地目录三种数据源采集方式。 */
export type SourceEditorKind = 'git' | 'archive' | 'local'

export interface SourceEditorModalProps {
  t: Translate
  editor: Exclude<EditorState, undefined>
  busy: boolean
  progress: SourceProgressState
  onClose: () => void
  onSave: (input: { url: string; branch: string; kind: SourceEditorKind; sha256: string }) => Promise<boolean>
  onRemove: (id: string) => void
}

/** 展示数据源编辑表单，并将本地草稿归一化后交给保存回调。 */
export function SourceEditorModal(props: SourceEditorModalProps): ReactNode {
  const { t, editor } = props
  const [kind, setKind] = useState<SourceEditorKind>(editor.mode === 'edit' ? (editor.source.kind === 'archive' ? 'archive' : editor.source.local === true ? 'local' : 'git') : 'git')
  const [url, setUrl] = useState(editor.mode === 'edit' ? editor.source.url : '')
  const [branch, setBranch] = useState(editor.mode === 'edit' ? (editor.source.branch ?? '') : '')
  const [sha256, setSha256] = useState('')
  const id = editor.mode === 'edit' ? editor.source.id : ''
  const title = editor.mode === 'edit' ? t('editSourceTitle') : t('addSourceTitle')
  const urlPlaceholder = kind === 'local' ? t('sourceUrlLocalPh') : kind === 'archive' ? t('sourceUrlArchivePh') : t('sourceUrlPh')
  const urlHint = kind === 'local' ? t('urlLocalHint') : kind === 'archive' ? t('urlArchiveHint') : t('urlGitHint')
  /** 渲染采集方式切换按钮，只更新本地 kind 草稿，不立即请求服务端。 */
  const segment = (value: SourceEditorKind, label: string): ReactNode =>
    // 切换采集类型只更新本地表单状态，保存时才把完整输入交给父级。
    h(
      'button',
      {
        type: 'button',
        className: kind === value ? css.segOn : css.seg,
        onClick: () => setKind(value)
      },
      label
    )
  return h(Modal, {
    open: true,
    onClose: props.onClose,
    title,
    description: t('editorHint'),
    closeLabel: t('cancel'),
    className: css.editorDialog,
    footer: h(
      'div',
      { className: css.modalFooter },
      h('div', { className: css.modalFooterLeft }, editor.mode === 'edit' ? h(Button, { variant: 'ghost', onClick: () => props.onRemove(id) }, `🗑 ${t('remove')}`) : null),
      h(Button, { variant: 'ghost', onClick: props.onClose }, t('cancel')),
      h(
        Button,
        {
          variant: 'primary',
          disabled: props.busy,
          onClick: () => {
            // 中文：保存前去除首尾空白，把完整表单输入交给父级校验和请求。
            void props.onSave({ url: url.trim(), branch: branch.trim(), kind, sha256: sha256.trim() })
          }
        },
        t('save')
      )
    ),
    children: h(
      'div',
      { className: css.editorForm },
      h(
        'div',
        { className: css.modeRow },
        segment('git', t('sourceModeGit')),
        segment('archive', t('sourceModeArchive')),
        segment('local', t('sourceModeLocal'))
      ),
      editor.mode === 'edit'
        ? h(
            'div',
            { className: css.fieldGroup },
            h('label', { className: css.fieldLabel }, t('sourceIdPh')),
            h('div', { className: css.staticId }, h('span', { className: css.staticIdValue }, id), h('span', { className: css.fieldHint }, t('idFixed')))
          )
        : null,
      h(
        'div',
        { className: css.fieldGroup },
        h('label', { className: css.fieldLabel }, urlPlaceholder),
        h(Input, { placeholder: urlPlaceholder, value: url, onChange: event => setUrl((event.target as HTMLInputElement).value) }),
        h('span', { className: css.fieldHint }, urlHint)
      ),
      kind === 'git'
        ? h(
            'div',
            { className: css.fieldGroup },
            h('label', { className: css.fieldLabel }, t('branchPh')),
            h(Input, { placeholder: t('branchPh'), value: branch, onChange: event => setBranch((event.target as HTMLInputElement).value) }),
            h('span', { className: css.fieldHint }, t('branchHint'))
          )
        : null,
      kind === 'archive'
        ? h(
            'div',
            { className: css.fieldGroup },
            h('label', { className: css.fieldLabel }, t('sha256Ph')),
            h(Input, { placeholder: t('sha256Ph'), value: sha256, onChange: event => setSha256((event.target as HTMLInputElement).value) }),
            h('span', { className: css.fieldHint }, t('sha256Hint'))
          )
        : null,
      props.progress.error === undefined && props.progress.step === undefined
        ? null
        : h(
            'div',
            {
              className: props.progress.error === undefined ? css.progress : css.progressError
            },
            props.progress.error === undefined ? h('span', { className: css.progressSpin }) : h('span', { className: css.progressFail }, '✕'),
            h('span', { className: css.progressText }, props.progress.error === undefined ? props.progress.step : `${t('actionFail')}: ${props.progress.error}`)
          )
    )
  })
}
