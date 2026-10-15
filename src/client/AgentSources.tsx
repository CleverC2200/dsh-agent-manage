import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AgentSourceView, AcquireAgentSource, AgentSourcePreview, AgentSourceResolution } from '../contracts/agent-sources.js'
import type { UserAgentView } from '../contracts/user-agents.js'
import type { Translate } from './index.js'
import { agentSourceApi } from './agent-source-api.js'
import css from './user-agents.module.css'

/** Config sources share Catalog acquisition without installing executable plugins. */
export function AgentSources({ t, onImported, onClose, agents = [], initialSyncId }: { t: Translate; onImported: () => Promise<void>; onClose: () => void; agents?: UserAgentView[]; initialSyncId?: string }) {
  const explain = (failure: string) => {
    if (['AGENT_SOURCE_PREVIEW_STALE', 'AGENT_SOURCE_PREVIEW_EXPIRED'].includes(failure)) return t('agentSourcePreviewStale')
    if (failure.startsWith('AGENT_SOURCE_CONFLICT_UNRESOLVED')) return t('agentSourceResolveAll')
    if (failure === 'AGENT_SOURCE_IMPORT_INCOMPLETE') return t('agentSourceIncomplete')
    if (failure === 'AGENT_SOURCE_SKILLS_DISABLED') return t('agentSourceSkillDisabled')
    if (failure === 'AGENT_SOURCE_UNSUPPORTED_COMPONENTS') return t('agentSourceUnsupported')
    if (failure === 'AGENT_SOURCE_ROLE_RESTRICTIONS_REQUIRE_MANUAL_CONFIGURATION') return t('agentSourceRoleRestricted')
    if (failure === 'AGENT_SOURCE_REMOTE_REQUIRES_OWN_SOURCE') return t('agentSourceRemote')
    return failure
  }
  const operation = useRef<AbortController>()
  const [preview, setPreview] = useState<AgentSourcePreview>()
  const [resolutions, setResolutions] = useState<Record<string, AgentSourceResolution>>({})
  const [manual, setManual] = useState<Record<string, string>>({})
  useEffect(() => () => operation.current?.abort(), [])
  const [sources, setSources] = useState<AgentSourceView[]>([])
  const [kind, setKind] = useState<AcquireAgentSource['kind']>('git')
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    let current = true
    void agentSourceApi
      .list()
      .then(rows => {
        if (current) setSources(rows)
      })
      .catch(failure => {
        if (current) setError(String(failure))
      })
    return () => {
      current = false
    }
  }, [])
  const run = async (action: () => Promise<void>) => {
    operation.current = new AbortController()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (failure) {
      setError(explain(failure instanceof Error ? failure.message : String(failure)))
    } finally {
      setBusy(false)
    }
  }
  const acquire = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const acquired = await agentSourceApi.acquire({ url, kind, ...(kind === 'git' && branch.trim() ? { branch: branch.trim() } : {}) }, operation.current?.signal)
      setSources(await agentSourceApi.list())
      setUrl('')
      setBranch('')
      if (!acquired.candidates.length) setMessage(t('agentSourceNoAgents'))
    })
  }
  const updated = async (agent: UserAgentView) => {
    setPreview(undefined)
    await onImported()
    setSources(await agentSourceApi.list())
    setMessage(t(agent.publication === 'failed' ? 'agentSavedUnavailable' : 'agentSourceUpdated'))
  }
  const sync = (id: string) => void run(async () => {
    const result = await agentSourceApi.preview(id, operation.current?.signal)
    if (result.changed === false) { await agentSourceApi.cancel(result.token); setMessage(t('agentSourceCurrent')); return }
    if (!result.conflicts.length) await updated(await agentSourceApi.commit({ token: result.token, resolutions: {} }, operation.current?.signal))
    else { setPreview(result); setResolutions({}); setManual({}) }
  })
  useEffect(() => { if (initialSyncId) sync(initialSyncId) }, [initialSyncId])
  const commit = (event: FormEvent) => {
    event.preventDefault()
    if (!preview) return
    void run(async () => {
      const choices = { ...resolutions }
      for (const conflict of preview.conflicts) {
        if (!choices[conflict.key]) throw Error(t('agentSourceResolveAll'))
        if (choices[conflict.key].choice === 'manual') choices[conflict.key] = { choice: 'manual', value: ['prompt', 'name', 'description'].includes(conflict.key) ? manual[conflict.key] ?? '' : JSON.parse(manual[conflict.key] ?? 'null') }
      }
      await updated(await agentSourceApi.commit({ token: preview.token, resolutions: choices }, operation.current?.signal))
    })
  }
  return (
    <section className={css.inline} aria-label={t('agentSources')}>
      <h3>{t('agentSources')}</h3>
      <p className={css.muted}>{t('agentSourcesHelp')}</p>
      {busy && <button type="button" onClick={() => { operation.current?.abort(); onClose() }}>{t('cancel')}</button>}
      {preview && <form onSubmit={commit} className={css.inline}>
        <h3>{t('agentSourceConflicts')}</h3>
        <p className={css.muted}>{t('agentSourceConflictHelp')}</p>
        {preview.conflicts.map(conflict => <fieldset key={conflict.key} disabled={busy}>
          <legend>{conflict.key === 'prompt' ? t('agentPrompt') : conflict.key === 'name' ? t('agentName') : conflict.key === 'description' ? t('agentDescription') : conflict.key}</legend>
          <div className={css.conflictValues}>{(['base', 'local', 'upstream'] as const).map(side => <div key={side}>
            <strong>{t(side === 'base' ? 'agentSourceBase' : side === 'local' ? 'agentSourceLocal' : 'agentSourceUpstream')}</strong>
            <pre>{typeof conflict[side] === 'string' ? conflict[side] : JSON.stringify(conflict[side], null, 2)}</pre>
          </div>)}</div>
          <label>{t('agentSourceResolution')}<select required value={resolutions[conflict.key]?.choice ?? ''} onChange={event => {
            const choice = event.target.value
            if (choice === 'local' || choice === 'upstream') setResolutions(rows => ({ ...rows, [conflict.key]: { choice } }))
            else if (choice === 'manual') { setResolutions(rows => ({ ...rows, [conflict.key]: { choice: 'manual', value: conflict.local } })); setManual(rows => ({ ...rows, [conflict.key]: typeof conflict.local === 'string' ? conflict.local : JSON.stringify(conflict.local, null, 2) })) }
          }}><option value="" disabled>{t('agentSourceChoose')}</option><option value="local">{t('agentSourceKeepLocal')}</option><option value="upstream">{t('agentSourceUseUpstream')}</option><option value="manual">{t('agentSourceManual')}</option></select></label>
          {resolutions[conflict.key]?.choice === 'manual' && <label>{t('agentSourceMerged')}<textarea required rows={8} value={manual[conflict.key] ?? ''} onChange={event => setManual(rows => ({ ...rows, [conflict.key]: event.target.value }))}/></label>}
        </fieldset>)}
        <footer className={css.actions}><button type="button" disabled={busy} onClick={() => void run(async () => { await agentSourceApi.cancel(preview.token); setPreview(undefined) })}>{t('cancel')}</button><button className={css.primary} disabled={busy} type="submit">{t('agentSourceApply')}</button></footer>
      </form>}

      {sources.map(source => (
        <div className={css.source} key={source.id}>
          <strong>{source.id}</strong>
          <p className={css.sourceAddress}>{source.url}</p>
          <p className={css.muted}>
            {t(source.kind === 'local' ? 'sourceModeLocal' : source.kind === 'archive' ? 'sourceModeArchive' : 'sourceModeGit')}
            {source.lockCommit ? ` · ${source.lockCommit.slice(0, 12)}` : ''}
          </p>
          {source.errors.map((reason, index) => (
            <p key={index} className={css.error}>
              {reason}
            </p>
          ))}
          {source.candidates.map(candidate => (
            <div className={css.row} key={`${candidate.suiteId}/${candidate.resourceKey}`}>
              <div className={css.title}>
                <strong>{candidate.name}</strong>
                <p className={css.muted}>{candidate.error ? explain(candidate.error) : candidate.description}</p>
              </div>
              {agents.filter(agent => !agent.deletedAt && !agent.source?.importPending && agent.source?.sourceId === source.id && agent.source.suiteId === candidate.suiteId && agent.source.resourceKey === candidate.resourceKey).map(agent => <button type="button" key={agent.id} disabled={busy || !!preview} onClick={() => sync(agent.id)}>{t('agentSourceSync')}</button>)}
              <button
                disabled={busy || !!candidate.error}
                type="button"
                onClick={() =>
                  void run(async () => {
                    let agent
                    try {
                      agent = await agentSourceApi.import({ sourceId: source.id, suiteId: candidate.suiteId, resourceKey: candidate.resourceKey }, operation.current?.signal)
                    } finally {
                      await onImported()
                    }
                    setMessage(t(agent.publication === 'failed' ? 'agentSavedUnavailable' : 'agentSourceImported'))
                  })
                }
              >
                {t('agentSourceImport')}
              </button>
            </div>
          ))}
          {!source.candidates.length && <p className={css.muted}>{t('agentSourceNoAgents')}</p>}
        </div>
      ))}
      <form onSubmit={acquire}>
        <fieldset disabled={busy} className={css.sourceFields}>
          <legend>{t('agentSourceAdd')}</legend>
          <label>
            {t('agentSourceKind')}
            <select value={kind} onChange={event => setKind(event.target.value as AcquireAgentSource['kind'])}>
              <option value="git">{t('sourceModeGit')}</option>
              <option value="local">{t('sourceModeLocal')}</option>
              <option value="archive">{t('sourceModeArchive')}</option>
            </select>
          </label>
          <label>
            {t('agentSourceAddress')}
            <input
              required
              value={url}
              onChange={event => setUrl(event.target.value)}
              placeholder={t(kind === 'local' ? 'sourceUrlLocalPh' : kind === 'archive' ? 'sourceUrlArchivePh' : 'sourceUrlPh')}
            />
          </label>
          {kind === 'git' && (
            <label>
              {t('agentSourceBranch')}
              <input value={branch} onChange={event => setBranch(event.target.value)} />
            </label>
          )}
          <footer className={css.actions}>
            <button
              type="button"
              onClick={() => {
                setUrl('')
                setBranch('')
                setError('')
                setMessage('')
                onClose()
              }}
            >
              {t('cancel')}
            </button>
            <button className={css.primary} type="submit">
              {t(busy ? 'agentSourceReading' : 'agentSourceRead')}
            </button>
          </footer>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={css.muted}>
          {message}
        </p>
      )}
    </section>
  )
}
