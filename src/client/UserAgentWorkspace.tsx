import React, { useEffect, useState, type FormEvent } from 'react'
import { IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './index.js'
import { userAgentApi, type SaveUserAgent, type UserAgentView } from './user-agent-api.js'
import { AgentSources } from './AgentSources.js'
import { AgentSkills } from './AgentSkills.js'
import { TrustedPluginAgents, PluginMcpPanel } from './TrustedCubePanel.js'
import { AgentRecovery } from './AgentRecovery.js'
import { AgentMcpPanel } from './AgentMcpPanel.js'
import { agentIcon } from './ui/agent-icon.js'
import css from './user-agents.module.css'

export interface UserAgentWorkspaceProps {
  t: Translate
  startAgent?: (preset: string) => Promise<void>
  surface?: 'main' | 'settings'
}

const blank = (): SaveUserAgent => ({ name: '', description: '', prompt: '', enabled: true })
type Tab = 'prompt' | 'skill' | 'mcp'

/** One shared list/editor for the public main and settings seats. */
export function UserAgentWorkspace({ t, startAgent, surface = 'main' }: UserAgentWorkspaceProps) {
  const [showSources, setShowSources] = useState(false)
  const [sourceRequest, setSourceRequest] = useState<{ id: string; request: number }>()
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
      const agent = await (selected?.origin === 'plugin' ? userAgentApi.savePlugin(selected.id, draft.prompt) : userAgentApi.save(draft))
      setSelected(agent); setDraft(agent); setAdding(false)
      await refresh()
      setMessage(t(agent.publication === 'failed' ? 'agentSavedUnavailable' : 'agentSaved'))
    })
  }
  const toggle = (agent: UserAgentView) => void run(async () => {
    const result = await (agent.origin === 'plugin' ? userAgentApi.setPluginEnabled(agent.id, !agent.enabled) : userAgentApi.setEnabled(agent.id, !agent.enabled))
    if (selected?.id === agent.id) { setSelected(result); setDraft(value => ({ ...value, enabled: result.enabled })) }
    await refresh()
  })
  const start = (agent: UserAgentView) => void run(async () => {
    if (!startAgent) throw Error(t('agentHostUnavailable'))
    const { preset } = agent.origin === 'plugin' ? agent : await userAgentApi.select(agent.id)
    await startAgent(preset)
  })
  const leaveEditor = () => { setSelected(undefined); setDraft(blank()); setError(''); setMessage('') }
  const fields = <>
    <label>{t('agentName')}<input autoFocus={adding} disabled={busy || selected?.origin === 'plugin'} required maxLength={160} value={draft.name} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
    <label>{t('agentDescription')}<input disabled={busy || selected?.origin === 'plugin'} maxLength={1000} value={draft.description} onChange={event => setDraft(value => ({ ...value, description: event.target.value }))} /></label>
    <label>{t('agentPrompt')}<textarea disabled={busy} required rows={adding ? 6 : 12} maxLength={48000} value={draft.prompt} onChange={event => setDraft(value => ({ ...value, prompt: event.target.value }))} /></label>
  </>
  const enable = (agent: UserAgentView) => <button type="button" role="switch" aria-label={t('agentEnabled', { name: agent.name })} aria-checked={agent.enabled} className={agent.enabled ? css.switchOn : css.switchOff} disabled={busy} onClick={() => toggle(agent)}><span /></button>
  return <section className={`${css.workspace} ${surface === 'settings' ? css.settingsWorkspace : ''}`}>
    {selected ? <>
      <button type="button" className={css.back} disabled={busy} onClick={leaveEditor}>{t('agentBack')}</button>
      <header className={css.heading}><div className={css.icon}>{agentIcon}</div><div className={css.title}><h2>{selected.name}</h2><p>{selected.description || t(selected.origin === 'plugin' ? 'agentMcpPlugin' : 'agentPersonal')}</p></div><details className={css.menu}><summary aria-label={t('agentMore')}>⋯</summary><div className={css.menuItems}><button type="button" disabled={busy || selected.publication !== 'ready'} onClick={() => start(selected)}>{t('agentStart')}</button>{selected.origin === 'plugin' && <button type="button" disabled={busy} onClick={() => void run(async () => { const copied = await userAgentApi.copyPlugin(selected.id); await refresh(); edit(copied) })}>{t('agentCopyPersonal')}</button>}{selected.origin === 'user' && <AgentRecovery key={selected.id} agent={selected} t={t} onChanged={agent => { setSelected(agent); setDraft(agent); setAgents(rows => rows.map(row => row.id === agent.id ? agent : row)) }} onChooseAnother={leaveEditor} />}</div></details>{!selected.deletedAt && enable(selected)}</header>
      {selected.error && <p role="alert" className={css.error}>{selected.error === 'AGENT_SOURCE_IMPORT_INCOMPLETE' ? t('agentSourceIncomplete') : selected.error}</p>}

      {!selected.deletedAt && <><nav className={css.tabs} aria-label={t('agentConfiguration')}>
        {(['prompt', 'skill', 'mcp'] as const).map(value => <button type="button" key={value} disabled={busy} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{t(value === 'prompt' ? 'agentPrompt' : value === 'skill' ? 'agentSkill' : 'agentMcp')}</button>)}
      </nav>
      {tab === 'prompt' ? <form onSubmit={save}>{fields}<footer className={css.actions}><button type="button" disabled={busy} onClick={leaveEditor}>{t('cancel')}</button><button className={css.primary} disabled={busy} type="submit">{t('save')}</button></footer></form> : tab === 'skill' ? <AgentSkills key={selected.id} agent={selected} t={t} onSaved={agent => { setSelected(agent); setAgents(rows => rows.map(row => row.id === agent.id ? agent : row)) }} /> : selected.origin === 'plugin' ? <PluginMcpPanel key={selected.id} agent={selected} t={t} onSaved={agent => setSelected(agent)} /> : <AgentMcpPanel key={selected.id} agent={selected} t={t} onSaved={agent => { setSelected(agent); setAgents(rows => rows.map(row => row.id === agent.id ? agent : row)) }} />}</>}
    </> : <>
      <header className={css.heading}><div className={css.title}><h2>{t('agentConfiguration')}</h2></div><button type="button" disabled={busy} aria-label={t('refresh')} className={css.iconButton} title={t('refresh')} aria-busy={busy} onClick={() => void run(refresh)}><IconRefreshOutlineRegular size={18} /></button><button type="button" aria-expanded={showSources} onClick={() => { setSourceRequest(undefined); setAdding(false); setShowSources(value => !value) }}>{t('agentSources')}</button><button className={css.primary} type="button" disabled={busy} onClick={() => { setDraft(blank()); setAdding(true); setShowSources(false); setSourceRequest(undefined); setMessage('') }}>{t('agentAdd')}</button></header>
      {adding && <form className={css.inline} onSubmit={save}>{fields}<footer className={css.actions}><button type="button" disabled={busy} onClick={() => setAdding(false)}>{t('cancel')}</button><button className={css.primary} type="submit" disabled={busy}>{t('save')}</button></footer></form>}
      {showSources && <AgentSources key={sourceRequest?.request ?? 0} t={t} agents={agents} initialSyncId={sourceRequest?.id} onImported={refresh} onClose={() => { setShowSources(false); setSourceRequest(undefined) }} />}
      <p className={css.sectionTitle}>{t('agentCurrent')} <span>{agents.filter(agent => !agent.deletedAt).length}</span></p>
      {agents.map(agent => <article className={css.row} key={agent.id}>
        <button className={css.identity} type="button" disabled={busy} onClick={() => edit(agent)}><span className={css.icon}>{agentIcon}</span><span><strong>{agent.name}</strong><span className={css.description}>{agent.description || t('agentPersonal')}{agent.customized ? ` · ${t('agentSourceCustomized')}` : ''}{agent.publication === 'deleted' ? ` · ${t('agentDeleted')}` : agent.publication === 'failed' ? ` · ${t('agentUnavailable')}` : ''}</span></span></button>
        {agent.source && !agent.deletedAt && !agent.source.importPending && <button type="button" className={css.textButton} aria-label={t('agentSourceSync')} disabled={busy} onClick={() => { setShowSources(true); setSourceRequest(previous => ({ id: agent.id, request: (previous?.request ?? 0) + 1 })) }}>{t('agentUpdate')}</button>}
        {!agent.deletedAt && enable(agent)}
      </article>)}
      <TrustedPluginAgents onEdit={edit} t={t} />
      {!agents.length && !adding && <p className={css.muted}>{t('agentEmpty')}</p>}
    </>}
    {error && <p role="alert" className={css.error}>{error}</p>}{message && <p role="status" className={css.muted}>{message}</p>}
  </section>
}
