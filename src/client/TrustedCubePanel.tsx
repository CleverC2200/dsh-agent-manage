import React, { useEffect, useRef, useState } from 'react'
import type { Translate } from './index.js'
import { userAgentApi, type UserAgentView } from './user-agent-api.js'
import type { TrustedCubeSource } from '../contracts/user-agents.js'
import css from './user-agents.module.css'

/** The personal association stores one reference; GEA retains identity and dispatch. */
export function TrustedCubePanel({ agent, t, onSaved }: { agent: UserAgentView; t: Translate; onSaved(agent: UserAgentView): void }) {
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
  const save = async (cube: UserAgentView['cube'] | null) => {
    setBusy(true); setError('')
    try { const saved = await userAgentApi.saveCube(agent.id, cube); if (mounted.current) onSaved(saved) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <section className={css.inline}>
    <h3>{t('agentCubeTitle')}</h3>
    <p className={css.muted}>{t('agentCubeScope')}</p>
    <label>{t('agentCubeSource')}<select value={sourceRef} disabled={busy} onChange={event => setSourceRef(event.target.value)}>
      <option value="">{t('agentCubeNone')}</option>
      {agent.cube && !sources.some(source => source.sourceRef === agent.cube?.sourceRef) && <option value={agent.cube.sourceRef}>{agent.cube.sourceRef} · {t('agentUnavailable')}</option>}
      {sources.map(source => <option key={source.sourceRef} value={source.sourceRef}>{source.name}{source.available ? '' : ` · ${t('agentUnavailable')}`}</option>)}
    </select></label>
    <footer className={css.actions}>
      {agent.cube && <button type="button" disabled={busy} onClick={() => void save({ ...agent.cube!, enabled: !agent.cube?.enabled })}>{t(agent.cube.enabled ? 'agentCubeDisable' : 'agentCubeEnable')}</button>}
      <button type="button" className={css.primary} disabled={busy} onClick={() => void save(sourceRef ? { sourceRef, enabled: true } : null)}>{t('save')}</button>
    </footer>
    {error && <p role="alert" className={css.error}>{error}</p>}
  </section>
}

/** Fixed plugin members remain separately controllable from Agent enablement. */
export function PluginMcpPanel({ agent, t, onSaved }: { agent: UserAgentView; t: Translate; onSaved(agent: UserAgentView): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [agent.id])
  return <section><h3>{t('agentMcp')}</h3><p className={css.muted}>{t('agentPluginMcpFixed')}</p>
    {agent.cube && <article className={css.row}><strong className={css.title}>{t('agentCubeTitle')}</strong><button type="button" role="switch" aria-label={t('agentCubeEnabled', { name: agent.name })} aria-checked={agent.cube.enabled} disabled={busy} onClick={() => { setBusy(true); void (async () => { try { await userAgentApi.setPluginCubeEnabled(agent.id, !agent.cube?.enabled); const saved = (await userAgentApi.pluginAgents()).find(row => row.id === agent.id); if (active.current && saved) onSaved(saved) } catch (failure) { if (active.current) setError(String(failure)) } finally { if (active.current) setBusy(false) } })() }}><span /></button></article>}
    {error && <p role="alert">{error}</p>}
  </section>
}

/** Trusted plugin rows open the same editor; personal copy is a separate action. */
export function TrustedPluginAgents({ t, startAgent, onCopied, onEdit }: { t: Translate; startAgent?: (preset: string) => Promise<void>; onCopied(agent: UserAgentView): void; onEdit(agent: UserAgentView): void }) {
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
    setBusy(true); setError('')
    try { await action() } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (mounted.current) setBusy(false) }
  }
  if (!sources.length && !error) return null
  return <section>
    <h3 className={css.sectionTitle}>{t('agentPluginPresets')}</h3>
    {sources.map(source => <article key={source.id} className={`${css.row} ${css.pluginRow}`}>
      <button type="button" className={css.identity} disabled={busy} onClick={() => onEdit(source)}><span><strong>{source.name}</strong><span className={css.description}>{source.pluginSource?.sourceRef} · {source.pluginSource?.version.slice(0, 12)} · {t(source.customized ? 'agentSourceCustomized' : 'agentSourceUnmodified')}{source.publication === 'failed' ? ` · ${t('agentUnavailable')}` : ''}</span></span></button>
      <button type="button" disabled={busy || !startAgent || source.publication !== 'ready'} onClick={() => void run(async () => { await startAgent?.(source.preset) })}>{t('agentStart')}</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => { const copied = await userAgentApi.copyPlugin(source.id); if (mounted.current) onCopied(copied) })}>{t('agentCopyPersonal')}</button>
      <button type="button" role="switch" aria-label={t('agentEnabled', { name: source.name })} aria-checked={source.enabled} className={source.enabled ? css.switchOn : css.switchOff} disabled={busy} onClick={() => void run(async () => { const saved = await userAgentApi.setPluginEnabled(source.id, !source.enabled); if (mounted.current) setSources(rows => rows.map(row => row.id === saved.id ? saved : row)) })}><span /></button>
    </article>)}
    {error && <p role="alert" className={css.error}>{error}</p>}
  </section>
}
