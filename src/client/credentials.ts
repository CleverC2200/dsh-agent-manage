/**
 * 文件作用：定义浏览器端凭据面板使用的最小接口，并适配宿主凭据服务。
 * 业务职责：只传递“是否已配置、来源、是否可写”等无密值视图；密文本身仅在保存时单向发送，不进入 React 状态。
 */
import { withBusyOperation } from './ui/busy-operation.js'
/** Browser-safe structural subset of the Host credentials wire. */
/** 中文：浏览器只保留无密状态字段，不暴露宿主凭据完整接口。 */

export interface CredentialView {
  configured: boolean
  source?: string
  writable: boolean
}

export interface CredentialApi {
  describe(payload: { refs: string[] }): Promise<unknown>
  set(payload: { ref: string; value: string }): Promise<unknown>
  unset(payload: { ref: string }): Promise<unknown>
}

interface CredentialDescribeResponse {
  result?: {
    ok?: boolean
    value?: { credentials?: Record<string, CredentialView> }
    error?: { message?: string }
  }
}

interface CredentialMutationResponse {
  result?: { ok?: boolean; error?: { message?: string } }
}

/** Read one value-free credential view; secret values never enter the browser state. */
/** 读取单个凭据引用的无密状态，避免把 secret 带入浏览器状态。 */
export async function describeCredential(api: CredentialApi | undefined, ref: string): Promise<CredentialView | undefined> {
  if (api === undefined) return undefined
  const response = (await api.describe({ refs: [ref] })) as CredentialDescribeResponse
  if (response.result?.ok !== true) throw new Error(response.result?.error?.message ?? 'credential lookup failed')
  return response.result.value?.credentials?.[ref]
}

/** 保存凭据值；请求完成后组件只刷新无密状态。 */
export async function setCredential(api: CredentialApi, ref: string, value: string): Promise<void> {
  return withBusyOperation(async () => {
    const response = (await api.set({ ref, value })) as CredentialMutationResponse
    if (response.result?.ok !== true) throw new Error(response.result?.error?.message ?? 'credential save failed')
  })
}

/** 删除凭据值并保留宿主返回的配置状态作为后续事实来源。 */
export async function unsetCredential(api: CredentialApi, ref: string): Promise<void> {
  return withBusyOperation(async () => {
    const response = (await api.unset({ ref })) as CredentialMutationResponse
    if (response.result?.ok !== true) throw new Error(response.result?.error?.message ?? 'credential removal failed')
  })
}

/** Current Host remote service; methods return unwrapped RPC results. */
/** 中文：宿主当前凭据远端服务，方法返回已解包的 RPC 结果。 */
export interface CredentialRemote {
  describe(refs: string[]): Promise<{ ok: boolean; value?: Record<string, CredentialView>; error?: { message?: string } }>
  set(ref: string, value: string): Promise<unknown>
  unset(ref: string): Promise<unknown>
}

/** Adapt the current Host service to the credential editor's wire contract. */
/** 把宿主当前的直接方法适配成凭据编辑器使用的 result 包装协议。 */
export function credentialApi(remote: CredentialRemote): CredentialApi {
  return {
    describe: async ({ refs }) => {
      const result = await remote.describe(refs)
      return { result: result.ok ? { ok: true, value: { credentials: result.value } } : result }
    },
    set: async ({ ref, value }) => ({ result: await remote.set(ref, value) }),
    unset: async ({ ref }) => ({ result: await remote.unset(ref) })
  }
}
