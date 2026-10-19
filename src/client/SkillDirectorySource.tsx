import React, { useEffect, useRef, useState } from 'react'
import type { Translate } from './index.js'
import type { SkillDirectorySourcePreview, SkillDirectoryView } from '../contracts/skill-directories.js'
import type { AgentSourceResolution } from '../contracts/agent-sources.js'
import { skillDirectoryApi } from './skill-directory-api.js'
import css from './user-agents.module.css'

export function SkillDirectorySource({ agentId, view, disabled, t, onChanged }: { agentId: string; view: SkillDirectoryView; disabled: boolean; t: Translate; onChanged: (view: SkillDirectoryView) => Promise<void> }) {
  const [preview, setPreview] = useState<SkillDirectorySourcePreview>()
  const [resolutions, setResolutions] = useState<Record<string, AgentSourceResolution>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const token = useRef<string>()
  const lifetime = useRef<AbortController>()
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    return () => { controller.abort(); if (token.current) void skillDirectoryApi.sourceCancel(token.current).catch(() => {}) }
  }, [])
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    const signal = lifetime.current!.signal
    setBusy(true); setError(''); setMessage('')
    try { await action(signal) } catch (failure) { if (!signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  if (!view.source) return null
  return <section className={css.source}>
    <p className={css.sourceAddress}>{view.source.url}</p><p className={css.muted}>{view.source.commit}</p>
    <button type="button" disabled={disabled || busy || !!preview} onClick={() => void run(async signal => {
      const current = await skillDirectoryApi.sourcePreview({ id: agentId, name: view.name }, signal)
      if (signal.aborted) { void skillDirectoryApi.sourceCancel(current.token); return }
      token.current = current.token; setResolutions({}); setPreview(current)
      if (!current.changed) setMessage(t('agentSourceCurrent'))
    })}>{t('agentSkillSourceUpdate')}</button>
    {preview && <form className={css.inline} onSubmit={event => { event.preventDefault(); void run(async signal => {
      const current = await skillDirectoryApi.sourceCommit({ token: preview.token, resolutions }, signal)
      if (signal.aborted) return
      token.current = undefined; setPreview(undefined); await onChanged(current); setMessage(t('agentSourceUpdated'))
    }) }}>
      <p>{t('agentSkillSourceHelp')}</p>
      {preview.conflicts.map(conflict => <fieldset key={conflict.key} disabled={busy || disabled}>
        <legend>{conflict.key}</legend>
        <div className={css.conflictValues}>{(['base', 'local', 'upstream'] as const).map(side => <div key={side}><h5>{t(side === 'base' ? 'agentSourceBase' : side === 'local' ? 'agentSourceLocal' : 'agentSourceUpstream')}</h5><pre>{JSON.stringify(conflict[side], null, 2)?.slice(0, 12000) ?? t('agentSkillDeleted')}</pre></div>)}</div>
        <label>{t('agentSourceResolution')}<select required value={resolutions[conflict.key]?.choice ?? ''} onChange={event => { const choice = event.target.value; setResolutions(rows => choice === 'local' || choice === 'upstream' ? { ...rows, [conflict.key]: { choice } } : Object.fromEntries(Object.entries(rows).filter(([key]) => key !== conflict.key))) }}><option value="">{t('agentSourceResolveAll')}</option><option value="local">{t('agentSourceKeepLocal')}</option><option value="upstream">{t('agentSourceUseUpstream')}</option></select></label>
      </fieldset>)}
      <footer className={css.actions}><button type="button" disabled={busy} onClick={() => void run(async () => { await skillDirectoryApi.sourceCancel(preview.token); token.current = undefined; setPreview(undefined) })}>{t('cancel')}</button><button type="submit" className={css.primary} disabled={busy || disabled || !preview.changed || preview.conflicts.some(row => !resolutions[row.key])}>{t('agentSkillSourceApply')}</button></footer>
    </form>}
    {error && <p role="alert" className={css.error}>{error}</p>}{message && <p role="status" className={css.muted}>{message}</p>}
  </section>
}
