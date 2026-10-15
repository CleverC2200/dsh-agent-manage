import React, { useEffect, useState, type FormEvent } from 'react'
import type { Translate } from './index.js'
import { ServerConfigEditor } from './ui/ServerConfigEditor.js'
import { agentMcpApi } from './agent-mcp-api.js'
import type { AgentMcpView } from '../contracts/agent-mcp.js'
import css from './user-agents.module.css'

/** Association actions keep their own draft; cancelling never writes effective configuration. */
export function AgentMcpPanel({ agentId, t }: { agentId: string; t: Translate }) {
  const [rows, setRows] = useState<AgentMcpView[]>([])
  const [available, setAvailable] = useState<Array<Pick<AgentMcpView, 'connectionId' | 'serverId' | 'name'>>>([])
  const [existing, setExisting] = useState('')
  const [editing, setEditing] = useState<AgentMcpView | 'new'>()
  const [name, setName] = useState('')
  const [serverId, setServerId] = useState('')
  const [config, setConfig] = useState('')
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = async () => { const [next, candidates] = await Promise.all([agentMcpApi.list(agentId), agentMcpApi.available(agentId)]); setRows(next); setAvailable(candidates) }
  useEffect(() => {
    let active = true
    void Promise.all([agentMcpApi.list(agentId), agentMcpApi.available(agentId)]).then(([value, candidates]) => { if (active) { setRows(value); setAvailable(candidates) } }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [agentId])
  const pending = rows.some(row => row.state === 'connecting' || row.state === 'awaiting-authorization')
  useEffect(() => {
    if (!pending) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await agentMcpApi.list(agentId)
        if (active) setRows(next)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      }
      if (active) timer = setTimeout(() => void poll(), 1000)
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => { active = false; clearTimeout(timer) }
  }, [agentId, pending])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const edit = (row?: AgentMcpView) => {
    setExisting(''); setEditing(row ?? 'new'); setName(row?.name ?? ''); setServerId(row?.serverId ?? '')
    setConfig(JSON.stringify(row?.config ?? { type: 'streamable-http', url: '', auth: { enabled: true } }, null, 2)); setError('')
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      if (existing) await agentMcpApi.associate(agentId, existing)
      else await agentMcpApi.save({ agentId, ...(editing && editing !== 'new' ? { connectionId: editing.connectionId } : {}), serverId, name, config: JSON.parse(config) })
      setEditing(undefined)
    })
  }
  return <div>
    <header className={css.heading}><h3 className={css.title}>{t('agentMcpUsed')}</h3><button type="button" disabled={busy} onClick={() => void run(refresh)}>{t('refresh')}</button><button type="button" disabled={busy} onClick={() => edit()}>{t('agentMcpAdd')}</button></header>
    {rows.map(row => <article className={css.row} key={row.connectionId}>
      <div className={css.title}><strong>{row.name}</strong><p role="status" className={css.description}>{row.serverId} · {t(row.owner === 'user' ? 'agentMcpUser' : 'agentMcpPlugin')} · {t(`agentMcpState_${row.state}`)}</p>{row.reason && <p role="status" className={css.error}>{row.reason}</p>}</div>
      {row.state === 'awaiting-authorization' && <button type="button" disabled={busy} onClick={() => void run(() => agentMcpApi.cancelAuthorization(agentId, row.connectionId))}>{t('agentMcpCancelAuthorization')}</button>}
      {row.canReauthorize && row.state !== 'awaiting-authorization' && <button type="button" disabled={busy} onClick={() => void run(() => agentMcpApi.reauthorize(agentId, row.connectionId))}>{t('mcpReauthorize')}</button>}
      {row.allowedOps.includes('edit') && <button type="button" disabled={busy} onClick={() => edit(row)}>{t('panelEditTitle')}</button>}
      {row.allowedOps.includes('remove') && <button type="button" disabled={busy} onClick={() => void run(() => agentMcpApi.remove(agentId, row.connectionId))}>{t('agentMcpRemove')}</button>}
      {row.allowedOps.includes('toggle') && <button type="button" role="switch" aria-label={t('agentEnabled', { name: row.name })} aria-checked={row.enabled} disabled={busy} className={row.enabled ? css.switchOn : css.switchOff} onClick={() => void run(() => agentMcpApi.setEnabled(agentId, row.connectionId, !row.enabled))}><span /></button>}
    </article>)}
    {!rows.length && !editing && <p className={css.muted}>{t('agentMcpEmpty')}</p>}
    {editing && <form className={css.inline} onSubmit={save}>
      {editing === 'new' && available.length > 0 && <label>{t('agentMcpExisting')}<select disabled={busy} value={existing} onChange={event => setExisting(event.target.value)}><option value="">{t('agentMcpNew')}</option>{available.map(row => <option key={row.connectionId} value={row.connectionId}>{row.name} · {row.serverId}</option>)}</select></label>}
      {!existing && <>
      <label>{t('agentMcpName')}<input required maxLength={160} disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{t('agentMcpServerId')}<input required maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}" disabled={busy || editing !== 'new'} value={serverId} onChange={event => setServerId(event.target.value)} /></label>
      <ServerConfigEditor key={editing === 'new' ? 'new' : editing.connectionId} kind="mcp" text={config} onChange={setConfig} t={t} disabled={busy} onValidityChange={setValid} />
      <p className={css.muted}>{t('agentMcpCredentials')}</p>
      </>}
      <footer className={css.actions}><button type="button" disabled={busy} onClick={() => setEditing(undefined)}>{t('cancel')}</button><button type="submit" className={css.primary} disabled={busy || (!existing && !valid)}>{t('save')}</button></footer>
    </form>}
    {error && <p role="alert" className={css.error}>{error}</p>}
  </div>
}
