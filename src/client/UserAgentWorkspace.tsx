import React, { useEffect, useState, type FormEvent } from 'react'
import type { Translate } from './index.js'
import { userAgentApi, type SaveUserAgent, type UserAgentView } from './user-agent-api.js'
import { AgentSkills } from './AgentSkills.js'
import { TrustedCubePanel, TrustedPluginAgents } from './TrustedCubePanel.js'
import { AgentMcpPanel } from './AgentMcpPanel.js'
import css from './user-agents.module.css'

export interface UserAgentWorkspaceProps {
  t: Translate
  startAgent?: (preset: string) => Promise<void>
}
const agentIcon = <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="9" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v3h12V9M12 12v3"/></svg>
const blank = (): SaveUserAgent => ({ name: '', description: '', prompt: '', enabled: true })
type Tab = 'prompt' | 'skill' | 'mcp'

/** One shared list/editor for the public main and settings seats. */
export function UserAgentWorkspace({ t, startAgent }: UserAgentWorkspaceProps) {
  const [agents, setAgents] = useState<UserAgentView[]>([])
  const [selected, setSelected] = useState<UserAgentView>()
  const [draft, setDraft] = useState<SaveUserAgent>(blank)
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState<Tab>('prompt')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void userAgentApi.list().then(rows => { if (!controller.signal.aborted) setAgents(rows) })
      .catch(error => { if (!controller.signal.aborted) setError(String(error)) })
    return () => controller.abort()
  }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const refresh = async () => setAgents(await userAgentApi.list())
  const edit = (agent: UserAgentView) => {
    setSelected(agent); setDraft({ id: agent.id, name: agent.name, description: agent.description, prompt: agent.prompt, enabled: agent.enabled })
    setAdding(false); setTab('prompt'); setError(''); setMessage('')
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const agent = await userAgentApi.save(draft)
      setSelected(agent); setDraft(agent); setAdding(false)
      await refresh()
      setMessage(t(agent.publication === 'failed' ? 'agentSavedUnavailable' : 'agentSaved'))
    })
  }
  const toggle = (agent: UserAgentView) => void run(async () => {
    const result = await userAgentApi.setEnabled(agent.id, !agent.enabled)
    if (selected?.id === agent.id) { setSelected(result); setDraft(value => ({ ...value, enabled: result.enabled })) }
    await refresh()
  })
  const start = (agent: UserAgentView) => void run(async () => {
    if (!startAgent) throw Error(t('agentHostUnavailable'))
    const { preset } = await userAgentApi.select(agent.id)
    await startAgent(preset)
  })
  const fields = <>
    <label>{t('agentName')}<input disabled={busy} required maxLength={160} value={draft.name} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
    <label>{t('agentDescription')}<input disabled={busy} maxLength={1000} value={draft.description} onChange={event => setDraft(value => ({ ...value, description: event.target.value }))} /></label>
    <label>{t('agentPrompt')}<textarea disabled={busy} required rows={12} maxLength={48000} value={draft.prompt} onChange={event => setDraft(value => ({ ...value, prompt: event.target.value }))} /></label>
  </>
  const enable = (agent: UserAgentView) => <button type="button" role="switch" aria-label={t('agentEnabled', { name: agent.name })} aria-checked={agent.enabled} className={agent.enabled ? css.switchOn : css.switchOff} disabled={busy} onClick={() => toggle(agent)}><span /></button>
  return <section className={css.workspace}>
    {selected ? <>
      <button type="button" className={css.back} disabled={busy} onClick={() => { setSelected(undefined); setError(''); setMessage('') }}>{t('agentBack')}</button>
      <header className={css.heading}><div className={css.icon}>{agentIcon}</div><div className={css.title}><h2>{selected.name}</h2><p>{t('agentPersonal')}</p></div>{enable(selected)}</header>
      <nav className={css.tabs} aria-label={t('agentConfiguration')}>
        {(['prompt', 'skill', 'mcp'] as const).map(value => <button type="button" key={value} disabled={busy} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{t(value === 'prompt' ? 'agentPrompt' : value === 'skill' ? 'agentSkill' : 'agentMcp')}</button>)}
      </nav>
      {selected.error && <p role="alert" className={css.error}>{selected.error}</p>}
      {tab === 'prompt' ? <form onSubmit={save}>{fields}<footer className={css.actions}><button type="button" disabled={busy} onClick={() => edit(selected)}>{t('cancel')}</button><button className={css.primary} disabled={busy} type="submit">{t('save')}</button></footer></form> : tab === 'skill' ? <AgentSkills key={selected.id} agent={selected} t={t} onSaved={agent => { setSelected(agent); setAgents(rows => rows.map(row => row.id === agent.id ? agent : row)) }} /> : <><TrustedCubePanel key={`${selected.id}-cube`} agent={selected} t={t} onSaved={agent => { setSelected(agent); setAgents(rows => rows.map(row => row.id === agent.id ? agent : row)) }} /><AgentMcpPanel key={selected.id} agentId={selected.id} t={t} /></>}
    </> : <>
      <header className={css.heading}><div className={css.title}><h2>{t('agentConfiguration')}</h2></div><button type="button" disabled={busy} aria-label={t('refresh')} onClick={() => void run(refresh)}>↻</button><button className={css.primary} type="button" disabled={busy} onClick={() => { setDraft(blank()); setAdding(true); setMessage('') }}>{t('agentAdd')}</button></header>
      <p className={css.sectionTitle}>{t('agentCurrent')} <span>{agents.length}</span></p>
      {agents.map(agent => <article className={css.row} key={agent.id}>
        <button className={css.identity} type="button" disabled={busy} onClick={() => edit(agent)}><span className={css.icon}>{agentIcon}</span><span><strong>{agent.name}</strong><span className={css.description}>{agent.description || t('agentPersonal')}{agent.publication === 'failed' ? ` · ${t('agentUnavailable')}` : ''}</span></span></button>
        <button type="button" disabled={busy || agent.publication !== 'ready'} onClick={() => start(agent)}>{t('agentStart')}</button>{enable(agent)}
      </article>)}
      <TrustedPluginAgents t={t} startAgent={startAgent} onCopied={agent => { setAgents(rows => [...rows, agent]); edit(agent) }} />
      {!agents.length && !adding && <p className={css.muted}>{t('agentEmpty')}</p>}
      {adding && <form className={css.inline} onSubmit={save}>{fields}<footer className={css.actions}><button type="button" disabled={busy} onClick={() => setAdding(false)}>{t('cancel')}</button><button className={css.primary} type="submit" disabled={busy}>{t('save')}</button></footer></form>}
    </>}
    {error && <p role="alert" className={css.error}>{error}</p>}{message && <p role="status" className={css.muted}>{message}</p>}
  </section>
}
