/**
 * Write-only credential editor for MCP `${ENV_NAME}` references.
 *
 * Read facts (configured / source / writable) come from the value-free
 * credentials wire; a typed value crosses the wire exactly once, inside
 * `credentials.set`, and never re-enters component state. Read-only
 * launch-environment credentials render guidance instead of a form that could
 * only fake success.
 *
 * 文件作用：展示 MCP 服务所需凭据的安全配置区域。
 * 业务职责：先读取无密状态，再按引用保存或删除凭据；输入值只在提交请求时发送，不回填到状态或详情响应。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeCredential, setCredential, unsetCredential, type CredentialApi, type CredentialView } from './credentials.js'
import { BusyIndicator } from './ui/panel.js'
import type { Translate } from './index.js'
import css from './mcp-credential.module.css'

/** 根据凭据引用加载状态并提供写入/删除操作，避免在浏览器保存 secret。 */
export function McpCredentialEditor(props: { t: Translate; api?: CredentialApi; refs: string[] }): ReactNode {
  const { t, api, refs } = props
  const [views, setViews] = useState<Record<string, CredentialView>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const refKey = refs.join('|')

  // 中文：引用集合变化时重新读取无密视图；卸载或切换服务后忽略迟到响应。
  useEffect(() => {
    let cancelled = false
    setViews({})
    setError(undefined)
    if (api === undefined || refs.length === 0) return () => {
      cancelled = true
    }
    void Promise.all(refs.map(async ref => [ref, await describeCredential(api, ref)] as const))
      .then(entries => {
        if (cancelled) return
        setViews(Object.fromEntries(entries.flatMap(([ref, view]) => (view === undefined ? [] : [[ref, view]]))))
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [api, refKey])

  if (refs.length === 0) return null
  /** 刷新一个引用的无密状态，供保存/删除成功后确认宿主事实。 */
  const refresh = async (ref: string): Promise<void> => {
    if (api === undefined) return
    const view = await describeCredential(api, ref)
    if (view !== undefined) setViews(current => ({ ...current, [ref]: view }))
  }
  /** 校验非空输入并保存凭据，成功后清空输入框再刷新状态。 */
  const save = async (ref: string): Promise<void> => {
    const value = drafts[ref]?.trim()
    if (api === undefined || value === undefined || value === '') return
    setBusy(ref)
    setError(undefined)
    try {
      await setCredential(api, ref, value)
      setDrafts(current => ({ ...current, [ref]: '' }))
      await refresh(ref)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }
  /** 删除一个凭据引用，并在完成后重新读取配置状态。 */
  const unset = async (ref: string): Promise<void> => {
    if (api === undefined) return
    setBusy(ref)
    setError(undefined)
    try {
      await unsetCredential(api, ref)
      await refresh(ref)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }

  return h(
    'section',
    { className: css.form },
    busy === undefined ? null : h(BusyIndicator, { overlay: true }),
    h('h4', { className: css.head }, t('mcpCredentialTitle')),
    error === undefined ? null : h('div', { className: css.error }, error),
    refs.map(ref => {
      const view = views[ref]
      const refBusy = busy === ref
      return h(
        'div',
        { key: ref, className: css.row },
        h('code', { className: css.ref }, ref),
        view === undefined
          ? h('div', { className: css.note }, api === undefined ? t('mcpCredentialUnavailable') : t('loading'))
          : h(
              'div',
              { className: css.controls },
              h(
                'div',
                { className: css.facts },
                h('span', { className: view.configured ? css.factOk : css.factMiss }, view.configured ? t('mcpCredentialConfigured') : t('mcpCredentialMissing')),
                view.source === undefined ? null : h('span', { className: css.note }, view.source)
              ),
              view.writable
                ? h(
                    'div',
                    { className: css.editor },
                    h('input', {
                      className: css.input,
                      type: 'password',
                      autoComplete: 'new-password',
                      value: drafts[ref] ?? '',
                      placeholder: t('mcpCredentialPlaceholder'),
                      disabled: refBusy,
                      onChange: event => setDrafts(current => ({ ...current, [ref]: (event.target as HTMLInputElement).value }))
                    }),
                    h(
                      'div',
                      { className: css.actions },
                      h(Button, { variant: 'primary', size: 'sm', disabled: refBusy || (drafts[ref]?.trim() ?? '') === '', onClick: () => void save(ref) }, t('mcpCredentialSave')),
                      view.configured ? h(Button, { variant: 'ghost', size: 'sm', disabled: refBusy, onClick: () => void unset(ref) }, t('mcpCredentialUnset')) : null
                    )
                  )
                : h('div', { className: css.note }, t('mcpCredentialReadOnly'))
            )
      )
    })
  )
}
