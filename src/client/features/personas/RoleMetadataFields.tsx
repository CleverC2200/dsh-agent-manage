/** 文件作用：为 persona/agent 提供结构化元数据编辑；把 provider、model、推理强度和工具字段写回 Markdown frontmatter。 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { Translate } from '../../index.js'
import { fetchModelCatalog } from '../../api.js'
import type { ModelCatalogPayload } from '../../../contracts/market.js'
import css from '../../ui/panel.module.css'
import { readRoleFields, updateFrontmatter, updateRoleReasoning } from './frontmatter.js'

/** Structured controls edit the same frontmatter as the raw Markdown editor. 中文：结构化控件与原始 Markdown 编辑器共同修改同一份 frontmatter。 */
/** 解析原始文档并展示结构化 persona 元数据控件；解析失败时保留文本并提示错误。 */
export function RoleMetadataFields(props: { text: string; onChange: (text: string) => void; t: Translate; disabled?: boolean }): ReactNode {
  /** 解析原始文档；解析失败时保留编辑器内容并展示可理解的错误。 */
  let fields: ReturnType<typeof readRoleFields>
  try {
    fields = readRoleFields(props.text)
  } catch (error) {
    return h('p', { className: css.editorError, role: 'alert' }, props.t('personaMetadataInvalid'), ' ', String(error instanceof Error ? error.message : error))
  }
  return h(RoleFields, { ...props, fields })
}

/** 按 provider/model 路由异步加载模型和推理档位，并把表单变化写回 frontmatter。 */
function RoleFields(props: { text: string; onChange: (text: string) => void; t: Translate; disabled?: boolean; fields: ReturnType<typeof readRoleFields> }): ReactNode {
  const { fields, t } = props
  const [providers, setProviders] = useState<ModelCatalogPayload['providers']>([])
  const [models, setModels] = useState<ModelCatalogPayload['models']>([])
  const [loading, setLoading] = useState(true)
  const [providerError, setProviderError] = useState(false)
  const [modelError, setModelError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [reasoning, setReasoning] = useState<{ route: string; value: ModelCatalogPayload['reasoning'] }>()
  const [effortError, setEffortError] = useState<string>()
  const qualified = providers.filter(entry => fields.model.startsWith(`${entry.id}/`)).sort((a, b) => b.id.length - a.id.length)[0]
  const provider = fields.provider || qualified?.id || ''
  const model = !fields.provider && qualified ? fields.model.slice(qualified.id.length + 1) : fields.model === 'inherit' ? '' : fields.model
  const route = JSON.stringify([provider, model])
  const hasRoute = provider !== '' && model !== ''
  const effortLoading = hasRoute && reasoning?.route !== route && effortError !== route
  const efforts = reasoning?.route === route ? reasoning.value?.efforts ?? [] : []

  /** 加载可选 provider 列表；revision 变化时允许用户重试目录请求。 */
  useEffect(() => {
    const controller = new AbortController()
    setProviderError(false)
    // 中文：请求仍有效时写入 provider 目录，取消请求不再更新组件状态。
    void fetchModelCatalog(undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setProviders(data.providers)
    }).catch(() => { if (!controller.signal.aborted) setProviderError(true) })
    return () => controller.abort()
  }, [revision])

  /** 按当前 provider 加载模型列表，并在请求结束后解除模型加载态。 */
  useEffect(() => {
    const controller = new AbortController()
    setModels([])
    setModelError(false)
    if (provider === '') { setLoading(false); return () => controller.abort() }
    setLoading(true)
    // 中文：只接受当前 provider 请求的模型结果，结束后解除加载态。
    void fetchModelCatalog(provider, controller.signal).then(data => {
      if (!controller.signal.aborted) setModels(data.models)
    }).catch(() => { if (!controller.signal.aborted) setModelError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [provider, revision])

  /** 按 provider/model 路由加载推理档位和模型默认值。 */
  useEffect(() => {
    const controller = new AbortController()
    setReasoning(undefined)
    setEffortError(undefined)
    if (!hasRoute) return () => controller.abort()
    // 中文：请求成功写入当前 route 的推理目录，失败则记录该 route 避免反复重试。
    void fetchModelCatalog(provider, controller.signal, model).then(data => {
      if (!controller.signal.aborted) setReasoning({ route, value: data.reasoning })
    }).catch(() => { if (!controller.signal.aborted) setEffortError(route) })
    return () => controller.abort()
  }, [provider, model, route, hasRoute, revision])

  /** 处理供应商切换并清空不再适用的模型与推理档位，写回同一份 frontmatter 草稿。 */
  const selectProvider = (value: string): void => {
    // 切换 provider 会清空旧模型和推理强度；空 provider 表示继承运行时默认值。
    const next = updateFrontmatter(props.text, 'provider', value)
    props.onChange(updateRoleReasoning(updateFrontmatter(next, 'model', value === '' ? 'inherit' : ''), ''))
  }
  return h(
    'fieldset',
    { className: css.roleFields, disabled: props.disabled },
    h('legend', null, props.t('personaRuntimeConfig')),
    h('label', { className: css.editorLabel }, t('personaProvider'),
      h('select', { className: css.editorInput, 'aria-label': t('personaProvider'), value: provider, onChange: (event: { target: HTMLSelectElement }) => selectProvider(event.target.value) },
        h('option', { value: '' }, t('personaInherit')),
        provider !== '' && !providers.some(entry => entry.id === provider) ? h('option', { value: provider }, `${provider} (${t('personaUnavailable')})`) : null,
        providers.map(entry => h('option', { key: entry.id, value: entry.id }, entry.name))
      )
    ),
    h('label', { className: css.editorLabel }, t('personaModel'),
      h('select', { className: css.editorInput, 'aria-label': t('personaModel'), value: model, disabled: provider === '' || loading, onChange: (event: { target: HTMLSelectElement }) => props.onChange(updateRoleReasoning(updateFrontmatter(updateFrontmatter(props.text, 'provider', provider), 'model', event.target.value), '')) },
        h('option', { value: '', disabled: provider !== '' }, provider === '' ? t('personaInherit') : loading ? t('loading') : t('personaSelectModel')),
        model !== '' && !models.some(entry => entry.id === model) ? h('option', { value: model }, `${model} (${t('personaUnavailable')})`) : null,
        models.map(entry => h('option', { key: entry.id, value: entry.id }, entry.name))
      )
    ),
    h('label', { className: css.editorLabel }, t('personaReasoningEffort'),
      h('select', {
        className: css.editorInput,
        'aria-label': t('personaReasoningEffort'),
        value: fields.reasoningEffort,
        disabled: effortLoading,
        onChange: (event: { target: HTMLSelectElement }) => props.onChange(updateRoleReasoning(props.text, event.target.value))
      },
        h('option', { value: '' }, effortLoading ? t('loading') : t('personaEffortAutomatic')),
        fields.reasoningEffort !== '' && !efforts.some(effort => effort.id === fields.reasoningEffort)
          ? h('option', { value: fields.reasoningEffort }, `${fields.reasoningEffort} (${t(reasoning?.route === route ? 'personaUnavailable' : 'personaEffortSaved')})`)
          : null,
        efforts.map(effort => h('option', { key: effort.id, value: effort.id, title: effort.description }, reasoning?.value?.defaultEffort === effort.id ? `${effort.name} (${t('personaEffortModelDefault')})` : effort.name))
      )
    ),
    providerError || modelError || effortError === route ? h('div', { role: 'alert', className: css.editorError }, t('personaCatalogError'), h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, t('refresh'))) : null,
    (['tools'] as const).map(key =>
      h(
        'label',
        { className: css.editorLabel, key },
        props.t('personaTools'),
        h('input', {
          className: css.editorInput,
          value: fields[key],
          onChange: (event: { target: HTMLInputElement }) => props.onChange(updateFrontmatter(props.text, key, event.target.value))
        })
      )
    ),
    h('p', { className: css.editorHint }, props.t('personaModelHint')),
    h('p', { className: css.editorHint }, props.t('personaToolsHint'))
  )
}
