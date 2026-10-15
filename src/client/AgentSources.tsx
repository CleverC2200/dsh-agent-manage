import React, { useEffect, useState, type FormEvent } from 'react'
import type { AgentSourceView, AcquireAgentSource } from '../contracts/agent-sources.js'
import type { Translate } from './index.js'
import { agentSourceApi } from './agent-source-api.js'
import css from './user-agents.module.css'

/** Config sources share Catalog acquisition without installing executable plugins. */
export function AgentSources({ t, onImported }: { t: Translate; onImported: () => Promise<void> }) {
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
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await operation()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  const acquire = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const acquired = await agentSourceApi.acquire({ url, kind, ...(kind === 'git' && branch.trim() ? { branch: branch.trim() } : {}) })
      setSources(await agentSourceApi.list())
      setUrl('')
      setBranch('')
      if (!acquired.candidates.length) setMessage(t('agentSourceNoAgents'))
    })
  }
  return (
    <section className={css.inline} aria-label={t('agentSources')}>
      <h3>{t('agentSources')}</h3>
      <p className={css.muted}>{t('agentSourcesHelp')}</p>
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
                <p className={css.muted}>{candidate.error || candidate.description}</p>
              </div>
              <button
                disabled={busy || !!candidate.error}
                type="button"
                onClick={() =>
                  void run(async () => {
                    const agent = await agentSourceApi.import({ sourceId: source.id, suiteId: candidate.suiteId, resourceKey: candidate.resourceKey })
                    await onImported()
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
