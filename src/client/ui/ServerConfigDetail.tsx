/** 文件作用：加载完整 MCP/LSP 配置并承载编辑、校验、保存状态；状态列表只提供摘要，详情页负责真实配置。 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { fetchServerConfig, saveServerConfig } from '../api.js'
import type { Translate } from '../index.js'
import { ServerConfigEditor } from './ServerConfigEditor.js'
import { parseServerConfig, type ServerKind } from './server-form.js'
import css from './detail.module.css'
import { DetailFooterAction } from './DetailModal.js'

/** Loads complete configuration rather than editing the abbreviated status projection. */
/** 中文：详情页读取完整配置，不直接修改状态列表中的摘要投影。 */
export function ServerConfigDetail({
  kind,
  id,
  t,
  onSaved,
  onDirtyChange
}: {
  kind: ServerKind
  id: string
  t: Translate
  onSaved?: () => void
  onDirtyChange?: (dirty: boolean) => void
}): ReactNode {
  /** 按服务器类型和 id 加载配置，管理脏状态、保存校验和详情页 footer 动作。 */
  const [text, setText] = useState<string>()
  const [editable, setEditable] = useState(false)
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  /** 将当前脏状态通知详情弹窗，使关闭或切换时能提醒用户未保存修改。 */
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  /** 按 kind/id 拉取完整配置；请求失效后忽略旧响应，避免覆盖当前详情。 */
  useEffect(() => {
    let active = true
    setLoading(true)
    setText(undefined)
    setError(undefined)
    setDirty(false)
    void fetchServerConfig(kind, id)
      .then(result => {
        // 中文：只把仍属于当前详情实例的响应写入编辑器状态。
        if (!active) return
        setEditable(result.editable)
        setText(result.config === undefined ? undefined : JSON.stringify(result.config, null, 2))
      })
      .catch(reason => {
        // 中文：请求失败时显示错误，但不清除用户已有的有效上下文。
        if (active) setError(String(reason))
      })
      .finally(() => {
        // 中文：当前请求结束后解除加载态，已卸载的详情不再更新状态。
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [kind, id])
  /** 解析并保存当前配置草稿，成功后清除脏状态并通知父级刷新权威数据。 */
  const save = async (): Promise<void> => {
    /** 解析当前 JSON 并提交配置；成功后清除脏标记并通知父级刷新。 */
    setBusy(true)
    setError(undefined)
    try {
      await saveServerConfig(kind, id, parseServerConfig(text ?? ''))
      setDirty(false)
      onSaved?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  return h(
    'section',
    null,
    error ? h('p', { role: 'alert', className: css.error }, error) : null,
    loading
      ? h('p', { role: 'status' }, t('loading'))
      : text === undefined
        ? null
        : h(ServerConfigEditor, {
            kind,
            text,
            t,
            disabled: busy || !editable,
            onValidityChange: setValid,
            onChange: value => {
              // 中文：编辑器每次输出新文本都标记为脏，保存按钮据此启用。
              setText(value)
              setDirty(true)
            }
          }),
    loading || (error && text === undefined)
      ? null
      : editable
        ? h(DetailFooterAction, {
            children: h(
              Button,
              {
                variant: 'primary',
                disabled: busy || !valid || !dirty,
                onClick: () => {
                  // 中文：由保存函数统一解析、提交并处理成功/失败状态。
                  void save()
                }
              },
              busy ? t('loading') : t('save')
            )
          })
        : h('p', null, t('serverConfigReadOnly'))
  )
}
