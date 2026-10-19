import React, { useEffect, useRef, useState } from 'react'
import type { Translate } from './index.js'
import type { UserAgentView } from '../contracts/user-agents.js'
import type { SkillDirectoryView } from '../contracts/skill-directories.js'
import type { SkillEditorSession } from '../contracts/skill-editor.js'
import { userAgentApi } from './user-agent-api.js'
import { fileBase64, skillDirectoryApi, type SkillDirectoryFile } from './skill-directory-api.js'
import css from './user-agents.module.css'
import { SkillDirectorySource } from './SkillDirectorySource.js'

type Draft = Omit<SkillDirectoryFile, 'fileVersion'> & { fileVersion: string | null; original: string }
function DirectoryFiles({ paths, prefix = '', selected, busy, onRead }: { paths: string[]; prefix?: string; selected: string; busy: boolean; onRead: (path: string) => void }) {
  const entries = [...new Set(paths.map(path => path.slice(prefix.length).split('/')[0]))]
  return <ul>{entries.map(entry => {
    const path = `${prefix}${entry}`
    const children = paths.filter(file => file.startsWith(`${path}/`))
    return <li key={path}>{children.length ? <details open><summary>{entry}</summary><DirectoryFiles paths={children} prefix={`${path}/`} selected={selected} busy={busy} onRead={onRead} /></details> : <button type="button" disabled={busy} aria-current={selected === path ? 'true' : undefined} onClick={() => onRead(path)}>{path}</button>}</li>
  })}</ul>
}
export function SkillDirectoryEditor({ agent, name, t, onSaved, onClose, openEditor }: {
  agent: UserAgentView; name: string; t: Translate; onSaved: (agent: UserAgentView) => void; onClose: () => void; openEditor?: (session: SkillEditorSession) => Promise<void>
}) {
  const [view, setView] = useState<SkillDirectoryView>()
  const [selected, setSelected] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [path, setPath] = useState('')
  const [comparison, setComparison] = useState<SkillDirectoryFile>()
  const [confirmation, setConfirmation] = useState<'reset' | 'delete' | 'close'>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const lifetime = useRef<AbortController>()
  const loading = useRef<AbortController>()
  const target = { id: agent.id, name }
  const dirty = Object.values(drafts).some(file => file.data !== file.original || file.fileVersion === null)
  const file = drafts[selected]
  const modified = !!file && (file.data !== file.original || file.fileVersion === null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void skillDirectoryApi.open(target, controller.signal).then(async current => {
      const entry = current.entry === '.' ? 'SKILL.md' : `${current.entry}/SKILL.md`
      if (controller.signal.aborted) return
      setView(current)
      const path = current.files.some(file => file.path === entry) ? entry : current.files[0]?.path
      if (!path) return
      const opened = await skillDirectoryApi.read({ ...target, path }, controller.signal)
      if (!controller.signal.aborted) { setSelected(path); setDrafts({ [path]: { ...opened, original: opened.data } }) }
    }).catch(failure => { if (!controller.signal.aborted) setError(String(failure)) })
    return () => { controller.abort(); loading.current?.abort() }
  }, [agent.id, name])
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    const signal = lifetime.current?.signal
    if (!signal) return
    setBusy(true); setError(''); setMessage('')
    try { await action(signal) } catch (failure) { if (!signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const read = async (path: string) => {
    setSelected(path); setComparison(undefined); setConfirmation(undefined)
    if (drafts[path]) return
    loading.current?.abort()
    const controller = new AbortController()
    loading.current = controller
    try {
      const opened = await skillDirectoryApi.read({ ...target, path }, AbortSignal.any([controller.signal, lifetime.current!.signal]))
      if (!controller.signal.aborted && !lifetime.current?.signal.aborted) setDrafts(rows => ({ ...rows, [path]: { ...opened, original: opened.data } }))
    } catch (failure) { if (!controller.signal.aborted && !lifetime.current?.signal.aborted) setError(String(failure)) }
  }
  const refreshAgent = async () => {
    const rows = await (agent.origin === 'plugin' ? userAgentApi.pluginAgents() : userAgentApi.list())
    const current = rows.find(row => row.id === agent.id)
    if (current && !lifetime.current?.signal.aborted) onSaved(current)
  }
  const write = async (data = file?.data, encoding = file?.encoding) => {
    if (!view || !file || data === undefined || !encoding) return
    await run(async signal => {
      const current = await skillDirectoryApi.write({ ...target, revision: view.revision, path: selected, data, encoding, fileVersion: file.fileVersion }, signal)
      const opened = await skillDirectoryApi.read({ ...target, path: selected }, signal)
      if (signal.aborted) return
      setView(current); setDrafts(rows => ({ ...rows, [selected]: { ...opened, original: opened.data } })); setComparison(undefined)
    })
  }
  const apply = () => view && void run(async signal => {
    const current = await skillDirectoryApi.apply({ ...target, revision: view.revision }, signal)
    if (signal.aborted) return
    setView(current); setMessage(t('agentSkillApplied')); await refreshAgent()
  })
  const reset = () => view && void run(async signal => {
    const current = await skillDirectoryApi.reset({ ...target, revision: view.revision }, signal)
    const entry = current.entry === '.' ? 'SKILL.md' : `${current.entry}/SKILL.md`
    const opened = await skillDirectoryApi.read({ ...target, path: entry }, signal)
    if (signal.aborted) return
    setView(current); setSelected(entry); setDrafts({ [entry]: { ...opened, original: opened.data } }); setConfirmation(undefined); setComparison(undefined)
  })
  const refresh = () => void run(async signal => {
    const current = await skillDirectoryApi.open(target, signal)
    const preserveSelected = file && (file.data !== file.original || file.fileVersion === null)
    const exists = current.files.some(row => row.path === selected)
    const opened = !preserveSelected && exists ? await skillDirectoryApi.read({ ...target, path: selected }, signal) : undefined
    if (signal.aborted) return
    setView(current)
    setComparison(undefined)
    setDrafts(rows => ({
      ...Object.fromEntries(Object.entries(rows).filter(([, row]) => row.data !== row.original || row.fileVersion === null)),
      ...(opened ? { [selected]: { ...opened, original: opened.data } } : {})
    }))
    if (!preserveSelected && !exists) setSelected('')
  })
  const paths = [...new Set([...(view?.files.map(file => file.path) ?? []), ...Object.keys(drafts)])].sort()
  return <section className={css.inline} aria-label={t('agentSkillDirectory')} aria-busy={busy}>
    <header className={css.panelHeading}><h4 className={css.title}>{name}</h4><button type="button" disabled={busy} onClick={() => dirty ? setConfirmation('close') : onClose()}>{t('agentSkillCloseEditor')}</button></header>
    <p role="status" className={css.muted}>{dirty ? t('agentSkillUnsavedText') : view?.changes.length ? t('agentSkillUnapplied') : t('agentSkillCurrentVersion')}</p>
    <div className={css.skillToolbar}>
      <button type="button" disabled={busy || !view} onClick={refresh}>{t('agentSkillRefreshChanges')}</button>
      <button type="button" disabled={busy || !view || dirty || !openEditor} onClick={() => void run(async signal => { const session = await skillDirectoryApi.editor({ ...target, revision: view!.revision }, signal); signal.throwIfAborted(); await openEditor!(session) })}>{t('agentSkillAgentEdit')}</button>
    </div>
    {view?.source && <SkillDirectorySource agentId={agent.id} view={view} disabled={busy || dirty} t={t} onChanged={async current => { setView(current); setDrafts({}); setSelected(''); await refreshAgent() }} />}
    {view && <div className={css.skillEditorGrid}>
      <nav aria-label={t('agentSkillFiles')} className={css.skillFiles}><DirectoryFiles paths={paths} selected={selected} busy={busy} onRead={path => void read(path)} /></nav>
      <div className={css.skillFileContent}>
        {file ? <>
          <h5 className={css.title}>{selected}</h5>
          {file.encoding === 'utf8' ? <label>{t('agentSkillContent')}<textarea rows={16} disabled={busy} value={file.data} onChange={event => setDrafts(rows => ({ ...rows, [selected]: { ...file, data: event.target.value } }))} /></label> : <>
            <p>{t('agentSkillBinaryInfo', { size: view.files.find(row => row.path === selected)?.size ?? 0 })}</p>
            <button type="button" disabled={busy} onClick={() => {
              const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(file.data), character => character.charCodeAt(0))]))
              const link = document.createElement('a'); link.href = url; link.download = selected.split('/').at(-1) ?? 'download'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}>{t('agentSkillDownload')}</button>
            <label>{t('agentSkillReplaceBinary')}<input type="file" disabled={busy} onChange={event => { const replacement = event.target.files?.[0]; if (replacement) void fileBase64(replacement).then(data => { setDrafts(rows => ({ ...rows, [selected]: { ...file, data, encoding: 'base64' } })); return write(data, 'base64') }).catch(failure => setError(String(failure))); event.target.value = '' }} /></label>
          </>}
          <div className={css.skillToolbar}>
            <button type="button" disabled={busy || !modified} onClick={() => void write()}>{t('agentSkillWriteFile')}</button>
            <button type="button" disabled={busy || file.fileVersion === null} onClick={() => void run(async signal => { const opened = await skillDirectoryApi.read({ ...target, path: selected }, signal); const current = await skillDirectoryApi.open(target, signal); if (!signal.aborted) { setComparison(opened); setView(current) } })}>{t('agentSkillCompareCurrent')}</button>
            <button type="button" disabled={busy || modified || file.fileVersion === null} onClick={() => setConfirmation('delete')}>{t('agentSkillDeleteFile')}</button>
          </div>
          {comparison && <div><h5>{t('agentSkillCurrentFile')}</h5><pre className={css.skillComparison}>{comparison.encoding === 'utf8' ? comparison.data : t('agentSkillBinary')}</pre><button type="button" disabled={busy} onClick={() => { setDrafts(rows => ({ ...rows, [selected]: { ...file, fileVersion: comparison.fileVersion, original: comparison.data } })); setComparison(undefined); setError('') }}>{t('agentSkillUseCurrentBase')}</button></div>}
        </> : <p className={css.muted}>{t('agentSkillFileLoading')}</p>}
        <form onSubmit={event => { event.preventDefault(); if (!path || paths.includes(path)) { setError(t('agentSkillFileExists')); return }; setSelected(path); setDrafts(rows => ({ ...rows, [path]: { path, data: '', encoding: 'utf8', fileVersion: null, original: '' } })); setPath(''); setComparison(undefined) }}>
          <label>{t('agentSkillFilePath')}<input disabled={busy} required value={path} onChange={event => setPath(event.target.value)} /></label>
          <div className={css.skillToolbar}><button type="submit" disabled={busy || !path}>{t('agentSkillNewFile')}</button><button type="button" disabled={busy || !path || !file || modified || file.fileVersion === null} onClick={() => void run(async signal => {
            const current = await skillDirectoryApi.rename({ ...target, revision: view.revision, path: selected, to: path, fileVersion: file!.fileVersion! }, signal)
            if (signal.aborted) return
            const next = path; setView(current); setDrafts(rows => { const copy = { ...rows }; delete copy[selected]; return { ...copy, [next]: { ...file!, path: next } } }); setSelected(next); setPath('')
          })}>{t('agentSkillRenameFile')}</button></div>
        </form>
      </div>
    </div>}
    {view && <details open={view.changes.length > 0}><summary>{t('agentSkillChanges', { count: view.changes.length })}</summary><ul>{view.changes.map(change => <li key={change.path}>{t(change.kind === 'added' ? 'agentSkillAdded' : change.kind === 'deleted' ? 'agentSkillDeleted' : 'agentSkillModified')} · {change.path}</li>)}</ul></details>}
    {confirmation && <div className={css.inline}><p>{t(confirmation === 'close' ? 'agentSkillDiscardTextQuestion' : confirmation === 'delete' ? 'agentSkillDeleteQuestion' : 'agentSkillResetQuestion')}</p><div className={css.actions}><button type="button" disabled={busy} onClick={() => setConfirmation(undefined)}>{t('cancel')}</button><button type="button" disabled={busy} onClick={() => {
      if (confirmation === 'close') onClose()
      else if (confirmation === 'reset') reset()
      else if (view && file?.fileVersion) void run(async signal => {
        const current = await skillDirectoryApi.delete({ ...target, revision: view.revision, path: selected, fileVersion: file.fileVersion! }, signal)
        if (signal.aborted) return
        setView(current); setDrafts(rows => { const copy = { ...rows }; delete copy[selected]; return copy }); setSelected(''); setConfirmation(undefined)
      })
    }}>{t(confirmation === 'close' ? 'agentSkillDiscardText' : confirmation === 'delete' ? 'agentSkillConfirmDelete' : 'agentSkillConfirmReset')}</button></div></div>}
    <footer className={css.actions}>
      <button type="button" disabled={busy || !view || (!view.changes.length && !dirty)} onClick={() => setConfirmation('reset')}>{t('agentSkillReset')}</button>
      <button type="button" disabled={busy || !view || dirty || !!view.changes.length} onClick={() => view && void run(async signal => { const current = await skillDirectoryApi.restore({ ...target, revision: view.revision }, signal); if (signal.aborted) return; setView(current); setDrafts({}); setSelected(''); await refreshAgent(); setMessage(t('agentSkillRestored')) })}>{t('agentSkillRestore')}</button>
      <button type="button" className={css.primary} disabled={busy || !view || dirty || !view.changes.length} onClick={apply}>{t('agentSkillApply')}</button>
    </footer>
    {error && <p role="alert" className={css.error}>{error === 'SKILL_EDIT_CONFLICT' ? t('agentSkillConflict') : error}</p>}
    {message && <p role="status" className={css.muted}>{message}</p>}
  </section>
}
