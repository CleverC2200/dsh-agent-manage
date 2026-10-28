import React, { useEffect, useRef, useState } from 'react'
import type { Translate } from './index.js'
import { userAgentApi, type UserAgentView } from './user-agent-api.js'
import type { TrustedCubeSource } from '../contracts/user-agents.js'
import { agentIcon } from './ui/agent-icon.js'
import css from './user-agents.module.css'

/** Only the association is editable; GEA retains its connection and authorization. */
export function TrustedCubePanel({ agent, t, editing, onClose, onSaved }: { agent: UserAgentView; t: Translate; editing: boolean; onClose(): void; onSaved(agent: UserAgentView): void }) {
  const [sources, setSources] = useState<TrustedCubeSource[]>([])
  const [sourceRef, setSourceRef] = useState(agent.cube?.sourceRef ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    let active = true
    mounted.current = true
    void userAgentApi.cubeSources().then(rows => { if (active) setSources(rows) }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false; mounted.current = false }
  }, [])
  useEffect(() => { if (editing) setSourceRef(agent.cube?.sourceRef ?? '') }, [editing, agent.cube?.sourceRef])
  const save = async (cube: UserAgentView['cube'] | null) => {
    setBusy(true); setError('')
    try { const saved = await userAgentApi.saveCube(agent.id, cube); if (mounted.current) { onSaved(saved); if (editing) onClose() } } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <>
    {agent.cube && <article className={css.mcpRow}><div className={css.title}><strong>{t('agentCubeTitle')}</strong><span className={css.badge}>{t('agentMcpPlugin')}</span></div><span className={css.state}>{t(agent.cube.enabled ? 'agentStateEnabled' : 'agentStateDisabled')}</span><button type="button" role="switch" aria-label={t('agentCubeEnabled', { name: agent.name })} aria-checked={agent.cube.enabled} className={agent.cube.enabled ? css.switchOn : css.switchOff} disabled={busy} onClick={() => { if (agent.cube) void save({ ...agent.cube, enabled: !agent.cube.enabled }) }}><span /></button></article>}
    {editing && <form className={css.inline} onSubmit={event => { event.preventDefault(); void save(sourceRef ? { sourceRef, enabled: true } : null) }}>
      <label>{t('agentCubeSource')}<select value={sourceRef} disabled={busy} onChange={event => setSourceRef(event.target.value)}>
        <option value="">{t('agentCubeNone')}</option>
        {agent.cube && !sources.some(source => source.sourceRef === agent.cube?.sourceRef) && <option value={agent.cube.sourceRef}>{t('agentUnavailable')}</option>}
        {sources.map(source => <option key={source.sourceRef} value={source.sourceRef}>{source.name}{source.available ? '' : ` · ${t('agentUnavailable')}`}</option>)}
      </select></label>
      <footer className={css.actions}><button type="button" disabled={busy} onClick={onClose}>{t('cancel')}</button><button type="submit" className={css.primary} disabled={busy}>{t('save')}</button></footer>
    </form>}
    {error && <p role="alert" className={css.error}>{error}</p>}
  </>
}

/** Fixed plugin members remain separately controllable from Agent enablement. */
export function PluginMcpPanel({ agent, t, onSaved }: { agent: UserAgentView; t: Translate; onSaved(agent: UserAgentView): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [agent.id])
  return <section><header className={css.panelHeading}><h3>{t('agentMcpUsed')}</h3></header>
    {agent.cube && <article className={css.mcpRow}><div className={css.title}><strong>{t('agentCubeTitle')}</strong><span className={css.badge}>{t('agentMcpPlugin')}</span></div><span className={css.state}>{t(agent.cube.enabled ? 'agentStateEnabled' : 'agentStateDisabled')}</span><button type="button" role="switch" aria-label={t('agentCubeEnabled', { name: agent.name })} aria-checked={agent.cube.enabled} className={agent.cube.enabled ? css.switchOn : css.switchOff} disabled={busy} onClick={() => { setBusy(true); void (async () => { try { await userAgentApi.setPluginCubeEnabled(agent.id, !agent.cube?.enabled); const saved = (await userAgentApi.pluginAgents()).find(row => row.id === agent.id); if (active.current && saved) onSaved(saved) } catch (failure) { if (active.current) setError(String(failure)) } finally { if (active.current) setBusy(false) } })() }}><span /></button></article>}
    {error && <p role="alert">{error}</p>}
  </section>
}

/** Trusted plugin rows open the same editor; personal copy is a separate action. */
export function TrustedPluginAgents({ t, onEdit, onMessage }: { t: Translate; onEdit(agent: UserAgentView): void; onMessage(message: string): void }) {
  const [sources, setSources] = useState<UserAgentView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    let active = true
    mounted.current = true
    void userAgentApi.pluginAgents().then(rows => { if (active) setSources(rows) }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false; mounted.current = false }
  }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); onMessage('')
    try { await action() } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (mounted.current) setBusy(false) }
  }
  if (!sources.length && !error) return null
  return <section>
    <h3 className={css.sectionTitle}>{t('agentPluginPresets')}</h3>
    {sources.map(source => <article key={source.id} className={`${css.row} ${css.pluginRow}`}>
      <button type="button" className={css.identity} disabled={busy} onClick={() => onEdit(source)}><span className={css.icon}>{agentIcon}</span><span><strong>{source.name}</strong><span className={css.description}>{source.description || t('agentMcpPlugin')}{source.customized ? ` · ${t('agentSourceCustomized')}` : ''}{source.publication === 'failed' ? ` · ${t('agentUnavailable')}` : ''}</span></span></button>
      <button type="button" role="switch" aria-label={t('agentEnabled', { name: source.name })} aria-checked={source.enabled} className={source.enabled ? css.switchOn : css.switchOff} disabled={busy} onClick={() => void run(async () => { const saved = await userAgentApi.setPluginEnabled(source.id, !source.enabled); if (mounted.current) { setSources(rows => rows.map(row => row.id === saved.id ? saved : row)); if (!source.enabled && saved.enabled && saved.publication === 'ready') onMessage(t('agentPluginEnabled')) } })}><span /></button>
    </article>)}
    {error && <p role="alert" className={css.error}>{error}</p>}
  </section>
}
