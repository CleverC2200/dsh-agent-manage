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

/** Trusted plugin presets keep their declared MCP membership fixed. */
export function TrustedPluginAgents({ t, startAgent, onCopied }: { t: Translate; startAgent?: (preset: string) => Promise<void>; onCopied(agent: UserAgentView): void }) {
  const [sources, setSources] = useState<TrustedCubeSource[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    let active = true
    mounted.current = true
    void userAgentApi.cubeSources().then(rows => { if (active) setSources(rows) }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false; mounted.current = false }
  }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  if (!sources.length && !error) return null
  return <section>
    <h3 className={css.sectionTitle}>{t('agentPluginPresets')}</h3>
    {sources.map(source => <article key={source.sourceRef} className={`${css.row} ${css.pluginRow}`}>
      <div className={css.title}><strong>{source.name}</strong><p className={css.description}>{t('agentMcpPlugin')} · {source.available ? t('agentCubeTitle') : t('agentUnavailable')}</p></div>
      <button type="button" disabled={busy || !startAgent} onClick={() => void run(async () => { await startAgent?.(source.sourceRef) })}>{t('agentStart')}</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => { const copied = await userAgentApi.copyPlugin(source.sourceRef); if (mounted.current) onCopied(copied) })}>{t('agentCopyPersonal')}</button>
      <button type="button" role="switch" aria-label={t('agentCubeEnabled', { name: source.name })} aria-checked={source.enabled} className={source.enabled ? css.switchOn : css.switchOff} disabled={busy} onClick={() => void run(async () => { setSources(await userAgentApi.setPluginCubeEnabled(source.sourceRef, !source.enabled)) })}><span /></button>
    </article>)}
    {error && <p role="alert" className={css.error}>{error}</p>}
  </section>
}
